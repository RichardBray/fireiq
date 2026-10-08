import * as fc from "./lib/firecrawl.js";
import { suggestTitles, relevant } from "./lib/titles.js";

const MODEL = window.TITLE_MODEL;
const SAMPLE = window.FIREIQ?.sample;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => (n == null ? "–" : n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(n));
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const ARROW = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;
const ICON = {
  fire: `<svg viewBox="0 0 24 24"><path d="M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-3.5 2-5 1 1.5 2 2 3 2 0-2.5-1-4.5 0-7z"/></svg>`,
  trend: `<svg viewBox="0 0 24 24"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>`,
  search: `<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`,
  play: `<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="3"/><path d="m10 9.5 4.5 2.5-4.5 2.5z" fill="currentColor"/></svg>`,
};

const state = {
  tab: "foryou",
  result: null,
  selected: null,
  insight: {},
  filter: "all",
  kwMode: "rising",
  compare: [],
  comparison: null,
  videos: {},
  videoKw: null,
  vidMode: "hot",
  jobs: { total: 0, done: 0, label: "" },
  open: null,
};

// ---------- data ----------
// Firecrawl calls go through the Worker; an auth problem refreshes the nav so it shows what's wrong.
async function call(p) {
  try { return await p; }
  catch (e) { if (e.auth && e.auth !== "sample") checkConnection(); throw e; }
}

// Signed out, every tab runs on a saved sample (public/data.js, made by scripts/make-sample.js), so
// people can try fireIQ before connecting. Anything outside the sample asks them to sign in.
const fromSample = (kind, key) => {
  const data = key && SAMPLE?.[kind]?.[key.toLowerCase()];
  if (data) return Promise.resolve({ data, credits: 0, cached: true });
  const e = new Error("Sign in to research beyond the sample.");
  e.auth = "sample";
  return Promise.reject(e);
};
const api = {
  related: (kw, o) => (connected() ? fc.related(kw, o) : fromSample("related", kw)),
  interest: (kws, o) => (connected() ? fc.interest(kws, o) : fromSample("interest", kws.length === 1 && kws[0])),
  youtubeTop: (kw) => (connected() ? fc.youtubeTop(kw) : fromSample("videos", kw)),
  titleIdeas: (kw, tool, trending) => (connected() ? fc.titleIdeas(kw, tool, trending) : fromSample("ideas", kw)),
};

// ---------- account ----------
// /api/me checks the cookie's key with Firecrawl, so the nav reflects what actually works.
async function checkConnection() {
  state.conn = { checking: true };
  renderAccount();
  try { state.conn = await (await fetch("/api/me")).json(); }
  catch { state.conn = { connected: false, error: "Can't reach fireIQ." }; }
  renderAccount();
  // Results from the sample and live ones never mix: switching either way starts over.
  const reset = () => { related.clear(); sugReqs.clear(); tops.clear(); state.videos = {}; state.sug = null; };
  if (state.conn.connected) {
    if (state.result && !state.result.live) { reset(); research(parseSeeds($("q").value), opts(), true); }
    else render();
  } else if (state.result?.live) {
    reset(); $("q").value = DEFAULT_TOPIC; research([DEFAULT_TOPIC], opts(), true);
  }
  renderBar();
  return state.conn;
}
const SIGN_IN = `<button class="btn" data-connect="signin"><img class="fcmark" src="firecrawl-logo.svg" alt="">Sign in<span class="long"> with Firecrawl</span></button>`;
function renderAccount() {
  const c = state.conn || { checking: true };
  const credits = c.remainingCredits != null ? `${c.remainingCredits.toLocaleString()} credits left` : "";
  $("account").innerHTML = c.checking
    ? `<span class="who"><span class="spin"></span>Checking Firecrawl…</span>`
    : c.connected
      ? `<span class="who"><span class="dot"></span><b>${esc(c.teamName && c.teamName !== "API key" ? c.teamName : "Connected")}</b><span class="k">${credits}</span></span><button class="btn ghost" id="signOut">Disconnect</button>`
      : `<span class="who off"><span class="dot"></span>${c.rejected ? "Key rejected" : "Not connected"}</span>${SIGN_IN}`;
  $("account").onclick = async (e) => {
    if (e.target.closest("#signOut")) { await fetch("/api/auth/logout", { method: "POST" }); checkConnection(); }
  };
}
const connected = () => !!state.conn?.connected;
// One bar above the nav. Signed out it says the page is showing the sample; signed in it's a closable
// work-in-progress note. It stays hidden until the connection check settles, so it doesn't flicker.
function renderBar() {
  const bar = $("wip"), c = state.conn;
  if (!c || c.checking) return;
  const feedback = `<a href="about#feedback">Share feedback</a>`;
  if (!c.connected && SAMPLE) {
    bar.innerHTML = `<span><b>Sample data.</b> You're exploring a saved run for “${esc(SAMPLE.seed)}”. <button class="linkbtn" data-connect="signin">Sign in</button> to research your own topics · ${feedback}</span>`;
    bar.hidden = false;
    return;
  }
  bar.innerHTML = `<span><b>Work in progress.</b> fireIQ is still being built, so features may change. <a href="about">What is fireIQ?</a> · ${feedback}</span><button id="wipClose" aria-label="Close" title="Close">✕</button>`;
  bar.hidden = store.get("fireiq.wipClosed", false);
  $("wipClose").onclick = () => { bar.hidden = true; store.set("fireiq.wipClosed", true); };
}
function connectCard(reason) {
  if (reason === "sample") return `<div class="connect"><img src="firecrawl-logo.svg" alt="" class="big"><h3>Sign in to go beyond the sample</h3><p>Signed out, fireIQ only has sample data for “${esc(SAMPLE?.seed)}” and a few of its keywords. Connect Firecrawl to research anything, on your own account. The free plan includes 1,000 credits a month.</p>
    <div class="acts" style="flex-direction:column;align-items:center"><button class="btn" data-connect="signin"><img class="fcmark" src="firecrawl-logo.svg" alt="">Sign in with Firecrawl</button><button class="linkish" data-connect="key">Use an API key instead</button></div></div>`;
  const rejected = reason === "rejected" || state.conn?.rejected;
  const title = reason === "credits" ? "Your Firecrawl account is out of credits" : rejected ? "Firecrawl rejected your API key" : "Connect Firecrawl to run live research";
  const body = reason === "credits" ? "Add credits or upgrade your plan on firecrawl.dev, then try again."
    : rejected ? "That key no longer works. Sign in again to connect."
    : "fireIQ runs every search on your own Firecrawl account. The free plan includes 1,000 credits a month, and a search costs about 5 credits per topic.";
  return `<div class="connect"><img src="firecrawl-logo.svg" alt="" class="big"><h3>${title}</h3><p>${body}</p>
    ${reason === "credits" ? `<a class="btn" href="https://www.firecrawl.dev/app" target="_blank" rel="noopener" style="display:inline-flex;align-items:center">Open Firecrawl</a>`
      : `<div class="acts" style="flex-direction:column;align-items:center"><button class="btn" data-connect="signin"><img class="fcmark" src="firecrawl-logo.svg" alt="">Sign in with Firecrawl</button><button class="linkish" data-connect="key">Use an API key instead</button></div>`}</div>`;
}
// Pointing at a keyword's "Suggest titles" button starts its titles.
document.addEventListener("pointerover", (e) => { const b = e.target.closest?.("[data-lab]"); if (b) prefetchSug(b.dataset.lab); });
document.addEventListener("click", (e) => {
  const c = e.target.closest("[data-connect]");
  if (c) c.dataset.connect === "key" ? openKey() : signIn();
});
function modal(html) {
  $("dialog").innerHTML = html;
  $("modal").classList.add("open");
}
function closeModal() { $("modal").classList.remove("open"); signInRun = null; }
$("modal").onclick = (e) => { if (e.target === $("modal") || e.target.closest("[data-close]")) closeModal(); };
const REMEMBER = `<label class="remember"><input type="checkbox" id="remember" checked> Keep me signed in on this device</label>`;
function openKey() {
  modal(`<h3>Use a Firecrawl API key</h3><p>Create one at <a href="https://www.firecrawl.dev/app/api-keys" target="_blank" rel="noopener">firecrawl.dev/app/api-keys</a>. It's stored encrypted in a cookie that this page's scripts can't read, and only used to call Firecrawl. A separate key for fireIQ is easiest to revoke.</p>
    <form id="keyForm"><input id="keyIn" placeholder="fc-..." autocomplete="off" spellcheck="false">${REMEMBER}<div class="err" id="keyErr"></div><div class="row"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn" type="submit">Connect</button></div></form>`);
  $("keyIn").focus();
  $("keyForm").onsubmit = async (e) => {
    e.preventDefault();
    const r = await fetch("/api/auth/key", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey: $("keyIn").value.trim(), remember: $("remember").checked }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { $("keyErr").textContent = j.error || "Couldn't connect."; $("keyIn").style.borderColor = "var(--red)"; return; }
    closeModal(); checkConnection();
  };
}

