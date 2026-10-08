// fireIQ's Worker. It holds the viewer's Firecrawl key in an encrypted HttpOnly cookie, so page scripts
// can never read it, and forwards only the Firecrawl calls the app makes. Static files come from public/.
import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";

type Env = { COOKIE_SECRET: string; ASSETS: Fetcher; GLM_API_KEY?: string; GLM_BASE_URL?: string; GLM_MODEL?: string };
const app = new Hono<{ Bindings: Env }>();

const FIRECRAWL = "https://api.firecrawl.dev/v2";
const COOKIE = "fiq";
const MONTH = 60 * 60 * 24 * 30;

// ---------- cookie encryption (AES-GCM, key derived from COOKIE_SECRET) ----------
const enc = new TextEncoder();
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
async function aesKey(secret: string) {
  if (!secret || secret.length < 32) throw new Error("COOKIE_SECRET must be set to at least 32 characters");
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
type Session = { key: string; team: string };
async function seal(secret: string, s: Session) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(secret), enc.encode(JSON.stringify(s))));
  return b64(new Uint8Array([...iv, ...ct]));
}
async function open(secret: string, value: string | undefined): Promise<Session | null> {
  if (!value) return null;
  try {
    const raw = unb64(value);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, await aesKey(secret), raw.slice(12));
    return JSON.parse(new TextDecoder().decode(pt));
  } catch {
    return null;
  }
}
async function signIn(c: any, s: Session, remember: boolean) {
  setCookie(c, COOKIE, await seal(c.env.COOKIE_SECRET, s), {
    httpOnly: true, secure: true, sameSite: "Strict", path: "/api",
    ...(remember ? { maxAge: MONTH } : {}),
  });
}
const session = (c: any) => open(c.env.COOKIE_SECRET, getCookie(c, COOKIE));

// SameSite=Strict already stops other sites sending the cookie; this also refuses cross-origin writes.
app.use("/api/*", async (c, next) => {
  if (c.req.method !== "GET") {
    const origin = c.req.header("origin");
    if (origin && new URL(origin).host !== new URL(c.req.url).host) return c.json({ error: "Cross-origin request refused" }, 403);
  }
  await next();
});

async function credits(key: string) {
  const r = await fetch(`${FIRECRAWL}/team/credit-usage`, { headers: { authorization: `Bearer ${key}` } });
  if (r.status === 401 || r.status === 403) return null;
  const j: any = await r.json().catch(() => ({}));
  const d = j.data ?? j;
  return { remainingCredits: d.remainingCredits ?? d.remaining_credits ?? 0, planCredits: d.planCredits ?? d.plan_credits ?? null };
}

// ---------- account ----------
app.get("/api/me", async (c) => {
  const s = await session(c);
  if (!s) return c.json({ connected: false });
  const u = await credits(s.key);
  if (!u) { deleteCookie(c, COOKIE, { path: "/api" }); return c.json({ connected: false, rejected: true }); }
  return c.json({ connected: true, teamName: s.team, ...u });
});

// Firecrawl's browser sign-in (the flow its CLI uses): the page opens firecrawl.dev/cli-auth with a PKCE
// challenge and polls here. On completion the key goes straight into the cookie and never to the page.
app.post("/api/auth/poll", async (c) => {
  const { session_id, code_verifier, remember = true } = await c.req.json();
  const r = await fetch("https://www.firecrawl.dev/api/auth/cli/status", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session_id, code_verifier }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (j.status === "complete" && j.apiKey) {
    await signIn(c, { key: j.apiKey, team: j.teamName || "Firecrawl" }, remember);
    return c.json({ status: "complete", teamName: j.teamName || "Firecrawl" });
  }
  return c.json({ status: j.status ?? "pending" });
});

app.post("/api/auth/key", async (c) => {
  const { apiKey, remember = true } = await c.req.json();
  if (!/^fc-[A-Za-z0-9]+$/.test(apiKey ?? "")) return c.json({ error: "That doesn't look like a Firecrawl API key." }, 400);
  if (!(await credits(apiKey))) return c.json({ error: "Firecrawl rejected this API key.", auth: "rejected" }, 401);
  await signIn(c, { key: apiKey, team: "API key" }, remember);
  return c.json({ ok: true });
});

