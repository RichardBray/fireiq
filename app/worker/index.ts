// fireIQ's Worker. It holds the viewer's Firecrawl key in an encrypted HttpOnly cookie, so page scripts
// can never read it, and forwards only the Firecrawl calls the app makes. Static files come from public/.
import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";

type Env = { COOKIE_SECRET: string; ASSETS: Fetcher };
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
const FEATURES = new Set(["Chrome extension", "Channel audits", "Competitor tracking", "Keyword alerts", "More vidIQ-style features"]);
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

app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