// Firecrawl's browser sign-in (the flow its CLI uses): PKCE challenge in the URL, then the Worker polls
// for the key and keeps it in the cookie, so the page only learns that sign-in finished.
let signInRun = null;
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function signIn() {
  const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
  const session = [...rand(32)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const verifier = b64url(rand(32));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  window.open(`https://www.firecrawl.dev/cli-auth?code_challenge=${challenge}&source=coding-agent#session_id=${session}`, "fireiq-auth", "width=520,height=720");
  const run = (signInRun = {});
  modal(`<h3>Finish signing in</h3><p>Sign in or create a free account in the Firecrawl window. This updates by itself when you're done.</p>
    ${REMEMBER}<div class="status" style="margin:14px 0 16px"><span class="spin"></span>Waiting for Firecrawl…</div><div class="row"><button class="linkish" data-connect="key" style="margin-right:auto">Use an API key instead</button><button class="btn ghost" data-close>Cancel</button></div>`);
  const until = Date.now() + 10 * 60 * 1000;
  while (signInRun === run && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const remember = $("remember")?.checked ?? true;
      const r = await (await fetch("/api/auth/poll", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session_id: session, code_verifier: verifier, remember }) })).json();
      if (r.status === "complete") { closeModal(); checkConnection(); return; }
    } catch {}
  }
}
function job(label) {
  state.jobs.total++; state.jobs.label = label; renderStatus();
  return () => { state.jobs.done++; if (state.jobs.done >= state.jobs.total) state.jobs = { total: 0, done: 0, label: "" }; renderStatus(); };
}

function merge(related, seeds) {
  const cands = {};
  for (const seed of seeds) {
    const d = related[seed];
    if (!d || d.error || d.loading) continue;
    for (const kind of ["rising", "top"]) {
      for (const q of d[kind] || []) {
        const c = (cands[q.query] ??= { query: q.query, seeds: [], rising: null, top: null, breakout: false, rise_value: 0, explore_url: q.explore_url });
        if (!c.seeds.includes(seed)) c.seeds.push(seed);
        if (kind === "top") c.top = q.value;
        else { c.rising = q.formatted_value ?? q.value; c.breakout ||= !!q.breakout; c.rise_value = Math.max(c.rise_value, q.value || 0); }
      }
    }
  }
  return Object.values(cands);
}
function all() {
  const r = state.result;
  if (!r) return [];
  return (r.candidates ?? merge(r.related, r.seeds)).filter((c) => c.rising != null && c.query !== r.seeds[0])
    .sort((a, b) => (b.breakout - a.breakout) || (b.rise_value - a.rise_value) || ((b.top ?? -1) - (a.top ?? -1)));
}
function allKw() {
  const r = state.result;
  return r ? (r.candidates ?? merge(r.related, r.seeds)).filter((c) => c.query !== r.seeds[0]) : [];
}
// Trends' "top" list: the most-searched related keywords, whether or not they're rising.
const topKw = () => allKw().filter((c) => c.top != null).sort((a, b) => b.top - a.top);
const cand = (q) => allKw().find((c) => c.query === q) || { query: q, seeds: [] };

// Speculative search: requests start while the user pauses typing or heads for the Research button,
// and research() reuses the in-flight promise, so pressing Research usually finds the data ready.
const related = new Map();
function relatedReq(seed, o) {
  const key = JSON.stringify([seed, o]);
  if (!related.has(key)) related.set(key, call(api.related(seed, o)).catch((e) => { related.delete(key); throw e; }));
  return related.get(key);
}
const parseSeeds = (text) => [...new Set(text.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean))].slice(0, 6);
function prefetch() {
  if (!connected()) return;
  for (const seed of parseSeeds($("q").value)) if (seed.length >= 3) relatedReq(seed, opts()).catch(() => {});
}

async function research(seeds, opts, keepTab = false) {
  seeds = parseSeeds(seeds.join(","));
  if (!seeds.length) return;
  state.result = { seeds, opts, related: Object.fromEntries(seeds.map((s) => [s, { loading: true }])), live: connected() };
  state.selected = null; state.filter = "all"; state.insight = {}; state.compare = []; state.comparison = null;
  if (keepTab) render(); else setTab("foryou");
  await Promise.all(seeds.map(async (seed) => {
    const done = job(`Rising searches for “${seed}”`);
    try { state.result.related[seed] = (await relatedReq(seed, opts)).data; }
    catch (e) { state.result.related[seed] = { error: e.message, auth: e.auth }; }
    done(); render();
  }));
  if (state.selected || !all()[0]) return;
  const q = all()[0].query, r = state.result;
  await select(q);
  // The Title Lab opens on the selected keyword, so its titles are the likeliest next ask. They start
  // once the chart and videos are in, so they don't hold those up, and only if this is still the search.
  await topReq(q).catch(() => {});
  if (state.result === r && state.selected === q) prefetchSug(q);
}