app.post("/api/auth/logout", (c) => {
  deleteCookie(c, COOKIE, { path: "/api" });
  return c.json({ ok: true });
});

// ---------- Firecrawl pass-through ----------
// Only the calls fireIQ makes are forwarded, so a stray script on the page can't use the viewer's key
// to scrape arbitrary sites.
const TRENDS = new Set(["trends/related_queries", "trends/interest_over_time"]);
function allowed(body: any) {
  if (body?.alexandria) {
    const calls = Array.isArray(body.alexandria) ? body.alexandria : [body.alexandria];
    return calls.length === 1 && calls[0].provider === "firecrawl-trends" && TRENDS.has(calls[0].capability);
  }
  return typeof body?.url === "string" && body.url.startsWith("https://www.youtube.com/results?search_query=");
}
app.post("/api/firecrawl/scrape", async (c) => {
  const s = await session(c);
  if (!s) return c.json({ error: "Connect Firecrawl to run live research.", auth: "missing" }, 401);
  const body = await c.req.json().catch(() => null);
  if (!allowed(body)) return c.json({ error: "This request isn't one fireIQ makes." }, 400);
  const r = await fetch(`${FIRECRAWL}/scrape`, {
    method: "POST",
    headers: { authorization: `Bearer ${s.key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (r.status === 401 || r.status === 403) {
    deleteCookie(c, COOKIE, { path: "/api" });
    return c.json({ error: "Firecrawl rejected this API key.", auth: "rejected" }, 401);
  }
  return new Response(r.body, { status: r.status, headers: { "content-type": "application/json" } });
});

// ---------- feedback ----------
// The About page's form goes to Firecrawl's Alexandria feedback, sent as the viewer's team. The body is
// built here from a few checked fields, so the page can't send anything else under the viewer's key.
const FEATURES = new Set(["Chrome extension", "Channel audits", "Competitor tracking", "Keyword alerts", "MCP server", "More vidIQ-style features"]);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
app.post("/api/feedback", async (c) => {
  const s = await session(c);
  if (!s) return c.json({ error: "Sign in with Firecrawl to send feedback.", auth: "missing" }, 401);
  const b: any = await c.req.json().catch(() => ({}));
  const rating = ["good", "partial", "bad"].includes(b.rating) ? b.rating : null;
  const features = (Array.isArray(b.features) ? b.features : []).filter((f: unknown) => FEATURES.has(f as string));
  const details = text(b.details, 1500);
  const objective = text(b.objective, 2000);
  if (!rating) return c.json({ error: "Pick how useful fireIQ is today." }, 400);
  if (!details && !features.length) return c.json({ error: "Pick a feature or tell us what you'd want." }, 400);
  const r = await fetch(`${FIRECRAWL}/feedback`, {
    method: "POST",
    headers: { authorization: `Bearer ${s.key}`, "content-type": "application/json" },
    body: JSON.stringify({
      endpoint: "alexandria",
      rating,
      origin: "fireiq",
      integration: "fireiq",
      requestedWebsite: {
        url: "https://www.youtube.com",
        requestedFunctionality: `fireIQ as a full product.${features.length ? ` Wants: ${features.join(", ")}.` : ""}${details ? ` ${details}` : ""}`.slice(0, 2000),
      },
      rationale: details || `Wants: ${features.join(", ")}`,
      ...(objective ? { objective } : {}),
    }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (r.status === 401) return c.json({ error: "Firecrawl rejected this API key.", auth: "rejected" }, 401);
  if (!r.ok || j.success === false) return c.json({ error: j.error || `Firecrawl error ${r.status}`, code: j.feedbackErrorCode }, r.status === 500 ? 502 : 400);
  return c.json({ ok: true });
});

// ---------- title writer (GLM) ----------
// Title Lab tries GLM first, through OpenRouter by default, with the owner's key (GLM_API_KEY). Z.ai's own
// API sits behind Alibaba Cloud's firewall, which answers requests from Workers with a 405 page. Any
// failure, including no key or no balance, returns 503 and the page falls back to Firecrawl's JSON format.
// The prompt is built here from checked fields, so signed-in viewers can't use the key for anything else.
let glmDownUntil = 0;
app.post("/api/llm/titles", async (c) => {
  const key = c.env.GLM_API_KEY;
  if (!key || Date.now() < glmDownUntil) return c.json({ error: "GLM unavailable", fallback: true }, 503);
  if (!(await session(c))) return c.json({ error: "Connect Firecrawl to write titles.", auth: "missing" }, 401);
  const b: any = await c.req.json().catch(() => ({}));
  const keyword = text(b.keyword, 100);
  const about = text(b.about, 500);
  const trending = (Array.isArray(b.trending) ? b.trending : []).slice(0, 12).map((t: any) => `"${text(t?.query, 80)}" (${text(t?.label, 20)})`);
  const videos = (Array.isArray(b.videos) ? b.videos : []).slice(0, 30)
    .map((v: any) => `- ${text(v?.title, 150)} · ${Number(v?.views) || 0} views · ${text(v?.age, 20)} · ${text(v?.channel, 60)}`);
  const patterns = (Array.isArray(b.patterns) ? b.patterns : []).slice(0, 8)
    .map((p: any) => `${text(p?.name, 30)} ${Math.round((Number(p?.share) || 0) * 100)}% (e.g. "${text(p?.example, 150)}")`);
  if (!keyword || !videos.length) return c.json({ error: "Nothing to write titles from." }, 400);
  const angle = about ? `\n- The viewer's video: ${about}. Every title must be true to this video and never promise something it doesn't cover.` : "";
  const winning = patterns.length ? `\n- Title patterns among these videos by share of total views: ${patterns.join("; ")}. Lean on the patterns that earn the most views here, and use at least 4 different patterns.` : "";
  const searching = trending.length ? `\n- People are searching YouTube for these right now: ${trending.join(", ")}. Work one of these into at least 4 of the titles, only where it reads naturally; never more than one per title.` : "";
  const prompt = `These are the most-viewed YouTube videos for "${keyword}":
${videos.join("\n")}

Work out what the subject actually is and what makes viewers click. Then write 15 NEW titles for a video about "${keyword}". Rules:${angle}${winning}${searching}
- Be specific to this subject: use real names, features and comparisons from these videos, never filler like "game changer", "revolutionary" or "explored".
- Use what works here: first-person framing ("I tested…", "I replaced…"), a surprising claim, a comparison, or a direct challenge to the viewer.
- Never invent results or statistics. Only use a number if it appears in the list above.
- No emoji, no em or en dashes (use a colon or a period instead), at most one exclamation mark across all titles, Title Case, under 65 characters.
- Every title takes a different angle and must not copy or lightly reword an existing title.
For each, give the existing title whose pattern it borrows.

Reply with JSON only: {"subject": "one sentence on what the subject is", "angles": ["what viewers find interesting", ...], "titles": [{"title": "...", "inspired_by": "..."}, ...]}`;
  try {
    const r = await fetch(`${c.env.GLM_BASE_URL || "https://openrouter.ai/api/v1"}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: c.env.GLM_MODEL || "z-ai/glm-5.3-flash",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.9,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) {
      // A bad key or an empty balance won't fix itself between requests, so skip GLM for a while; anything
      // else (a block page, rate limit or outage) for a minute, so every suggestion doesn't wait on it.
      glmDownUntil = Date.now() + ([401, 402, 403].includes(r.status) ? 10 : 1) * 60_000;
      console.log("GLM error", r.status, (await r.text()).slice(0, 300));
      return c.json({ error: `GLM error ${r.status}`, fallback: true }, 503);
    }
    const j: any = await r.json();
    const content = String(j.choices?.[0]?.message?.content ?? "").replace(/^```(?:json)?\s*|\s*```$/g, "");
    const out = JSON.parse(content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1));
    const titles = (Array.isArray(out.titles) ? out.titles : [])
      .map((t: any) => ({ title: text(t?.title, 120), inspired_by: text(t?.inspired_by, 200) }))
      .filter((t: any) => t.title);
    if (titles.length < 5) throw new Error(`only ${titles.length} titles`);
    return c.json({
      subject: text(out.subject, 300),
      angles: (Array.isArray(out.angles) ? out.angles : []).map((a: unknown) => text(a, 200)).filter(Boolean).slice(0, 8),
      titles,
      model: j.model || c.env.GLM_MODEL || "z-ai/glm-5.3-flash",
    });
  } catch (e: any) {
    console.log("GLM failed", e?.message);
    return c.json({ error: "GLM failed", fallback: true }, 503);
  }
});

app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
