// fireIQ's Firecrawl calls, written against the Node SDK so the same code can run in the local
// Bun server or a Vercel function. Every function takes the caller's Firecrawl API key.
import Firecrawl, { SdkError } from "firecrawl";

export type Opts = { geo: string; property: string; time: string };
export type Out<T> = { data: T; credits: number };

// Firecrawl limits requests per minute per account (26 on Oct 6), so at most 3 calls run at once
// and a 429 waits out the reset the API reports.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_ACTIVE = 3;
let active = 0;
const waiting: (() => void)[] = [];
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_ACTIVE) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (e) {
        if (!(e instanceof SdkError) || e.status !== 429 || attempt >= 3) throw e;
        const wait = Number(e.message.match(/retry after (\d+)s/)?.[1] ?? 20);
        await sleep((wait + 1) * 1000);
      }
    }
  } finally {
    active--;
    waiting.shift()?.();
  }
}

const client = (apiKey: string) => new Firecrawl({ apiKey });

async function alexandria(apiKey: string, provider: string, capability: string, options: Record<string, unknown>): Promise<Out<any>> {
  let credits = 0;
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await limited(() => client(apiKey).scrape({ alexandria: { provider, capability, options } }));
    credits += r.creditsCost ?? 0;
    const item: any = r.alexandria?.[0];
    if (item?.data) return { data: item.data, credits };
    const err = item?.error;
    if (err?.code !== "provider_rate_limited") throw new Error(err?.message ?? "No data returned");
    await sleep(((err.retryAfterSeconds ?? 2) + attempt * 2) * 1000);
  }
  throw new Error("Still rate-limited after 5 tries");
}

// Trends rejects parallel calls from one account (provider_rate_limited), so they run one at a time.
let trendsQueue: Promise<unknown> = Promise.resolve();
function trends(apiKey: string, capability: string, options: Record<string, unknown>) {
  const p = trendsQueue.then(() => alexandria(apiKey, "firecrawl-trends", `trends/${capability}`, options));
  trendsQueue = p.catch(() => {});
  return p;
}

export const related = (apiKey: string, keyword: string, o: Opts) => trends(apiKey, "related_queries", { keyword, ...o });
export const interest = (apiKey: string, keywords: string[], o: Opts) => trends(apiKey, "interest_over_time", { keywords: keywords.slice(0, 5), ...o });

export async function youtubeSearch(apiKey: string, query: string, limit: number): Promise<Out<{ title: string; url: string }[]>> {
  const r: any = await limited(() => client(apiKey).search(`site:youtube.com ${query}`, { limit }));
  const web: { title?: string; url: string }[] = r.web ?? [];
  return {
    data: web.filter((w) => /youtube\.com\/(watch|shorts)/.test(w.url) && w.title)
      .map((w) => ({ title: w.title!.replace(/\s*-\s*YouTube$/, "").trim(), url: w.url })),
    credits: r.creditsUsed ?? Math.ceil(limit / 10) * 2,
  };
}

export type TopVideo = { title: string; url: string; channel: string; views: number; age: string };

// YouTube's own result pages, sorted by view count: all time, and uploaded this year. One scrape credit
// each, and unlike web search they carry views and upload age for every result.
const SORTS = { allTime: "CAMSAhAB", thisYear: "CAMSBAgFEAE%3D" };
export async function youtubeTop(apiKey: string, query: string): Promise<Out<TopVideo[]>> {
  const pages = await Promise.allSettled(Object.values(SORTS).map((sp) =>
    limited(() => client(apiKey).scrape(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=${sp}`, { formats: ["markdown"] }))));
  const seen = new Set<string>();
  const out: TopVideo[] = [];
  let credits = 0;
  for (const p of pages) {
    if (p.status !== "fulfilled") continue;
    credits += 1;
    for (const v of parseResults((p.value as any).markdown ?? "")) {
      const id = new URL(v.url).searchParams.get("v");
      if (id && !seen.has(id)) { seen.add(id); out.push(v); }
    }
  }
  if (!out.length) throw new Error(pages.find((p) => p.status === "rejected")?.reason?.message ?? "YouTube returned no results for this keyword");
  return { data: out.sort((a, b) => b.views - a.views), credits };
}

// Views and age are printed run together, e.g. "2.6M7mo ago" or "7453mo ago" (745 views, 3 months).
// Split at the first point where the rest is a plausible age.
const AGE_MAX: Record<string, number> = { s: 59, m: 59, min: 59, h: 23, d: 31, w: 5, wk: 5, mo: 11, y: 30, yr: 30 };
function splitViewsAge(s: string) {
  for (let i = 1; i < s.length; i++) {
    const m = s.slice(i).match(/^(\d{1,2})\s?(mo|min|yr|wk|s|m|h|d|w|y)\s?ago$/);
    const views = s.slice(0, i).match(/^(\d+(?:\.\d+)?)([KMB]?)$/);
    if (m && views && Number(m[1]) >= 1 && Number(m[1]) <= AGE_MAX[m[2]]) {
      return { views: Math.round(Number(views[1]) * ({ K: 1e3, M: 1e6, B: 1e9 }[views[2]] ?? 1)), age: `${m[1]}${m[2]} ago` };
    }
  }
  return null;
}
export function parseResults(md: string): TopVideo[] {
  const lines = md.split("\n");
  const out: TopVideo[] = [];
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

// Free call that confirms a key works and reports what's left on the account.
export async function account(apiKey: string) {
  const u = await client(apiKey).getCreditUsage();
  return { remainingCredits: u.remainingCredits, planCredits: u.planCredits ?? null };
}