async function select(query, scroll) {
  state.selected = query;
  const r = state.result;
  const ins = (state.insight[query] ??= { interest: null });
  render();
  if (scroll) $("view").scrollIntoView({ behavior: "smooth", block: "start" });
  const tasks = [];
  if (!ins.interest) tasks.push((async () => {
    const done = job(`Charting “${query}”`);
    try { ins.interest = (await call(api.interest([query], r.opts))).data; } catch (e) { ins.interest = { error: e.message, auth: e.auth }; }
    done(); render();
  })());
  fetchVideos(query);
  await Promise.all(tasks);
}

function momentum(interest, query) {
  if (!interest?.points || interest.error) return null;
  const i = interest.keywords.indexOf(query);
  const s = interest.points.filter((p) => !p.partial).map((p) => p.values[i]);
  if (s.length < 8) return null;
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const recent = avg(s.slice(-7)), earlier = avg(s.slice(0, -7));
  if (!recent && !earlier) return { change: null };
  return { change: earlier ? Math.round((recent / earlier - 1) * 100) : 100 };
}

// ---------- rendering ----------
function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  render();
}
function render() {
  const v = $("view");
  $("pageTitle").textContent = state.tab === "lab" ? "Title Lab" : "Research";
  $("searchForm").style.display = state.tab === "lab" ? "none" : "";
  if (state.tab === "lab") return renderLab(v);
  if (!state.result) { v.innerHTML = `<div class="empty">Search for a topic to start.</div>`; return; }
  renderCompareBar();
  if (state.tab === "keywords") return renderKeywords(v);
  if (state.tab === "videos") return renderVideos(v);
  renderOverview(v);
}

const sizeBadge = (n) => (n == null ? `<span class="badge" style="color:var(--dim)">–</span>` : `<span class="badge ${n >= 40 ? "b-green" : n >= 15 ? "b-amber" : "b-red"}">${n}</span>`);
const change = (c) => (c.breakout ? `<span class="badge b-fire">BREAKOUT</span>` : `<span class="up">↗ ${esc(String(c.rising).replace(/^\+/, ""))}</span>`);
function table(rows, empty = "No rising searches here.") {
  if (!rows.length) return `<div class="empty">${state.result.candidates || !Object.values(state.result.related).some((d) => d.loading) ? empty : "Asking Firecrawl Trends…"}</div>`;
  const full = state.compare.length >= 5;
  return `<table class="kwt"><thead><tr><th class="ck" title="Select up to 5 to compare"></th><th>Keyword</th><th class="hide-sm">Found under</th><th class="c">Search size</th><th class="r">Volume change</th></tr></thead><tbody>
    ${rows.map((c) => { const on = state.compare.includes(c.query); return `<tr data-q="${esc(c.query)}" class="${state.selected === c.query ? "on" : ""}"><td class="ck"><input type="checkbox" data-ck="${esc(c.query)}" ${on ? "checked" : ""} ${full && !on ? "disabled" : ""} title="Compare"></td><td class="kw">${esc(c.query)}</td><td class="hide-sm" style="color:var(--muted)">${esc(c.seeds.join(", "))}</td><td class="c">${sizeBadge(c.top)}</td><td class="r">${c.rising == null ? `<span style="color:var(--dim)">–</span>` : change(c)}</td></tr>`; }).join("")}
  </tbody></table>`;
}
const head = (icon, title, more) => `<div class="sec-h"><h2>${ICON[icon]}${title}</h2>${more ? `<button class="more" data-go="${more}">Show all ${ARROW}</button>` : ""}</div>`;

