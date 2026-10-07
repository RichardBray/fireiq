// Title suggestions, following the title-research skill's steps:
// 1. research: the most-viewed YouTube videos for the keyword (youtubeTop in firecrawl.js)
// 2. patterns: which title patterns those videos use, weighted by their views
// 3. generate: titles written by Firecrawl's language model (titleIdeas), or, if that fails, the
//    templates below filled in for the keyword, plus the top titles adapted to the viewer's tool
// 4. rank: score every candidate with title-score, then pick 5 with different patterns. Picks are
//    sampled from the strongest candidates, so "Suggest 5 more" gives new titles, not the same 5.
const DETECTORS = {
  "How to": /\bhow to\b/i,
  "Best": /\bbest\b/i,
  "Versus": /\bvs\.?\b|\bversus\b/i,
  "Free": /\bfree\b/i,
  "This is amazing": /^this\b|\b(is|are) (amazing|insane|insanely|incredible|crazy|so good|changing|the future)\b|\bjust (changed|got|killed|broke)\b/i,
  "I did X": /^i\b|\bi (built|tried|tested|replaced|made|used|switched|quit|stopped|spent)\b/i,
  "You": /\byou('re| are|r)?\b/i,
  "Stop doing X": /\bstop\b|\bdon'?t\b|\bnever\b|\bmistakes?\b/i,
  "Number": /^\d+\b|\b\d+\+?\s+(features|tips|ways|things|tools|reasons|mistakes|tricks|minutes|hours|days)\b|\d+%|\d+x\b/i,
  "Tutorial": /\b(tutorial|guide|course|beginners?|explained|full|step[- ]by[- ]step)\b/i,
  "Year": /\b20\d\d\b/,
  "Brackets": /[(\[]/,
  "Question": /\?/,
};
// "I did X" and "You" are always in the pool even when the field doesn't use them: title-score's
// minimal-pair tests found these framings move vidIQ's score the most.
const LEVERS = new Set(["I did X", "You"]);
const ACRONYMS = new Set(["ai", "llm", "llms", "mcp", "api", "seo", "ui", "ux", "gpt", "cli", "sdk", "ide", "pdf", "rag", "lm"]);
const GENERIC = new Set(["alternative", "alternatives", "tutorial", "guide", "best", "free", "tool", "tools", "review", "vs", "how", "ai", "app", "for", "the", "a", "to", "with", "and", "in", "of"]);
const STOP = new Set([...GENERIC, "an", "or", "on", "is", "it", "this", "that", "youtube", "full", "new", "my", "your", "you", "i", "get", "more", "views", "honest", "amazing", "better", "than", "lifetime", "deal", "live", "features", "course", "beginners", "explained", "use", "using", "what", "why", "which", "run", "running", "local", "locally", "model", "models", "install", "setup", "windows", "mac", "easy", "step", "steps", "ultimate", "complete", "ways", "make", "build", "now", "here", "every", "everything", "just", "can", "will", "top", "easiest", "fastest", "official", "growth", "pro", "version", "max", "learn", "become", "minutes", "hours", "under", "changed", "forever", "instead", "people", "getting", "started", "compared"]);
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Keep on-topic, mostly-English results: at least one of the keyword's distinctive words must appear.
export function relevant(keyword, videos) {
  const words = keyword.toLowerCase().split(/\s+/).filter((w) => w && !["the", "a", "for", "to", "with", "and", "of", "in"].includes(w));
  const need = words.filter((w) => !GENERIC.has(w));
  const req = need.length ? need : words;
  return videos.filter((v) => {
    const letters = v.title.replace(/[^\p{L}]/gu, "");
    const latin = letters.replace(/[^A-Za-z]/g, "").length / Math.max(1, letters.length);
    return latin > 0.7 && req.some((w) => new RegExp(`\\b${escRe(w)}`, "i").test(v.title));
  });
}
function casing(keyword, real) {
  const seen = new Map();
  for (const r of real)
    for (const w of r.title.match(/[A-Za-z0-9][A-Za-z0-9.+#-]*/g) ?? []) {
      const m = seen.get(w.toLowerCase()) ?? new Map();
      m.set(w, (m.get(w) ?? 0) + 1);
      seen.set(w.toLowerCase(), m);
    }
  return keyword.split(/\s+/).filter(Boolean).map((w) => {
    if (ACRONYMS.has(w.toLowerCase()))
      return w.toUpperCase();
    const mixed = [...(seen.get(w.toLowerCase())?.entries() ?? [])].filter(([f]) => /[a-z]/.test(f) && /[A-Z]/.test(f.slice(1)));
    // A lowercase-first brand spelling ("vidIQ") is deliberate; "VidIQ" is usually just title case.
    const brand = mixed.filter(([f]) => /^[a-z]/.test(f));
    if (brand.length)
      return brand.sort((a, b) => b[1] - a[1])[0][0];
    if (mixed.length)
      return mixed.sort((a, b) => b[1] - a[1])[0][0];
    return w[0].toUpperCase() + w.slice(1);
  }).join(" ");
}
// Products other videos name alongside the keyword ("TubeBuddy" for vidIQ): recurring capitalised words.
function competitors(keyword, real) {
  const own = new Set(keyword.toLowerCase().split(/\s+/));
  const counts = new Map();
  for (const r of real)
    for (const w of new Set(r.title.match(/\b[A-Z][A-Za-z0-9]+\b/g) ?? [])) {
      const l = w.toLowerCase();
      if (own.has(l) || STOP.has(l) || /^20\d\d$/.test(w) || ACRONYMS.has(l))
        continue;
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  return [...counts.entries()].filter(([w, n]) => n >= 3 || (n >= 2 && /[A-Z]/.test(w.slice(1)))).sort((a, b) => b[1] - a[1]).map(([w]) => w);
}
export function patterns(real) {
  const total = real.reduce((n, v) => n + v.views, 0) || 1;
  return Object.entries(DETECTORS)
    .map(([name, re]) => { const hits = real.filter((v) => re.test(v.title)); return { name, videos: hits.length, share: hits.reduce((n, v) => n + v.views, 0) / total }; })
    .filter((p) => p.videos > 0)
    .sort((a, b) => b.share - a.share);
}
const an = (w) => (/^[A-Z]{2,}/.test(w) ? /^[AEFHILMNORSX]/.test(w) : /^[aeiou]/i.test(w)) ? `an ${w}` : `a ${w}`;
const title = (s) => s.replace(/\b([a-z])/g, (m) => m.toUpperCase());
// "jev vs llm": a comparison, so the templates talk about both sides instead of treating the whole
// query as one product name.
function versusTemplates(A, B, T, Y) {
  // A bare acronym on the right is usually a category ("LLM"), which reads better as a plural.
  const Bs = /^[A-Z]{2,5}$/.test(B) ? `${B}s` : B;
  return [
    ["How to", [`How To Choose Between ${A} And ${B}`, `When To Use ${A} Instead Of ${B}`]],
    ["Best", [`${A} vs ${B}: Which Is Best In ${Y}?`, `The Best Use For ${A} (That ${B} Can't Do)`]],
    ["Versus", [`${A} vs ${B}: Which Should You Use?`, `${A} vs ${B} (Honest Comparison)`, `I Tested ${A} vs ${B} On Real Tasks`]],
    ["Free", [`${A} vs ${B}: Which Is Cheaper To Run?`]],
    ["This is amazing", [`${A} Just Beat ${Bs}`, `${A} Is Not ${an(B)} (And That's Why It Wins)`]],
    ["I did X", [`I Replaced ${Bs} With ${A}`, `I Tested ${A} Against ${Bs} For 30 Days`, T && `I Built ${T} With ${A} Instead Of ${B}`]],
    ["You", [`You're Using ${Bs} When You Need ${A}`, `You Don't Need ${an(B)} For This (Use ${A})`]],
    ["Stop doing X", [`Stop Using ${Bs} For Everything. Try ${A}`]],
    ["Number", [`${A} vs ${B}: 5 Differences That Matter`, `${A} Is 10x Faster Than ${an(B)}`]],
    ["Tutorial", [`${A} vs ${B} Explained In 10 Minutes`]],
    ["Question", [`Is ${A} Better Than ${an(B)}?`, `Why Is Everyone Switching From ${Bs} To ${A}?`]],
  ];
}
// "how to scrape a website": a task, so it's framed as one rather than as a product to "use".
function taskTemplates(task, T, Y) {
  const t = title(task);
  return [
    ["How to", [`How To ${t} (Step By Step)`, `How To ${t} For FREE In ${Y}`, T && `How To ${t} With ${T}`]],
    ["Best", [`The Best Way To ${t} In ${Y}`, `The Fastest Way To ${t}`]],
    ["Free", [`How To ${t} For FREE`]],
    ["This is amazing", [`This Is The Easiest Way To ${t}`]],
    ["I did X", [`I Found The Easiest Way To ${t}`, T && `I Let ${T} ${t} For Me`]],
    ["You", [`You're Doing It Wrong: How To ${t}`]],
    ["Stop doing X", [`Stop Wasting Hours. ${t} In Minutes`]],
    ["Number", [`5 Ways To ${t} That Actually Work`, `${t} In Under 10 Minutes`]],
    ["Tutorial", [`How To ${t}: Full Beginner Guide`]],
    ["Question", [`What's The Best Way To ${t}?`]],
  ];
}
// A long phrase that isn't a name ("ai agents for small business"): framed as a topic.
function topicTemplates(K, T, Y) {
  return [
    ["How to", [`How To Get Started With ${K}`]],
    ["Best", [`The Best Guide To ${K} In ${Y}`]],
    ["This is amazing", [`${K} Is Changing Everything`]],
    ["I did X", [`I Spent 30 Days On ${K}. Here's What Worked`, T && `I Used ${T} For ${K}`]],
    ["You", [`You're Thinking About ${K} Wrong`]],
    ["Number", [`7 ${K} Lessons Nobody Tells You`]],
    ["Tutorial", [`${K} Explained In 10 Minutes`, `${K}: Everything You Need To Know`]],
    ["Question", [`Is ${K} Worth It In ${Y}?`]],
  ];
}
function templates(K, base, C, T, Y) {
  const alt = !!base;
  const B = base ?? K;
  const S = alt && T ? T : K;
  return [
    ["How to", [`How To Use ${K} For FREE (${Y})`, `How To Actually Use ${K} (Step By Step)`, T && !alt && `How To Use ${K} With ${T}`, alt && T && `How To Use ${T} As A FREE ${B} Alternative`, `How I Use ${S} To Save Hours Every Week`]],
    ["Best", [alt ? `The Best FREE ${K} In ${Y}` : `The Best ${K} Setup In ${Y}`, alt && T && `${T} Is The Best ${K} (And It's Free)`, `The Best ${S} Tips Nobody Talks About`]],
    ["Versus", [C && !alt && `${K} vs ${C}: Which Is Actually Better?`, alt && T && `${T} vs ${B}: Don't Pick WRONG`, alt && C && T && `${T} vs ${C} vs ${B} (Honest Comparison)`, !alt && C && `I Tested ${K} vs ${C} For A Week`]],
    ["Free", [alt ? `Stop Paying For ${B}. This Is FREE` : `${K} Just Got A FREE Upgrade`, alt && T ? `Get ${B} Features For FREE With ${T}` : `Everything ${K} Can Do For FREE`, `The FREE ${alt ? B + " Alternative" : K + " Setup"} Nobody Uses`]],
    ["This is amazing", [alt && T ? `This FREE ${B} Alternative Is INSANE` : `This ${K} Trick Is INSANE`, `${S} Just Changed Everything`, alt && T && `${T} Just Replaced ${B}`, `${S} Is Insanely Good Now`]],
    ["I did X", [alt && T ? `I Stopped Paying For ${B} (${T} Does It Free)` : `I Tried ${K} For 30 Days`, alt && T ? `I Replaced ${B} With ${T} (And It's Free)` : T ? `I Built My Own ${K} With ${T}` : `I Built Something INSANE With ${K}`, `I Spent 100 Hours In ${S}. Here's What Works`]],
    ["You", [alt ? `You're Paying For ${B} For No Reason` : `You're Using ${K} Wrong`, `Your ${alt ? B : K} Workflow Is Costing You Hours`, alt && `You Don't Need ${B} Anymore`]],
    ["Stop doing X", [alt ? `Stop Paying For ${B} In ${Y}` : C ? `Stop Using ${C}. Use ${K} Instead` : `Stop Making These ${K} Mistakes`, `5 ${alt ? B : K} Mistakes Killing Your Growth`]],
    ["Number", [alt ? `5 FREE ${B} Alternatives That Actually Work` : `7 ${K} Tips Nobody Tells You`, `10x Your Results With ${S}`, `${S} In 10 Minutes`]],
    ["Tutorial", [alt && T ? `${T} As A ${B} Alternative: Full Tutorial` : `${K} Tutorial For Beginners (${Y})`, `${S} Full Course: Zero To Pro`, `The Only ${S} Guide You Need`]],
    ["Question", [alt && T ? `Is ${T} Better Than ${B}?` : `Is ${K} Worth It In ${Y}?`, `Why Is Everyone Switching To ${S}?`]],
  ];
}
// Rewrite a top title for this video: bring its year up to date and swap the product it names for the
// viewer's tool. Without a tool there's nothing to swap, so it would just copy the original.
function adapt(v, keyword, K, base, C, T, Y) {
  if (!T)
    return null;
  let t = v.title.replace(/\b20\d\d\b/g, String(Y)).replace(/\s*[|–—-]\s*(honest review|official.*|full video)$/i, "").trim();
  const before = t;
  const target = base && C ? C : base ?? C;
  t = target ? t.replace(new RegExp(`\\b${escRe(target)}\\b`, "i"), T) : t.replace(new RegExp(escRe(keyword), "i"), T);
  if (t === before || t.length > 80)
    return null;
  return t.replace(new RegExp(escRe(keyword), "i"), K);
}
export function suggestTitles(keyword, tool, videos, score, exclude = [], ideas = null, trending = [], year = new Date().getFullYear()) {
  const real = relevant(keyword, videos);
  const pats = patterns(real);
  const share = new Map(pats.map((p) => [p.name, p.share]));
  const alt = keyword.trim().match(/^(.*?)\s+alternatives?$/i);
  const K = casing(keyword, real);
  const base = alt ? casing(alt[1], real) : null;
  const C = competitors(alt ? alt[1] : keyword, real)[0] ?? null;
  const T = tool.trim() || null;
  const top = (p) => real.filter((v) => DETECTORS[p]?.test(v.title)).sort((a, b) => b.views - a.views)[0];
  // A title that contains a phrase people are searching for right now ranks higher. This is kept apart from
  // title-score, which approximates vidIQ's own number and stays unchanged.
  const BONUS = { Breakout: 4, Rising: 3, "Most searched": 2 };
  // Filler words don't count, so "I Tried Claude Code For Free" matches "how to get claude code for free".
  const FILLER = new Set(["how", "to", "get", "the", "a", "an", "for", "is", "does", "do", "what", "why", "with", "and", "of", "in", "on", "use", "using", "vs", "my", "your"]);
  const wordSet = (t) => new Set((t.toLowerCase().match(/[a-z0-9.+#]+/g) ?? []).filter((w) => !FILLER.has(w)));
  const kw = keyword.toLowerCase().trim();
  const searchMatch = (title) => {
    const have = wordSet(title);
    // A trending phrase must add something beyond the keyword itself to count as a match.
    const extra = (q) => [...wordSet(q)].some((w) => !wordSet(kw).has(w));
    const hit = trending.find((t) => t.query.toLowerCase() !== kw && extra(t.query) && [...wordSet(t.query)].every((w) => have.has(w)));
    return hit ? { query: hit.query, label: hit.label, bonus: BONUS[hit.label] ?? 2 } : null;
  };
  const rank = (s) => s.score + (s.match?.bonus ?? 0);
  const pool = [];
  const add = (title, pattern, src) => {
    title = title.replace(/\s+/g, " ").trim();
    const l = title.toLowerCase();
    if (title.length > 80 || pool.some((s) => s.title.toLowerCase() === l) || real.some((v) => v.title.toLowerCase() === l))
      return;
    pool.push({ title, pattern, score: score(title), match: searchMatch(title), inspired_by: src?.title ?? "", inspired_url: src?.url || null, inspired_views: src?.views || null });
  };
  const vs = keyword.trim().match(/^(.+?)\s+(?:vs\.?|versus|or)\s+(.+)$/i);
  const task = keyword.trim().match(/^how (?:to|do i|can i)\s+(.+)$/i);
  const words = keyword.trim().split(/\s+/).length;
  const set = vs ? versusTemplates(casing(vs[1], real), casing(vs[2], real), T, year)
    : task ? taskTemplates(task[1], T, year)
      : !alt && words >= 4 ? topicTemplates(K, T, year)
        : templates(K, base, C, T, year);
  // Titles written by the language model come first; the templates only fill in when it returned too few.
  const patternOf = (t) => Object.keys(DETECTORS).find((p) => !["Year", "Brackets"].includes(p) && DETECTORS[p].test(t)) ?? "Fresh angle";
  const findVideo = (title) => { const l = title.toLowerCase().slice(0, 40); return real.find((v) => v.title.toLowerCase().startsWith(l)) ?? videos.find((v) => v.title.toLowerCase().startsWith(l)); };
  for (const i of ideas?.titles ?? []) {
    const src = findVideo(i.inspired_by);
    add(i.title.replace(/!+/g, "!"), patternOf(i.title), src ?? { title: i.inspired_by, url: "", views: 0 });
  }
  const fromIdeas = pool.length;
  if (fromIdeas < 8) {
    for (const [p, list] of set) {
      if (!share.has(p) && !LEVERS.has(p))
        continue;
      for (const t of list)
        if (t)
          add(t, p, top(p));
    }
    for (const v of real.slice(0, 15)) {
      const t = adapt(v, keyword, K, base, C, T, year);
      if (t)
        add(t, "Adapted top video", v);
    }
  }
  // Weight each candidate by its score and by the share of the field's views its pattern earns.
  const weight = (s) => Math.exp((rank(s) - 80) / 5) * (1 + 3 * (share.get(s.pattern) ?? (s.pattern === "Adapted top video" ? 0.5 : 0.1)));
  const unseen = pool.filter((s) => !exclude.some((e) => e.toLowerCase() === s.title.toLowerCase()));
  const candidates = (unseen.length >= 5 ? unseen : pool).sort((a, b) => rank(b) - rank(a)).slice(0, 18);
  const picked = [];
  while (picked.length < 5 && candidates.length) {
    const avail = candidates.filter((s) => !picked.some((p) => p.pattern === s.pattern));
    const from = avail.length ? avail : candidates;
    let r = Math.random() * from.reduce((n, s) => n + weight(s), 0);
    const s = from.find((c) => (r -= weight(c)) <= 0) ?? from[0];
    picked.push(s);
    candidates.splice(candidates.indexOf(s), 1);
  }
  return { titles: picked.sort((a, b) => rank(b) - rank(a)), trending, patterns: pats.slice(0, 6), top: real.slice(0, 8), studied: real.length, poolSize: pool.length,
    source: fromIdeas >= 5 ? "ideas" : "templates", subject: ideas?.subject ?? "", angles: ideas?.angles ?? [] };
}
