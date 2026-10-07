// Local fireIQ server: serves the app and its /api routes. The routes take the viewer's Firecrawl API key
// from the x-firecrawl-key header (set by "Sign in with Firecrawl" or the API key box), falling back to
// FIRECRAWL_API_KEY. Run: bun server.ts  (then open http://localhost:4321)
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { related, interest, youtubeTop, account, type Opts } from "./lib/fireiq";
import { SdkError } from "firecrawl";
import { suggestTitles, relevant } from "./lib/titles";

const PORT = Number(process.env.PORT ?? 4321);
const ROOT = import.meta.dir;
const CACHE = join(ROOT, "data", "cache");
await mkdir(CACHE, { recursive: true });

await import(join(ROOT, "score.js"));
const scoreTitle = (globalThis as any).scoreTitle as (t: string, m: unknown) => { score: number };
const MODEL = JSON.parse((await readFile(join(ROOT, "model.js"), "utf8")).replace(/^window\.TITLE_MODEL = /, "").replace(/;\s*$/, ""));

async function cached<T>(key: object, fresh: boolean, fn: () => Promise<{ data: T; credits: number }>) {
  const file = join(CACHE, createHash("sha1").update(JSON.stringify(key)).digest("hex") + ".json");
  if (!fresh) {
    try {
      return { data: JSON.parse(await readFile(file, "utf8")) as T, credits: 0, cached: true };
    } catch {}
  }
  const r = await fn();
  await writeFile(file, JSON.stringify(r.data));
  return { ...r, cached: false };
}

const opts = (q: URLSearchParams): Opts => ({ geo: q.get("geo") ?? "US", property: q.get("property") ?? "youtube", time: q.get("time") ?? "today 1-m" });

const routes: Record<string, (q: URLSearchParams, key: string, fresh: boolean) => Promise<unknown>> = {
  "/api/related": (q, key, fresh) => {
    const o = opts(q), keyword = q.get("keyword") ?? "";
    return cached({ related: { keyword, ...o } }, fresh, () => related(key, keyword, o));
  },
  "/api/interest": (q, key, fresh) => {
    const o = opts(q), keywords = (q.get("keywords") ?? "").split("|").filter(Boolean);
    return cached({ interest: { keywords, ...o } }, fresh, () => interest(key, keywords, o));
  },
  // The same YouTube scrape as title research, so a keyword's videos and titles share one cache entry.
  "/api/videos": async (q, key, fresh) => {
    const keyword = (q.get("keyword") ?? "").trim();
    if (!keyword) throw new Error("Pick a keyword first");
    const research = await cached({ youtubeTop: keyword.toLowerCase() }, fresh, () => youtubeTop(key, keyword));
    return { data: relevant(keyword, research.data), credits: research.credits, cached: research.cached };
  },
  "/api/titles": async (q, key, fresh) => {
    const keyword = (q.get("keyword") ?? "").trim(), tool = (q.get("tool") ?? "").trim();
    const exclude = (q.get("exclude") ?? "").split("\n").filter(Boolean);
    if (!keyword) throw new Error("Add a keyword first");
    const research = await cached({ youtubeTop: keyword.toLowerCase() }, fresh, () => youtubeTop(key, keyword));
    const out = suggestTitles(keyword, tool, research.data, (t) => scoreTitle(t, MODEL).score, exclude);
    if (!out.studied) throw new Error("None of YouTube's top videos for this keyword were on topic. Try a broader keyword.");
    return { data: out, credits: research.credits, cached: research.cached };
  },
};

// Firecrawl's browser sign-in: the page opens firecrawl.dev/cli-auth, then polls this proxy until the
// sign-in completes and the status endpoint returns an API key. Proxied because firecrawl.dev
// doesn't allow cross-origin calls from the page.
async function authStatus(req: Request) {
  const body = await req.text();
  const r = await fetch("https://www.firecrawl.dev/api/auth/cli/status", { method: "POST", headers: { "content-type": "application/json" }, body });
  return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}

// A viewer who presses Disconnect sends x-fireiq-no-server-key, so the server's own key isn't used for them.
const serverKey = (req: Request) => (req.headers.get("x-fireiq-no-server-key") ? undefined : process.env.FIRECRAWL_API_KEY);

const TYPES: Record<string, string> = { html: "text/html", js: "text/javascript", css: "text/css", json: "application/json", svg: "image/svg+xml" };
const PUBLIC = new Set(["/firecrawl-logo.svg", "/index.html", "/app.js", "/score.js", "/model.js", "/data.js"]);

Bun.serve({
  port: PORT,
  idleTimeout: 255,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/api/auth/status" && req.method === "POST") return authStatus(req);
    if (url.pathname === "/api/me") {
      const browserKey = req.headers.get("x-firecrawl-key");
      const key = browserKey || serverKey(req);
      if (!key) return Response.json({ connected: false, serverKeyAvailable: !!process.env.FIRECRAWL_API_KEY });
      try {
        return Response.json({ connected: true, source: browserKey ? "browser" : "server", ...(await account(key)) });
      } catch (e) {
        const rejected = e instanceof SdkError && (e.status === 401 || e.status === 403);
        return Response.json({ connected: false, rejected, error: (e as Error).message });
      }
    }
    const route = routes[url.pathname];
    if (route) {
      const key = req.headers.get("x-firecrawl-key") || serverKey(req) || "";
      if (!key) return Response.json({ error: "Connect Firecrawl to run live research.", auth: "missing" }, { status: 401 });
      try {
        return Response.json(await route(url.searchParams, key, url.searchParams.get("fresh") === "1"));
      } catch (e) {
        if (e instanceof SdkError && (e.status === 401 || e.status === 403)) return Response.json({ error: "Firecrawl rejected this API key.", auth: "rejected" }, { status: 401 });
        if (e instanceof SdkError && e.status === 402) return Response.json({ error: "This Firecrawl account is out of credits.", auth: "credits" }, { status: 402 });
        return Response.json({ error: (e as Error).message }, { status: 502 });
      }
    }
    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    if (!PUBLIC.has(path)) return new Response("Not found", { status: 404 });
    return new Response(Bun.file(join(ROOT, path)), { headers: { "content-type": TYPES[path.split(".").pop()!] } });
  },
});
console.log(`fireIQ on http://localhost:${PORT}`);