// One keyword charted alone gets Trends' own 0–100 scale (100 = its busiest day). Several keywords
// fetched together share one scale, so their lines compare directly.
const CH = { W: 640, H: 230, L: 40, R: 12, T: 12, B: 30 };
const WIDE = { ...CH, W: 1240, H: 300 };
const LINE = ["#2fd36b", "#3b82f6", "#fa5d19", "#c084fc", "#f5b638"];
const charts = {};
function chart(interest, keys, id, D = CH) {
  const pts = interest.points.filter((p) => !p.partial);
  const idx = keys.map((k) => interest.keywords.indexOf(k));
  if (!pts.some((p) => idx.some((i) => p.values[i] > 0))) return `<div class="empty" style="padding:40px 0;text-align:center">Too few searches to chart yet.<br><span style="color:var(--dim);font-size:13px">Trends marks it as rising, but the volume is still below its 0–100 floor.</span></div>`;
  const { W, H, L, R, T, B } = D;
  const x = (j) => L + (j / Math.max(1, pts.length - 1)) * (W - L - R);
  const y = (v) => T + (1 - v / 100) * (H - T - B);
  const line = (i) => pts.map((p, j) => `${x(j).toFixed(1)},${y(p.values[i]).toFixed(1)}`).join(" ");
  const short = (l) => l.replace(/,?\s*\d{4}$/, "").replace(/\s*–.*$/, "");
  const ticks = [...new Set([0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * (pts.length - 1))))];
  const avg = (i) => Math.round(pts.reduce((n, p) => n + p.values[i], 0) / pts.length);
  charts[id] = { pts, keys, idx, x, y, D };
  return `<div class="plot">
    <svg viewBox="0 0 ${W} ${H}" id="${id}-svg">
      <defs><linearGradient id="${id}-g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${LINE[0]}" stop-opacity=".25"/><stop offset="1" stop-color="${LINE[0]}" stop-opacity="0"/></linearGradient></defs>
      ${[0, 25, 50, 75, 100].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#1f2433"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" class="tick">${v}</text>`).join("")}
      ${ticks.map((j) => `<text x="${x(j)}" y="${H - 8}" text-anchor="${j === 0 ? "start" : j === pts.length - 1 ? "end" : "middle"}" class="tick">${esc(short(pts[j].label))}</text>`).join("")}
      ${keys.length === 1 ? `<polygon points="${x(0)},${y(0)} ${line(idx[0])} ${x(pts.length - 1)},${y(0)}" fill="url(#${id}-g)"/>` : ""}
      ${idx.map((i, n) => `<polyline points="${line(i)}" fill="none" stroke="${LINE[n]}" stroke-width="2.5" stroke-linejoin="round"/>`).join("")}
      <line id="${id}-hl" y1="${T}" y2="${H - B}" stroke="#8b90a3" stroke-dasharray="3 3" visibility="hidden"/>
      ${idx.map((_, n) => `<circle id="${id}-dot${n}" r="5" fill="${LINE[n]}" stroke="#0b0d14" stroke-width="2" visibility="hidden"/>`).join("")}
      <rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" id="${id}-area"/>
    </svg>
    <div class="tip" id="${id}-tip"></div>
  </div>
  <div class="legend">${keys.length === 1 ? `<span>Search interest, 0–100 (100 = busiest day)</span><span>Average ${avg(idx[0])}</span>`
    : keys.map((k, n) => `<span><i style="background:${LINE[n]}"></i>${esc(k)} · avg ${avg(idx[n])}</span>`).join("")}</div>`;
}
function bindCharts() {
  for (const [id, c] of Object.entries(charts)) {
    const svg = $(`${id}-svg`);
    if (!svg) { delete charts[id]; continue; }
    const tip = $(`${id}-tip`), hl = $(`${id}-hl`);
    const dots = c.idx.map((_, n) => $(`${id}-dot${n}`));
    $(`${id}-area`).onmousemove = (e) => {
      const box = svg.getBoundingClientRect();
      const D = c.D;
      const vx = ((e.clientX - box.left) / box.width) * D.W;
      const j = Math.max(0, Math.min(c.pts.length - 1, Math.round(((vx - D.L) / (D.W - D.L - D.R)) * (c.pts.length - 1))));
      const vals = c.idx.map((i) => c.pts[j].values[i]);
      hl.setAttribute("x1", c.x(j)); hl.setAttribute("x2", c.x(j)); hl.setAttribute("visibility", "visible");
      dots.forEach((d, n) => { d.setAttribute("cx", c.x(j)); d.setAttribute("cy", c.y(vals[n])); d.setAttribute("visibility", "visible"); });
      tip.innerHTML = c.keys.length === 1 ? `<b>${vals[0]}</b><span>${esc(c.pts[j].label)}</span>`
        : `<div class="tip-date">${esc(c.pts[j].label)}</div>${c.keys.map((k, n) => `<div class="tip-row"><i style="background:${LINE[n]}"></i><span>${esc(k)}</span><b>${vals[n]}</b></div>`).join("")}`;
      tip.style.display = "block";
      const px = (c.x(j) / D.W) * box.width, py = (c.y(Math.max(...vals)) / D.H) * box.height;
      tip.style.left = `${Math.min(box.width - tip.offsetWidth, Math.max(0, px - tip.offsetWidth / 2))}px`;
      tip.style.top = `${Math.max(0, py - tip.offsetHeight - 12)}px`;
    };
    $(`${id}-area`).onmouseleave = () => { tip.style.display = "none"; hl.setAttribute("visibility", "hidden"); dots.forEach((d) => d.setAttribute("visibility", "hidden")); };
  }
}

function keywordCard() {
  const q = state.selected;
  if (!q) return "";
  const c = cand(q);
  const ins = state.insight[q] || {};
  const m = momentum(ins.interest, q);
  const mv = !ins.interest ? `<span class="skel" style="display:block;height:26px;margin-top:4px"></span>` : !m ? "–" : m.change == null ? `<span style="color:var(--muted)">Low</span>` : `<span style="color:${m.change >= 0 ? "var(--green)" : "var(--red)"}">${m.change >= 0 ? "+" : ""}${m.change}%</span>`;
  return `<div class="sec"><div class="kwcard">
    <div>
      <h3>${esc(q)}</h3>
      <div class="from">Rising under ${esc(c.seeds.join(", ") || "–")}</div>
      <div class="stats">
        <div class="stat"><div class="k">Volume change</div><div class="v" style="color:${c.breakout ? "#ff8a5c" : "var(--green)"}">${c.breakout ? "Breakout" : esc(c.rising ?? "–")}</div></div>
        <div class="stat"><div class="k">Search size</div><div class="v">${c.top ?? "–"}<span style="font-size:13px;color:var(--muted)">${c.top != null ? " /100" : ""}</span></div></div>
        <div class="stat"><div class="k">Last 7 days</div><div class="v">${mv}</div></div>
      </div>
      <div class="acts">
        <button class="btn" data-lab="${esc(q)}">Suggest titles</button>
        <button class="btn ghost" data-videos="${esc(q)}">Top videos</button>
        ${c.explore_url ? `<a class="btn ghost" style="display:inline-flex;align-items:center" href="${esc(c.explore_url)}" target="_blank" rel="noopener">Open in Trends ↗</a>` : ""}
      </div>
    </div>
    <div class="chart"><h4><span>Interest over time</span><span style="color:var(--dim)">hover for daily values</span></h4>
      ${!ins.interest ? `<div class="skel" style="height:230px"></div>` : ins.interest.error ? (ins.interest.auth ? connectCard(ins.interest.auth) : `<div class="err">${esc(ins.interest.error)}</div>`) : chart(ins.interest, [q], "kw")}
    </div>
  </div></div>`;
}

async function runCompare() {
  const keys = [...state.compare];
  const r = state.result;
  state.comparison = { keys, data: null };
  setTab("foryou");
  scrollTo({ top: 0, behavior: "smooth" });
  const done = job(`Comparing ${keys.length} keywords`);
  try { state.comparison.data = (await call(api.interest(keys, r.opts))).data; }
  catch (e) { state.comparison.data = { error: e.message, auth: e.auth }; }
  done();
  render();
}
function compareCard() {
  const c = state.comparison;
  if (!c) return "";
  return `<div class="sec"><div class="panel chart">
    <h4><span style="color:var(--text);font-weight:700;font-size:16px">Comparing ${c.keys.length} keywords</span><button class="more" data-cmp="close">Close ✕</button></h4>
    ${!c.data ? `<div class="skel" style="height:230px"></div>` : c.data.error ? (c.data.auth ? connectCard(c.data.auth) : `<div class="err">${esc(c.data.error)}</div>`) : chart(c.data, c.keys, "cmp", innerWidth > 900 ? WIDE : CH)}
    <div class="note">All lines share one 0–100 scale, so they compare directly. Hover for daily values.</div>
  </div></div>`;
}
function renderCompareBar() {
  const n = state.compare.length;
  $("cmpBar").classList.toggle("open", n > 0 && state.tab !== "lab");
  document.body.classList.toggle("cmp-open", n > 0 && state.tab !== "lab");
  $("cmpBar").innerHTML = `<span><b>${n}</b> of 5 selected</span><span class="cmp-keys">${state.compare.map(esc).join(" · ")}</span><button class="btn ghost" data-cmp="clear">Clear</button><button class="btn" data-cmp="run" ${n < 2 ? "disabled" : ""}>${n < 2 ? "Pick 2+ to compare" : "Compare"}</button>`;
}
$("cmpBar").onclick = (e) => {
  const b = e.target.closest("[data-cmp]"); if (!b) return;
  if (b.dataset.cmp === "clear") { state.compare = []; render(); }
  if (b.dataset.cmp === "run") runCompare();
};

function renderOverview(v) {
  const rows = all();
  const r = state.result;
  const failed = r.candidates ? [] : r.seeds.filter((s) => r.related[s]?.error);
  const authErr = failed.map((s) => r.related[s].auth).find(Boolean);
  if (authErr && failed.length === r.seeds.length) { v.innerHTML = connectCard(authErr); return; }
  v.innerHTML = `
    ${failed.length ? `<div class="sec err">No data for: ${esc(failed.join(", "))}. ${esc(r.related[failed[0]].error)}</div>` : ""}
    ${compareCard()}
    ${keywordCard()}
    <div class="sec">${head("fire", "Breakout keywords", "keywords")}${table(rows.filter((c) => c.breakout).slice(0, 5))}</div>
    <div class="sec">${head("trend", "Rising keywords", "keywords")}${table(rows.filter((c) => !c.breakout).slice(0, 5))}</div>
    <div class="sec">${head("search", "Most searched keywords", "keywords:top")}${table(topKw().slice(0, 5), "No related searches yet.")}</div>`;
  wire(v);
  bindCharts();
}
function renderKeywords(v) {
  const r = state.result;
  const rows = (state.kwMode === "top" ? topKw() : all()).filter((c) => state.filter === "all" || c.seeds.includes(state.filter));
  v.innerHTML = `<div class="sec">${head("search", `Keywords <span style="color:var(--dim);font-size:14px">${rows.length}</span>`)}
    <div class="chips"><span class="seg"><button class="${state.kwMode === "rising" ? "on" : ""}" data-mode="rising">Rising</button><button class="${state.kwMode === "top" ? "on" : ""}" data-mode="top">Most searched</button></span>
      ${r.seeds.length > 1 ? ["all", ...r.seeds].map((s) => `<button class="chip ${state.filter === s ? "on" : ""}" data-f="${esc(s)}">${s === "all" ? "All topics" : esc(s)}</button>`).join("") : ""}</div>
    ${table(rows, state.kwMode === "top" ? "No related searches yet." : "No rising searches here.")}</div>`;
  wire(v);
}

// Videos: YouTube's most-viewed results for a keyword. The outlier multiple compares each video with the
// median of these results (vidIQ compares with the channel's own average, which needs channel data).
// Videos and title suggestions both start from a keyword's top videos; they share one request.
const tops = new Map();
function topReq(keyword) {
  const key = keyword.toLowerCase();
  if (!tops.has(key)) {
    const p = call(api.youtubeTop(keyword));
    p.catch(() => tops.delete(key));
    tops.set(key, p);
  }
  return tops.get(key);
}
async function fetchVideos(keyword) {
  if (state.videos[keyword]) return;
  state.videos[keyword] = { loading: true };
  const done = job(`Top YouTube videos for “${keyword}”`);
  try { state.videos[keyword] = { list: relevant(keyword, (await topReq(keyword)).data) }; }
  catch (e) { state.videos[keyword] = { error: e.message, auth: e.auth }; }
  done();
  if (state.tab === "videos") render();
}
function loadVideos(keyword) {
  state.videoKw = keyword;
  fetchVideos(keyword);
  render();
}
const ytId = (url) => new URL(url).searchParams.get("v");
// YouTube only shows rough ages ("8d ago", "1y ago"), so views per day is an estimate; anything under a
// day counts as one day so brand-new videos don't divide by zero.
const DAYS = { s: 1 / 86400, m: 1 / 1440, min: 1 / 1440, h: 1 / 24, d: 1, w: 7, wk: 7, mo: 30, y: 365, yr: 365 };
const ageDays = (age) => { const m = String(age).match(/(\d+)\s?(mo|min|yr|wk|s|m|h|d|w|y)/); return m ? Math.max(1, Number(m[1]) * DAYS[m[2]]) : 365; };
const perDay = (v) => v.views / ageDays(v.age);
function videoCard(v, mult) {
  const bg = mult >= 3 ? "#e5484d" : mult >= 1.5 ? "#7c5cff" : "rgba(20,24,36,.85)";
  const s = scoreTitle(v.title, MODEL).score;
  return `<a class="vcard" href="${esc(v.url)}" target="_blank" rel="noopener"><div class="thumb"><img src="https://i.ytimg.com/vi/${esc(ytId(v.url))}/mqdefault.jpg" alt="" loading="lazy">${mult >= 1.5 ? `<span class="x" style="background:${bg}">${mult >= 10 ? Math.round(mult) : mult.toFixed(1).replace(/\.0$/, "")}x</span>` : ""}</div>
    <div class="t">${esc(v.title)}</div><div class="m">${fmt(v.views)} views • ${esc(v.age)}${v.channel ? " • " + esc(v.channel) : ""}</div>
    ${state.vidMode === "hot" ? `<div class="m">≈ ${fmt(Math.round(perDay(v)))} views/day</div>` : ""}
    <div class="m">Title score <span class="badge ${s >= 70 ? "b-green" : s >= 50 ? "b-amber" : "b-red"}" style="min-width:0;padding:1px 6px;font-size:12px">${s}</span></div></a>`;
}
function renderVideos(v) {
  const r = state.result;
  const kw = state.videoKw || state.selected || r.seeds[0];
  if (!state.videos[kw]) fetchVideos(kw);
  const d = state.videos[kw] || { loading: true };
  const opts = [...new Set([...r.seeds, ...(state.selected ? [state.selected] : []), kw])];
  const pick = `<div class="chips">${opts.map((k) => `<button class="chip ${k === kw ? "on" : ""}" data-vk="${esc(k)}">${esc(k)}</button>`).join("")}</div>`;
  if (d.loading) { v.innerHTML = `<div class="sec">${pick}<div class="grid-videos">${Array.from({ length: 8 }, () => `<div><div class="skel" style="aspect-ratio:16/9;margin-bottom:10px"></div><div class="skel" style="height:13px;margin-bottom:6px"></div><div class="skel" style="height:13px;width:60%"></div></div>`).join("")}</div></div>`; wireVideos(v); return; }
  if (d.error) { v.innerHTML = `<div class="sec">${pick}${d.auth ? connectCard(d.auth) : `<div class="err">${esc(d.error)}</div>`}</div>`; wireVideos(v); return; }
  // "Most viewed" compares total views; "Hot right now" compares views per day, so recent videos that are
  // taking off stand out from old ones that have had years to collect views.
  const hot = state.vidMode === "hot";
  const metric = hot ? perDay : (x) => x.views;
  const list = hot ? [...d.list].sort((a, b) => perDay(b) - perDay(a)) : d.list;
  const sorted = list.map(metric).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 1;
  const outliers = list.map((x) => ({ x, m: metric(x) / median })).filter((o) => o.m >= 1.5).sort((a, b) => b.m - a.m);
  const mode = `<span class="seg"><button class="${hot ? "" : "on"}" data-vm="views">Most viewed</button><button class="${hot ? "on" : ""}" data-vm="hot">Hot right now</button></span>`;
  v.innerHTML = `<div class="sec">${pick}</div>
    <div class="sec"><div class="sec-h"><h2>${ICON.fire}${hot ? "Taking off" : "Outlier videos"} for&nbsp;<em>${esc(kw)}</em></h2>${mode}</div>
      ${outliers.length ? `<div class="row-scroll">${outliers.map((o) => videoCard(o.x, o.m)).join("")}</div>` : `<div class="empty">No video here gets more than 1.5x the typical ${hot ? "views per day" : "views"}.</div>`}
      <div class="note">${hot ? `Views per day compared with the median of YouTube's top results for this keyword (≈ ${fmt(Math.round(median))} a day). Ages are rounded by YouTube, so this is an estimate.` : `Views compared with the median of YouTube's top results for this keyword (${fmt(median)} views).`}</div></div>
    <div class="sec">${head("play", `Thumbnails <span style="color:var(--dim);font-size:14px">${list.length}</span>`)}
      ${list.length ? `<div class="grid-videos">${list.map((x) => videoCard(x, metric(x) / median)).join("")}</div>` : `<div class="empty">YouTube returned no on-topic videos for this keyword.</div>`}</div>`;
  wireVideos(v);
}
function wireVideos(v) {
  v.onclick = (e) => {
    const m = e.target.closest("[data-vm]"); if (m) { state.vidMode = m.dataset.vm; return render(); }
    const k = e.target.closest("[data-vk]"); if (k) loadVideos(k.dataset.vk);
  };
}
function wire(v) {
  v.onclick = (e) => {
    const t = e.target;
    const ck = t.closest("[data-ck]");
    if (ck) {
      const q = ck.dataset.ck;
      state.compare = ck.checked ? [...state.compare, q].slice(0, 5) : state.compare.filter((x) => x !== q);
      return render();
    }
    if (t.closest("td.ck")) return;
    const go = t.closest("[data-go]");
    if (go) { const [tab, mode] = go.dataset.go.split(":"); state.kwMode = mode || "rising"; return setTab(tab); }
    const mode = t.closest("[data-mode]"); if (mode) { state.kwMode = mode.dataset.mode; return render(); }
    const vid = t.closest("[data-videos]"); if (vid) { state.videoKw = vid.dataset.videos; return setTab("videos"); }
    const cmp = t.closest("[data-cmp]"); if (cmp?.dataset.cmp === "close") { state.comparison = null; return render(); }
    const f = t.closest("[data-f]"); if (f) { state.filter = f.dataset.f; return render(); }
    const lab = t.closest("[data-lab]"); if (lab) { state.sugKw = lab.dataset.lab; setTab("lab"); return suggest(false); }
    const row = t.closest("[data-q]"); if (row) { if (state.tab !== "foryou") setTab("foryou"); select(row.dataset.q, true); }
  };
}

const NAMES = {
  len: "Length", words: "Word count", stub: "Too short", number: "Has a number", curiosity: "Curiosity words",
  narrative: "Story framing", second_person: "Talks to “you”", audience: "Audience words", question: "Question",
  colon: "Colon", parens: "Brackets", bang: "Exclamation", caps: "Capitals", dry: "Dry opener", vs: "Versus",
  depth: "Depth framing", conflict: "Conflict framing", accusation: "“You're doing it wrong”",
  first_person_result: "“I did X” result", explained_suffix: "“…Explained”", e_comparison: "Comparison",
  e_credibility: "Credibility", e_curiosity: "Curiosity", e_desire: "Desire", e_extreme: "Extreme words",
  e_list: "List", e_negativity: "Negativity", e_question: "Question", e_time: "Time",
};
const col = (s) => (s >= 70 ? "var(--green)" : s >= 50 ? "var(--amber)" : "var(--red)");
// Saved titles live in this browser: [{ title, keyword, at }].
const saved = () => store.get("fireiq.saved", []);
const isSaved = (t) => saved().some((x) => x.title.toLowerCase() === t.trim().toLowerCase());
function toggleSave(title, keyword = "") {
  title = title.trim();
  if (!title) return;
  store.set("fireiq.saved", isSaved(title) ? saved().filter((x) => x.title.toLowerCase() !== title.toLowerCase()) : [{ title, keyword, at: Date.now() }, ...saved()].slice(0, 100));
  refreshSaved();
}
const STAR = (on) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="${on ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>`;
function refreshSaved() {
  const el = $("savedList"); if (!el) return;
  const list = saved().map((x) => ({ ...x, score: scoreTitle(x.title, MODEL).score })).sort((a, b) => b.score - a.score);
  el.innerHTML = list.length ? `<table><thead><tr><th>Title</th><th class="r">Score</th><th class="r" style="width:96px"></th></tr></thead><tbody>
    ${list.map((r) => `<tr data-t="${esc(r.title)}" class="${state.open === r.title ? "open" : ""}"><td class="kw">${esc(r.title)}${r.keyword ? `<span class="pattern">${esc(r.keyword)}</span>` : ""}</td>
      <td class="r">${scoreCell(r.score)}</td>
      <td class="r acts-cell"><button class="icon-btn" data-copy="${esc(r.title)}" title="Copy">Copy</button><button class="icon-btn" data-unsave="${esc(r.title)}" title="Remove">✕</button></td></tr>${detail(r.title, 3)}`).join("")}
  </tbody></table>` : `<div class="empty">Star a suggested title to keep it here.</div>`;
  document.querySelectorAll("[data-star]").forEach((b) => { const on = isSaved(b.dataset.star); b.innerHTML = STAR(on); b.classList.toggle("on", on); });
}
// A title's score and the factors that moved it most, shown when its row is opened.
const badge = (n) => `<span class="badge ${n >= 70 ? "b-green" : n >= 50 ? "b-amber" : "b-red"}">${n}</span>`;
const scoreCell = (n) => `${badge(n)}<svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>`;
function breakdown(title) {
  const r = scoreTitle(title, MODEL);
  const a = Math.PI * (1 - r.score / 100), x = 100 + 80 * Math.cos(a), y = 100 - 80 * Math.sin(a);
  const rows = Object.entries(r.contributions).map(([k, v]) => [NAMES[k] || k, v]);
  if (Math.abs(r.vocab) >= 0.5) rows.push(["Topic words", r.vocab]);
  rows.sort((p, q) => Math.abs(q[1]) - Math.abs(p[1]));
  const max = Math.max(5, ...rows.map((p) => Math.abs(p[1])));
  return `<div class="why">
    <div class="gauge"><svg viewBox="0 0 200 110" width="100%" style="max-width:180px"><path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="#1f2433" stroke-width="14" stroke-linecap="round"/>${r.score ? `<path d="M20 100 A80 80 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}" fill="none" stroke="${col(r.score)}" stroke-width="14" stroke-linecap="round"/>` : ""}</svg>
      <div class="n" style="color:${col(r.score)}">${r.score}</div><div class="l">out of 100 · ${r.chars} chars · ${r.words} words</div>
      <div class="v">${r.score >= 70 ? "Strong title" : r.score >= 50 ? "Could be stronger" : "Weak title"}</div></div>
    <div><h4>What's moving the score</h4>${rows.slice(0, 8).map(([n, val]) => { const w = (Math.abs(val) / max) * 50, pos = val >= 0; return `<div class="factor"><span class="name">${esc(n)}</span><div class="fbar"><i style="left:${pos ? 50 : 50 - w}%;width:${w}%;background:${pos ? "var(--green)" : "var(--red)"}"></i></div><span class="val" style="color:${pos ? "var(--green)" : "var(--red)"}">${pos ? "+" : ""}${val.toFixed(1)}</span></div>`; }).join("") || `<div class="empty" style="padding:8px 0">Nothing stands out.</div>`}</div>
  </div>`;
}
const detail = (title, cols) => (state.open === title ? `<tr class="detail"><td colspan="${cols}">${breakdown(title)}</td></tr>` : "");

