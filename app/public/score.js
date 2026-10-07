// Port of the title-score skill's scripts/score.py (github.com/RichardBray/skills); model.js holds its fitted weights.
(function (root) {
  const set = (s) => new Set(s.split(" "));
  const CURIOSITY = set("secret secrets shocking insane crazy weird strange hidden truth revealed reveal exposed mystery nobody wrong stop quit destroys beats actually really forever everything never always surprising brutal dangerous broken dead killed worst best finally");
  const NARRATIVE = set("i my me we our built tested tried replaced cut quit shipped rebuilt broke fixed made spent");
  const SECOND_PERSON = set("you your you're youre yours");
  const AUDIENCE = set("beginners beginner tutorial guide explained learn walkthrough course basics crash intro introduction");
  const DRY_OPENERS = ["understanding ", "introduction to ", "an introduction", "overview of ", "building a ", "building an ", "getting started with ", "working with ", "exploring ", "a comprehensive"];
  const DEPTH_PHRASES = ["deep dive", "from scratch", "full config", "walkthrough", "under the hood", "internals", "from zero"];
  const CONFLICT_PHRASES = ["gets wrong", "went badly", "ruins", "leaking", "is slow", "slower than", "don't know", "doesn't work", "is broken", "stopped using", "nobody talks about", "nobody told you"];
  const EMOTION_PATTERNS = {
    e_comparison: /\b(vs|versus|compared|comparison|better than|instead of|or)\b/,
    e_credibility: /\b(i|we|my|our|actually|really|honest|truth|proven|tested|years?|experience|senior|staff|expert)\b/,
    e_curiosity: /\b(why|how|what|secret|hidden|nobody|surprising|weird|reason|happens?|discovered)\b/,
    e_desire: /\b(best|fastest|easiest|perfect|ultimate|free|10x|faster|simple|clean|beautiful|dream)\b/,
    e_extreme: /\b(insane|crazy|never|always|every|everything|entire|completely|totally|forever|100x|worst|destroys?)\b/,
    e_list: /^\s*\d+\b|\b\d+\s+(things|ways|tips|tricks|reasons|mistakes|signs|steps|lessons|patterns|tools|levers)\b/,
    e_negativity: /\b(wrong|broken|bad|fail\w*|slow|useless|stop|quit|mistake|dead|worse|hate|regret\w*|badly|dangerous)\b/,
    e_question: /\?/,
    e_time: /\b(\d+\s*(seconds?|minutes?|hours?|days?|weeks?|months?|years?)|in 20\d\d|now|today|finally|still|already|before)\b/,
  };
  const WORD_RE = /[A-Za-z0-9'%.\-]+/g;
  const count = (wl, vocab) => wl.filter((w) => vocab.has(w)).length;
  const b = (x) => (x ? 1 : 0);

  function features(title) {
    const t = title.trim();
    const low = t.toLowerCase();
    const words = t.match(WORD_RE) || [];
    const wl = words.map((w) => w.toLowerCase());
    const n = words.length || 1;
    const letters = [...t].filter((c) => c.toLowerCase() !== c.toUpperCase());
    const f = {
      len: Math.min(t.length, 90) / 90,
      stub: b(words.length <= 2),
      words: Math.min(n, 16) / 16,
      number: b(/\d/.test(t)),
      curiosity: Math.min(count(wl, CURIOSITY), 3) / 3,
      narrative: Math.min(count(wl, NARRATIVE), 3) / 3,
      second_person: Math.min(count(wl, SECOND_PERSON), 2) / 2,
      audience: Math.min(count(wl, AUDIENCE), 2) / 2,
      question: b(t.includes("?")),
      colon: b(t.includes(":")),
      parens: b(t.includes("(")),
      bang: Math.min(t.split("!").length - 1, 3) / 3,
      caps: letters.length ? letters.filter((c) => c === c.toUpperCase()).length / letters.length : 0,
      dry: b(DRY_OPENERS.some((o) => low.startsWith(o))),
      vs: b(/\b(vs|versus)\b/.test(low)),
      depth: b(DEPTH_PHRASES.some((p) => low.includes(p))),
      conflict: Math.min(CONFLICT_PHRASES.filter((p) => low.includes(p)).length, 2) / 2,
      accusation: b(/\b(your|you're|youre|you)\b.{0,40}\b(wrong|broken|slow|useless|liability|too many|too much|worse|fail\w*|don't|probably)\b/.test(low)),
      first_person_result: b(/\bi\b.{0,40}\b(cut|killed|took|built|made|rewrote|replaced|deleted|shipped|trained|spent|ran|got|fixed|broke)\b/.test(low)),
      explained_suffix: b(low.replace(/[ ?!.]+$/, "").endsWith("explained")),
    };
    for (const [k, re] of Object.entries(EMOTION_PATTERNS)) f[k] = b(re.test(low));
    return f;
  }

  function ngrams(title) {
    const wl = (title.match(WORD_RE) || []).map((w) => w.toLowerCase());
    const g = new Set(wl.map((w) => "w:" + w));
    for (let i = 0; i + 1 < wl.length; i++) g.add(`b:${wl[i]} ${wl[i + 1]}`);
    const s = " " + title.toLowerCase().trim() + " ";
    for (const n of [3, 4, 5]) for (let i = 0; i + n <= s.length; i++) g.add("c:" + s.slice(i, i + n));
    return g;
  }

  function scoreTitle(title, model) {
    const coef = model.coef;
    const f = features(title);
    const contributions = {};
    let raw = model.intercept;
    for (const [k, v] of Object.entries(f)) {
      if (!(k in coef)) continue;
      const c = coef[k] * v;
      raw += c;
      if (Math.abs(c) >= 0.5) contributions[k] = Math.round(c * 100) / 100;
    }
    let vocab = 0;
    for (const k of ngrams(title)) if (k in coef) vocab += coef[k];
    raw += vocab;
    return {
      title: title.trim(),
      score: Math.round(Math.max(0, Math.min(100, raw))),
      chars: title.trim().length,
      words: (title.match(WORD_RE) || []).length,
      contributions,
      vocab: Math.round(vocab * 100) / 100,
    };
  }

  root.scoreTitle = scoreTitle;
})(typeof window !== "undefined" ? window : globalThis);
