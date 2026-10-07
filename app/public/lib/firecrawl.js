// fireIQ's Firecrawl calls. They go through this app's Worker (/api/firecrawl), which adds the viewer's key
// from an HttpOnly cookie, so the key is never readable by the page. Results are cached in this browser's
// IndexedDB, so repeating a search costs nothing.
const API = "/api/firecrawl";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class FirecrawlError extends Error {
  constructor(message, status, auth) {
    super(message);
    this.status = status;
    this.auth = auth;
  }
}

// ---------- cache ----------
let dbp = null;
const db = () => (dbp ??= new Promise((resolve, reject) => {
  const req = indexedDB.open("fireiq", 1);
  req.onupgradeneeded = () => req.result.createObjectStore("cache");
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
}));
async function cacheGet(key) {
  try {
    const d = await db();
    return await new Promise((r) => { const q = d.transaction("cache").objectStore("cache").get(key); q.onsuccess = () => r(q.result); q.onerror = () => r(undefined); });
  } catch { return undefined; }
}
async function cacheSet(key, value) {
  try {
    const d = await db();
    d.transaction("cache", "readwrite").objectStore("cache").put(value, key);
  } catch {}
}
async function cached(key, fresh, fn) {
  const k = JSON.stringify(key);
  if (!fresh) { const hit = await cacheGet(k); if (hit !== undefined) return { data: hit, credits: 0, cached: true }; }
  const r = await fn();
  await cacheSet(k, r.data);
  return { ...r, cached: false };
}

// ---------- requests ----------
// Firecrawl limits requests per minute per account, so at most 3 calls run at once and a 429 waits out
// the reset the API reports.
const MAX_ACTIVE = 3;
let active = 0;
const waiting = [];
async function request(path, body) {
  if (active >= MAX_ACTIVE) await new Promise((r) => waiting.push(r));
  active++;
  try {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(API + path, {
        method: body ? "POST" : "GET",
        headers: body ? { "content-type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 429 && attempt < 3) {
        await sleep((Number(String(j.error).match(/retry after (\d+)s/)?.[1] ?? 20) + 1) * 1000);
        continue;
      }
      if (res.status === 401 || res.status === 403) throw new FirecrawlError(j.error || "Firecrawl rejected this API key.", res.status, j.auth || "rejected");
      if (res.status === 402) throw new FirecrawlError("This Firecrawl account is out of credits.", 402, "credits");
      if (!res.ok || j.success === false) throw new FirecrawlError(j.error || `Firecrawl error ${res.status}`, res.status);
      return j;
    }
  } finally {
    active--;
    waiting.shift()?.();
  }
}

async function alexandria(provider, capability, options) {
  let credits = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    const j = await request("/scrape", { alexandria: [{ provider, capability, options }] });
    credits += j.data?.creditsCost ?? 0;
    const item = j.data?.alexandria?.[0];
    if (item?.data) return { data: item.data, credits };
    const err = item?.error;
    if (err?.code !== "provider_rate_limited") throw new FirecrawlError(err?.message ?? "No data returned", 502);
    await sleep(((err.retryAfterSeconds ?? 2) + attempt * 2) * 1000);
  }
  throw new FirecrawlError("Still rate-limited after 5 tries", 429);
}

// Trends rejects parallel calls from one account (provider_rate_limited), so they run one at a time.
let trendsQueue = Promise.resolve();
function trends(capability, options) {
  const p = trendsQueue.then(() => alexandria("firecrawl-trends", `trends/${capability}`, options));
  trendsQueue = p.catch(() => {});
  return p;
}

const optsOf = (o) => ({ geo: o.geo ?? "US", property: o.property ?? "youtube", time: o.time ?? "today 1-m" });
export const related = (keyword, o, fresh) => { const opts = optsOf(o); return cached({ related: { keyword, ...opts } }, fresh, () => trends("related_queries", { keyword, ...opts })); };
export const interest = (keywords, o, fresh) => { const opts = optsOf(o); keywords = keywords.slice(0, 5); return cached({ interest: { keywords, ...opts } }, fresh, () => trends("interest_over_time", { keywords, ...opts })); };