function renderLab(v) {
  v.innerHTML = `
    <form class="search" id="sugForm">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8b90a3" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input id="sugKw" placeholder="What's your video about? e.g. claude code" autocomplete="off" spellcheck="false" value="${esc(state.sugKw ?? state.selected ?? "")}">
      <button class="btn" type="submit">Suggest 5 titles</button>
    </form>
    <div id="sug" style="margin-top:8px"></div>
    <div class="sec"><div class="sec-h"><h2>${STAR(true)}Saved titles</h2></div><div id="savedList"></div></div>`;
  renderSuggestions();
  $("sugForm").onsubmit = (e) => { e.preventDefault(); suggest(false); };
  const sugKw = $("sugKw"), sugBtn = $("sugForm").querySelector('button[type="submit"]');
  let sugTimer;
  sugKw.oninput = () => { clearTimeout(sugTimer); sugTimer = setTimeout(() => prefetchSug(sugKw.value), 1000); };
  sugBtn.addEventListener("pointerenter", () => prefetchSug(sugKw.value));
  sugBtn.addEventListener("focus", () => prefetchSug(sugKw.value));
  prefetchSug(sugKw.value);
  refreshSaved();
  v.onclick = (e) => {
    if (e.target.closest("#moreT")) return suggest(true);
    const sk = e.target.closest("[data-sk]"); if (sk) { $("sugKw").value = sk.dataset.sk; return suggest(false); }
    const star = e.target.closest("[data-star]"); if (star) return toggleSave(star.dataset.star, state.sugKw ?? "");
    const un = e.target.closest("[data-unsave]"); if (un) return toggleSave(un.dataset.unsave);
    const cp = e.target.closest("[data-copy]");
    if (cp) { navigator.clipboard?.writeText(cp.dataset.copy).then(() => { cp.textContent = "Copied"; setTimeout(() => (cp.textContent = "Copy"), 1200); }); return; }
    if (e.target.closest("a, .detail")) return;
    const r = e.target.closest("[data-t]");
    if (r) { state.open = state.open === r.dataset.t ? null : r.dataset.t; renderSuggestions(); refreshSaved(); }
  };
  if (!state.sug) sugKw.focus();
  // Signed out, the sample's titles show straight away rather than behind a button that looks like it costs something.
  if (!state.sug && !connected() && SAMPLE?.ideas[sugKw.value.trim().toLowerCase()]) suggest(false);
}

