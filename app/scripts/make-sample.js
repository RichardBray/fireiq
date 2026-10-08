// Builds public/data.js: the sample fireIQ shows to signed-out visitors. It runs the app's own Firecrawl
// calls (lib/firecrawl.js) straight against the API, so the sample matches what a live search returns.
//   FIRECRAWL_API_KEY=fc-... bun scripts/make-sample.js ["claude code"]
// Costs roughly 100 credits: Trends for the topic, charts and top videos for its leading keywords, and
// title ideas for the topic and the first two keywords.
import { writeFileSync } from "node:fs";

const KEY = process.env.FIRECRAWL_API_KEY;
if (!KEY) throw new Error("Set FIRECRAWL_API_KEY");
const realFetch = fetch;
globalThis.fetch = (url, init = {}) =>
  String(url).startsWith("/api/firecrawl")
    ? realFetch("https://api.firecrawl.dev/v2" + String(url).slice("/api/firecrawl".length), { ...init, headers: { ...init.headers, authorization: `Bearer ${KEY}` } })
    : realFetch(url, init);
const fc = await import("../public/lib/firecrawl.js");

const seed = (process.argv[2] ?? "claude code").toLowerCase();
const opts = { geo: "US", time: "today 1-m", property: "youtube" };
const log = (s) => console.log(`· ${s}`);
let credits = 0;
const run = async (label, p) => { const r = await p; credits += r.credits ?? 0; log(`${label} (${r.credits ?? 0} credits)`); return r.data; };

const related = { [seed]: await run(`trends for ${seed}`, fc.related(seed, opts)) };
// The same order as the Overview tables: breakouts, then the fastest risers.
const rising = (related[seed].rising ?? []).filter((q) => q.query !== seed);
const byRise = (a, b) => (b.value ?? 0) - (a.value ?? 0);
const keywords = [...rising.filter((q) => q.breakout).sort(byRise).slice(0, 5), ...rising.filter((q) => !q.breakout).sort(byRise).slice(0, 5)].map((q) => q.query);

const interest = {};
const videos = {};
await Promise.all([
  ...keywords.map(async (k) => { interest[k] = await run(`chart for ${k}`, fc.interest([k], opts)).catch((e) => log(`chart for ${k} failed: ${e.message}`)); }),
  ...[seed, ...keywords].map(async (k) => { videos[k] = await run(`videos for ${k}`, fc.youtubeTop(k)).catch((e) => log(`videos for ${k} failed: ${e.message}`)); }),
]);

// Title ideas take the keyword's trending searches, the same list the Title Lab builds.
const trendingFrom = (d, keyword) => {
  const rise = (d?.rising ?? []).filter((q) => q.query.toLowerCase() !== keyword).slice(0, 8).map((q) => ({ query: q.query, label: q.breakout ? "Breakout" : "Rising" }));
  const top = (d?.top ?? []).filter((q) => q.query.toLowerCase() !== keyword && !rise.some((r) => r.query === q.query)).slice(0, 4).map((q) => ({ query: q.query, label: "Most searched" }));
  return [...rise, ...top];
};
const ideas = {};
for (const k of [seed, ...keywords.slice(0, 2)]) {
  related[k] ??= await run(`trends for ${k}`, fc.related(k, opts)).catch(() => null);
  ideas[k] = await run(`title ideas for ${k}`, fc.titleIdeas(k, "", trendingFrom(related[k], k))).catch((e) => log(`title ideas for ${k} failed: ${e.message}`));
}

const prune = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v));
const sample = { seed, opts, savedAt: new Date().toISOString().slice(0, 10), related: prune(related), interest: prune(interest), videos: prune(videos), ideas: prune(ideas) };
writeFileSync(new URL("../public/data.js", import.meta.url), `window.FIREIQ = ${JSON.stringify({ sample })};\n`);
console.log(`Wrote public/data.js · ${Object.keys(sample.interest).length} charts, ${Object.keys(sample.videos).length} video lists, ${Object.keys(sample.ideas).length} title sets · ${credits} credits`);