// ---------- YouTube ----------
// YouTube's own result pages, sorted by view count: all time, and uploaded this year. One scrape credit
// each, and unlike web search they carry views and upload age for every result.
const SORTS = { allTime: "CAMSAhAB", thisYear: "CAMSBAgFEAE%3D" };
const ytUrl = (q, sp) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=${sp}`;
export function youtubeTop(query, fresh) {
  return cached({ youtubeTop: query.toLowerCase() }, fresh, async () => {
    const pages = await Promise.allSettled(Object.values(SORTS).map((sp) => request("/scrape", { url: ytUrl(query, sp), formats: ["markdown"] })));
    const seen = new Set();
    const out = [];
    let credits = 0;
    for (const p of pages) {
      if (p.status !== "fulfilled") continue;
      credits += 1;
      for (const v of parseResults(p.value.data?.markdown ?? "")) {
        const id = new URL(v.url).searchParams.get("v");
        if (id && !seen.has(id)) { seen.add(id); out.push(v); }
      }
    }
    const failed = pages.find((p) => p.status === "rejected");
    if (!out.length) throw failed?.reason ?? new FirecrawlError("YouTube returned no results for this keyword", 404);
    return { data: out.sort((a, b) => b.views - a.views), credits };
  });
}

// Views and age are printed run together, e.g. "2.6M7mo ago" or "7453mo ago" (745 views, 3 months).
// Split at the first point where the rest is a plausible age.
const AGE_MAX = { s: 59, m: 59, min: 59, h: 23, d: 31, w: 5, wk: 5, mo: 11, y: 30, yr: 30 };
function splitViewsAge(s) {
  for (let i = 1; i < s.length; i++) {
    const m = s.slice(i).match(/^(\d{1,2})\s?(mo|min|yr|wk|s|m|h|d|w|y)\s?ago$/);
    const views = s.slice(0, i).match(/^(\d+(?:\.\d+)?)([KMB]?)$/);
    if (m && views && Number(m[1]) >= 1 && Number(m[1]) <= AGE_MAX[m[2]]) {
      return { views: Math.round(Number(views[1]) * ({ K: 1e3, M: 1e6, B: 1e9 }[views[2]] ?? 1)), age: `${m[1]}${m[2]} ago` };
    }
  }
  return null;
}
export function parseResults(md) {
  const lines = md.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^### \[(.+?)\]\((https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11})/);
    if (!h) continue;
    let channel = "", stats = null;
    for (let j = i + 1; j < Math.min(lines.length, i + 25) && !stats; j++) {
      channel ||= lines[j].match(/^\[([^\]]+)\]\(https:\/\/www\.youtube\.com\/@/)?.[1] ?? "";
      stats = splitViewsAge(lines[j].trim());
    }
    if (stats) out.push({ title: h[1].replace(/\\([|\[\]_*])/g, "$1").trim(), url: h[2], channel, ...stats });
  }
  return out;
}

// Firecrawl's JSON format runs a language model over the page it scrapes (+4 credits). Pointed at YouTube's
// most-viewed results for a keyword, it reads what the subject is and what gets clicks, then writes titles.
// `trending` is what people search alongside the keyword right now (from Trends), offered as phrases
// the titles can use where they fit.
export function titleIdeas(keyword, tool, trending = [], fresh) {
  const phrases = trending.map((t) => t.query);
  return cached({ titleIdeas: keyword.toLowerCase(), tool: tool.toLowerCase(), phrases }, fresh, async () => {
    const angle = tool ? `\n- The video's angle is ${tool}: every title must name ${tool}.` : "";
    const searching = phrases.length ? `\n- People are searching YouTube for these right now: ${trending.map((t) => `"${t.query}" (${t.label})`).join(", ")}. Work one of these into at least 4 of the titles, only where it reads naturally; never more than one per title.` : "";
    const prompt = `This page lists the most-viewed YouTube videos for "${keyword}". Read the titles, descriptions and view counts and work out what the subject actually is and what makes viewers click.

Then write 15 NEW titles for a video about "${keyword}". Rules:${angle}${searching}
- Be specific to this subject: use real names, features and comparisons from these videos, never filler like "game changer", "revolutionary" or "explored".
- Use what works here: first-person framing ("I tested…", "I replaced…"), a surprising claim, a comparison, or a direct challenge to the viewer.
- Never invent results or statistics. Only use a number if it appears on this page.
- No emoji, at most one exclamation mark across all titles, Title Case, under 65 characters.
- Every title takes a different angle and must not copy or lightly reword an existing title.
For each, give the existing title whose pattern it borrows.`;
    const j = await request("/scrape", {
      url: ytUrl(keyword, SORTS.allTime),
      formats: [{
        type: "json",
        prompt,
        schema: {
          type: "object",
          properties: {
            subject: { type: "string", description: "One sentence on what the subject is" },
            angles: { type: "array", items: { type: "string" }, description: "What viewers find interesting about it" },
            titles: { type: "array", items: { type: "object", properties: { title: { type: "string" }, inspired_by: { type: "string" } }, required: ["title", "inspired_by"] } },
          },
          required: ["subject", "titles"],
        },
      }],
    });
    const out = j.data?.json ?? {};
    return {
      data: { subject: out.subject ?? "", angles: out.angles ?? [], titles: (out.titles ?? []).filter((t) => t?.title) },
      credits: j.data?.metadata?.creditsUsed ?? 5,
    };
  });
}