// "more" asks for 5 titles that haven't been shown yet for this keyword.
function trendingFrom(d, keyword) {
  const kw = keyword.toLowerCase();
  const rising = (d?.rising ?? []).filter((q) => q.query.toLowerCase() !== kw).slice(0, 8).map((q) => ({ query: q.query, label: q.breakout ? "Breakout" : "Rising" }));
  const top = (d?.top ?? []).filter((q) => q.query.toLowerCase() !== kw && !rising.some((r) => r.query === q.query)).slice(0, 4).map((q) => ({ query: q.query, label: "Most searched" }));
  return [...rising, ...top];
}
// Speculative title research, like the Research box: the slow part of "Suggest" starts while the user
// pauses typing, heads for the button, or opens the Lab with a keyword already filled in, and suggest()
// reuses the in-flight requests.
const sugReqs = new Map();
function sugReq(keyword) {
  const key = keyword.toLowerCase();
  if (!sugReqs.has(key)) {
    // Trending searches for the keyword (free if it was already researched on Overview) guide the writer
    // and give matching titles a ranking bonus. If Trends or the language model fails, carry on without.
    // The language model scrapes YouTube itself, so it doesn't wait for the top videos.
    const trending = api.related(keyword, state.result?.opts ?? opts()).then((r) => trendingFrom(r.data, keyword)).catch(() => []);
    const top = topReq(keyword);
    const ideas = trending.then((t) => api.titleIdeas(keyword, "", t)).catch(() => null);
    top.catch(() => sugReqs.delete(key));
    sugReqs.set(key, { top, trending, ideas });
  }
  return sugReqs.get(key);
}
function prefetchSug(keyword) {
  keyword = keyword.trim();
  if (connected() && keyword.length >= 3) sugReq(keyword);
}

// Each step stays up for a minimum time even when its data was prefetched: an answer that appears
// instantly reads as canned, while seeing the work makes the same result feel considered.
const STEPS = [
  ["Reading YouTube's most-viewed videos", 300],
  ["Checking what people search for now", 250],
  ["Writing titles with Firecrawl's language model", 350],
  ["Scoring and ranking", 200],
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let sugRun = 0;
async function suggest(more) {
  const keyword = $("sugKw").value.trim();
  if (!keyword) return;
  const same = state.sugKw === keyword;
  state.sugKw = keyword;
  if (!more || !same) state.sugShown = [];
  const run = ++sugRun;
  const req = sugReq(keyword);
  const waits = [req.top, req.trending, req.ideas, null];
  state.sug = { loading: true, step: more && same ? STEPS.length - 1 : 0 };
  renderSuggestions();
  const done = job(`Researching top YouTube titles for “${keyword}”`);
  let next;
  try {
    for (let i = state.sug.step; i < STEPS.length; i++) {
      await Promise.all([waits[i], sleep(STEPS[i][1])]);
      if (run !== sugRun) break;
      state.sug.step = i + 1;
      if (state.tab === "lab") renderSuggestions();
    }
    const [top, trending, ideas] = await Promise.all([req.top, req.trending, req.ideas]);
    next = suggestTitles(keyword, "", top.data, (t) => scoreTitle(t, MODEL).score, state.sugShown, ideas?.data ?? null, trending);
    if (!next.studied && !ideas) throw new Error("None of YouTube's top videos for this keyword were on topic. Try a broader keyword.");
    next.reveal = true;
  } catch (e) { next = { error: e.message, auth: e.auth }; }
  done();
  if (run !== sugRun) return;
  state.sug = next;
  if (next.titles) state.sugShown.push(...next.titles.map((t) => t.title));
  if (state.tab === "lab") renderSuggestions();
}
function renderSuggestions() {
  const el = $("sug"); if (!el) return;
  const s = state.sug;
  const tryThese = !connected() && SAMPLE ? `<div class="chips" style="margin-top:12px"><span class="note" style="margin:0;align-self:center">Sample titles are ready for</span>${Object.keys(SAMPLE.ideas).map((k) => `<button class="chip" data-sk="${esc(k)}">${esc(k)}</button>`).join("")}</div>` : "";
  if (!s) { el.innerHTML = `${tryThese}<div class="note">Reads the most-viewed YouTube videos for the keyword with Firecrawl, works out what the subject is and which title patterns earn the most views, writes 15 new titles, then shows the 5 that score highest. Edit them so they match your video.</div>`; return; }
  if (s.loading) {
    el.innerHTML = `<ol class="steps">${STEPS.map(([t], i) => `<li class="${i < s.step ? "done" : i === s.step ? "on" : ""}">${i === s.step ? `<span class="spin"></span>` : `<span class="tick"></span>`}${esc(t)}</li>`).join("")}</ol>
      ${Array.from({ length: 5 }, () => `<div class="skel" style="height:48px;margin-top:8px"></div>`).join("")}`;
    return;
  }
  if (s.error) { el.innerHTML = tryThese + (s.auth ? connectCard(s.auth) : `<div class="err" style="margin-top:10px">${esc(s.error)}</div>`); return; }
  // Fresh results fade in one row at a time; re-renders (switching tabs, starring) don't replay it.
  const reveal = s.reveal;
  s.reveal = false;
  const fx = (i) => (reveal ? ` style="animation-delay:${i * 90}ms"` : "");
  el.innerHTML = `${s.subject ? `<div class="about"><b>What this is about:</b> ${esc(s.subject)}${s.angles?.length ? `<div class="angles">${s.angles.slice(0, 5).map((a) => `<span>${esc(a)}</span>`).join("")}</div>` : ""}</div>` : ""}
  <table class="sug"><thead><tr><th style="width:44px"></th><th>Title</th><th class="r">Score</th></tr></thead><tbody>
    ${s.titles.map((t, i) => `<tr data-t="${esc(t.title)}" class="${reveal ? "reveal" : ""}${state.open === t.title ? " open" : ""}"${fx(i)}><td class="star-cell"><button class="icon-btn star" data-star="${esc(t.title)}" title="Save">${STAR(isSaved(t.title))}</button></td><td><div>${esc(t.title)}<span class="pattern">${esc(t.pattern)}</span>${t.match ? `<span class="pattern match" title="Contains a phrase people are searching for now">🔍 ${esc(t.match.query)} · ${esc(t.match.label)}</span>` : ""}</div>
      ${t.inspired_by ? `<div class="from">Inspired by <a href="${esc(t.inspired_url)}" target="_blank" rel="noopener">${esc(t.inspired_by)}</a>${t.inspired_views ? ` · ${fmt(t.inspired_views)} views` : ""}</div>` : `<div class="from">From title-score: one of the framings that lifts vidIQ's score most</div>`}</td>
      <td class="r">${scoreCell(t.score)}</td></tr>${detail(t.title, 3)}`).join("")}
  </tbody></table>
  <div class="note" style="display:flex;justify-content:space-between;align-items:center;gap:12px"><span>Click a title to see what's moving its score.</span><button class="btn ghost" id="moreT" style="height:34px">Suggest 5 more</button></div>
  <div class="research${reveal ? " reveal" : ""}"${fx(s.titles.length)}>
    <div>
      <h4>What's working for “${esc(state.sugKw)}”</h4>
      <div class="pats">${s.patterns.map((p) => `<div class="pat"><span>${esc(p.name)}</span><div class="pbar"><i style="width:${Math.round(p.share * 100)}%"></i></div><b>${Math.round(p.share * 100)}%</b></div>`).join("")}</div>
      <div class="note">Share of views among the ${s.studied} top videos studied. A title can use several patterns.</div>
      ${s.trending?.length ? `<h4 style="margin-top:18px">Searching now</h4><div class="angles">${s.trending.map((t) => `<span>${esc(t.query)} · ${esc(t.label)}</span>`).join("")}</div>
      <div class="note">Rising and most-searched YouTube searches for this keyword. Titles that contain one rank higher.</div>` : ""}
    </div>
    <div>
      <h4>Most-viewed videos</h4>
      ${s.top.map((v) => `<a class="topv" href="${esc(v.url)}" target="_blank" rel="noopener"><span class="t">${esc(v.title)}</span><span class="m">${fmt(v.views)} views · ${esc(v.age)}${v.channel ? " · " + esc(v.channel) : ""}</span></a>`).join("")}
    </div>
  </div>`;
}
function renderStatus() {
  const { total, done, label } = state.jobs;
  $("status").innerHTML = total ? `<span class="spin"></span><span>${esc(label)}${total > 1 ? ` · ${done}/${total}` : ""}</span>`
    : location.protocol === "file:" ? "Opened from disk. Run <code>bun server.ts</code> for live research." : "";
}

// ---------- wiring ----------
const opts = () => ({ geo: $("geo").value, time: $("time").value, property: $("property").value });
$("searchForm").onsubmit = (e) => { e.preventDefault(); research($("q").value.split(","), opts()); };
let typingTimer;
$("q").addEventListener("input", () => { clearTimeout(typingTimer); typingTimer = setTimeout(prefetch, 800); });
const goBtn = $("searchForm").querySelector('button[type="submit"]');
goBtn.addEventListener("pointerenter", prefetch);
goBtn.addEventListener("focus", prefetch);
for (const id of ["time", "geo", "property"]) $(id).addEventListener("change", prefetch);
document.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));

// Opens on "claude code": live when connected (cached after the first load), otherwise the sample.
const DEFAULT_TOPIC = SAMPLE?.seed ?? "claude code";
$("q").value = DEFAULT_TOPIC;
renderStatus();
render();
checkConnection().then(() => {
  research([DEFAULT_TOPIC], opts());
});
