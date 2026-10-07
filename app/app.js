const MODEL = window.TITLE_MODEL;
const SNAPSHOT = window.FIREIQ;
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
};

const state = {
  tab: "foryou",
  result: null,
  selected: null,
  insight: {},
  filter: "all",
  jobs: { total: 0, done: 0, label: "" },
  lab: store.get("fireiq.labTitle", SNAPSHOT?.titles?.[0]?.title ?? ""),
};

// ---------- data ----------
async function api(path, params, fresh = false) {
  const auth = store.get("fireiq.auth", null);
  const r = await fetch(`${path}?${new URLSearchParams({ ...params, ...(fresh ? { fresh: "1" } : {}) })}`, { headers: keyHeaders() });
  const j = await r.json();
  if (!r.ok || j.error) {
    const err = new Error(j.error || r.statusText);
    err.auth = j.auth;
    if (j.auth) checkConnection();
    throw err;
  }
  return j;
}

// ---------- account ----------
// state.conn comes from /api/me, which checks the key with Firecrawl rather than trusting what's saved.
function keyHeaders() {
  const auth = store.get("fireiq.auth", null);
  return { ...(auth?.apiKey ? { "x-firecrawl-key": auth.apiKey } : {}), ...(store.get("fireiq.noServerKey", false) ? { "x-fireiq-no-server-key": "1" } : {}) };
}
async function checkConnection() {
  const auth = store.get("fireiq.auth", null);
  state.conn = { checking: true };
  renderAccount();
  try {
    state.conn = await (await fetch("/api/me", { headers: keyHeaders() })).json();
  } catch {
    state.conn = { connected: false, error: "Can't reach the fireIQ server." };
  }
  renderAccount();
  if (state.conn.connected) { state.blocked = false; render(); }
}
function renderAccount() {
  const auth = store.get("fireiq.auth", null);
  const c = state.conn || { checking: true };
  const credits = c.remainingCredits != null ? `${c.remainingCredits.toLocaleString()} credits left` : "";
  const buttons = `<button class="btn ghost ghost-key" id="addKey">Add API key</button><button class="btn" id="signIn"><img class="fcmark" src="firecrawl-logo.svg" alt="">Sign in<span class="long"> with Firecrawl</span></button>`;
  $("account").innerHTML = c.checking
    ? `<span class="who"><span class="spin"></span>Checking Firecrawl…</span>`
    : c.connected
      ? `<span class="who" title="${c.source === "server" ? "Using the server's FIRECRAWL_API_KEY" : "Using the key saved in this browser"}"><span class="dot"></span><b>${esc(c.source === "server" ? "Connected" : auth?.teamName && auth.teamName !== "API key" ? auth.teamName : "Connected")}</b><span class="k">${c.source === "server" ? "server key · " : ""}${credits}</span></span><button class="btn ghost" id="signOut">Disconnect</button>`
      : `<span class="who off"><span class="dot"></span>${c.rejected ? "Key rejected" : "Not connected"}</span>${c.serverKeyAvailable ? `<button class="btn ghost" id="useServer">Reconnect</button>` : ""}${buttons}`;
  $("account").onclick = (e) => {
    if (e.target.closest("#signOut")) { store.set("fireiq.auth", null); store.set("fireiq.noServerKey", true); checkConnection(); }
    if (e.target.closest("#useServer")) { store.set("fireiq.noServerKey", false); checkConnection(); }
    if (e.target.closest("#addKey")) openKey();
    if (e.target.closest("#signIn")) signIn();
  };
}
const connected = () => !!state.conn?.connected;
function connectCard(reason) {
  const rejected = reason === "rejected" || state.conn?.rejected;
  const title = reason === "credits" ? "Your Firecrawl account is out of credits" : rejected ? "Firecrawl rejected your API key" : "Connect Firecrawl to run live research";
  const body = reason === "credits" ? "Add credits or upgrade your plan on firecrawl.dev, then try again."
    : rejected ? "The saved key no longer works. Sign in again or paste a new key."
    : "fireIQ runs every search on your own Firecrawl account. The free plan includes 1,000 credits a month, and a search costs about 5 credits per topic.";
  return `<div class="connect"><img src="firecrawl-logo.svg" alt="" class="big"><h3>${title}</h3><p>${body}</p>
    ${reason === "credits" ? `<a class="btn" href="https://www.firecrawl.dev/app" target="_blank" rel="noopener" style="display:inline-flex;align-items:center">Open Firecrawl</a>`
      : `<div class="acts"><button class="btn" data-connect="signin"><img class="fcmark" src="firecrawl-logo.svg" alt="">Sign in with Firecrawl</button><button class="btn ghost" data-connect="key">Add API key</button></div>`}</div>`;
}
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
function openSignIn() {
  if ($("modal").classList.contains("open")) return;
  modal(`<h3>Connect Firecrawl</h3><p>Live research runs on your own Firecrawl account. The free plan includes 1,000 credits a month.</p>
    <div class="row" style="justify-content:stretch;flex-direction:column"><button class="btn" id="mSignIn" style="height:44px"><img class="fcmark" src="firecrawl-logo.svg" alt="">Sign in with Firecrawl</button><button class="btn ghost" id="mKey" style="height:44px">Add an API key instead</button></div>`);
  $("mSignIn").onclick = signIn;
  $("mKey").onclick = openKey;
}
function openKey() {
  modal(`<h3>Add your Firecrawl API key</h3><p>Find it at <a href="https://www.firecrawl.dev/app/api-keys" target="_blank" rel="noopener">firecrawl.dev/app/api-keys</a>. It's kept in this browser and sent only to this app's server, which uses it to call Firecrawl.</p>
    <form id="keyForm"><input id="keyIn" placeholder="fc-..." autocomplete="off" spellcheck="false"><div class="row"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn" type="submit">Save key</button></div></form>`);
  $("keyIn").focus();
  $("keyForm").onsubmit = (e) => {
    e.preventDefault();
    const k = $("keyIn").value.trim();
    if (!/^fc-[A-Za-z0-9]+$/.test(k)) { $("keyIn").style.borderColor = "var(--red)"; return; }
    store.set("fireiq.auth", { apiKey: k, teamName: "API key" });
    closeModal(); checkConnection();
  };
}

// Firecrawl's browser sign-in (the flow its CLI uses): PKCE challenge in the URL, then poll for the key.
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
    <div class="status" style="margin-bottom:16px"><span class="spin"></span>Waiting for Firecrawl…</div><div class="row"><button class="btn ghost" data-close>Cancel</button></div>`);
  const until = Date.now() + 10 * 60 * 1000;
  while (signInRun === run && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const r = await (await fetch("/api/auth/status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session_id: session, code_verifier: verifier }) })).json();
      if (r.status === "complete" && r.apiKey) {
        store.set("fireiq.auth", { apiKey: r.apiKey, teamName: r.teamName || "Firecrawl" });
        closeModal(); checkConnection();
        return;
      }
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
const cand = (q) => all().find((c) => c.query === q) || { query: q, seeds: [] };

async function research(seeds, opts) {
  if (state.conn && !state.conn.checking && !connected()) { state.blocked = true; setTab("foryou"); return; }
  state.blocked = false;
  seeds = [...new Set(seeds.map((s) => s.trim().toLowerCase()).filter(Boolean))].slice(0, 6);
  if (!seeds.length) return;
  state.result = { seeds, opts, related: Object.fromEntries(seeds.map((s) => [s, { loading: true }])), live: true };
  state.selected = null; state.filter = "all"; state.insight = {};
  setTab("foryou");
  await Promise.all(seeds.map(async (seed) => {
    const done = job(`Rising searches for “${seed}”`);
    try { state.result.related[seed] = (await api("/api/related", { keyword: seed, ...opts })).data; }
    catch (e) { state.result.related[seed] = { error: e.message, auth: e.auth }; }
    done(); render();
  }));
  if (!state.selected && all()[0]) select(all()[0].query);
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
    try { ins.interest = (await api("/api/interest", { keywords: query, ...r.opts })).data; } catch (e) { ins.interest = { error: e.message, auth: e.auth }; }
    done(); render();
  })());
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

// Offline fallback: the saved Oct 6 run, narrowed to one of its topics.
function openSnapshot(seed) {
  const t = SNAPSHOT.trends;
  state.result = { seeds: [seed], opts: { geo: t.geo, time: t.time, property: t.property }, live: false,
    candidates: t.candidates.filter((c) => c.seeds.includes(seed)).map((c) => ({ ...c, seeds: [seed], top: c.top == null ? null : Number(c.top) })) };
  state.selected = null; state.filter = "all"; state.insight = {};
  $("q").value = seed;
  setTab("foryou");
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
  if (state.blocked && !connected()) { v.innerHTML = connectCard(); return; }
  if (!state.result) { v.innerHTML = `<div class="empty">Search for a topic to start.</div>`; return; }
  if (state.tab === "keywords") return renderKeywords(v);
  renderOverview(v);
}

const sizeBadge = (n) => (n == null ? `<span class="badge" style="color:var(--dim)">–</span>` : `<span class="badge ${n >= 40 ? "b-green" : n >= 15 ? "b-amber" : "b-red"}">${n}</span>`);
const change = (c) => (c.breakout ? `<span class="badge b-fire">BREAKOUT</span>` : `<span class="up">↗ ${esc(String(c.rising).replace(/^\+/, ""))}</span>`);
function table(rows) {
  if (!rows.length) return `<div class="empty">${state.result.candidates || !Object.values(state.result.related).some((d) => d.loading) ? "No rising searches here." : "Asking Firecrawl Trends…"}</div>`;
  return `<table class="kwt"><thead><tr><th>Keyword</th><th class="hide-sm">Found under</th><th class="c">Search size</th><th class="r">Volume change</th></tr></thead><tbody>
    ${rows.map((c) => `<tr data-q="${esc(c.query)}" class="${state.selected === c.query ? "on" : ""}"><td class="kw">${esc(c.query)}</td><td class="hide-sm" style="color:var(--muted)">${esc(c.seeds.join(", "))}</td><td class="c">${sizeBadge(c.top)}</td><td class="r">${change(c)}</td></tr>`).join("")}
  </tbody></table>`;
}
const head = (icon, title, more) => `<div class="sec-h"><h2>${ICON[icon]}${title}</h2>${more ? `<button class="more" data-go="${more}">Show all ${ARROW}</button>` : ""}</div>`;

// Charted on its own, the keyword gets Trends' own 0–100 scale: 100 is its busiest day in the range.
const CH = { W: 640, H: 230, L: 40, R: 12, T: 12, B: 30 };
function chart(interest, query) {
  const pts = interest.points.filter((p) => !p.partial);
  const qi = interest.keywords.indexOf(query);
  if (!pts.some((p) => p.values[qi] > 0)) return `<div class="empty" style="padding:40px 0;text-align:center">Too few searches to chart yet.<br><span style="color:var(--dim);font-size:13px">Trends marks it as rising, but the volume is still below its 0–100 floor.</span></div>`;
  const { W, H, L, R, T, B } = CH;
  const x = (j) => L + (j / Math.max(1, pts.length - 1)) * (W - L - R);
  const y = (v) => T + (1 - v / 100) * (H - T - B);
  const line = pts.map((p, j) => `${x(j).toFixed(1)},${y(p.values[qi]).toFixed(1)}`).join(" ");
  const short = (l) => l.replace(/,?\s*\d{4}$/, "").replace(/\s*–.*$/, "");
  const ticks = [...new Set([0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * (pts.length - 1))))];
  chartState = { pts, qi, x, y };
  return `<div class="plot" id="plot">
    <svg viewBox="0 0 ${W} ${H}" id="plotSvg">
      <defs><linearGradient id="g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#2fd36b" stop-opacity=".25"/><stop offset="1" stop-color="#2fd36b" stop-opacity="0"/></linearGradient></defs>
      ${[0, 25, 50, 75, 100].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#1f2433"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" class="tick">${v}</text>`).join("")}
      ${ticks.map((j) => `<text x="${x(j)}" y="${H - 8}" text-anchor="${j === 0 ? "start" : j === pts.length - 1 ? "end" : "middle"}" class="tick">${esc(short(pts[j].label))}</text>`).join("")}
      <polygon points="${x(0)},${y(0)} ${line} ${x(pts.length - 1)},${y(0)}" fill="url(#g)"/>
      <polyline points="${line}" fill="none" stroke="#2fd36b" stroke-width="2.5" stroke-linejoin="round"/>
      <line id="hoverLine" y1="${T}" y2="${H - B}" stroke="#8b90a3" stroke-dasharray="3 3" visibility="hidden"/>
      <circle id="hoverDot" r="5" fill="#2fd36b" stroke="#0b0d14" stroke-width="2" visibility="hidden"/>
      <rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" id="hoverArea"/>
    </svg>
    <div class="tip" id="tip"></div>
  </div>
  <div class="legend"><span>Search interest, 0–100 (100 = busiest day)</span><span>Average ${Math.round(pts.reduce((n, p) => n + p.values[qi], 0) / pts.length)}</span></div>`;
}
let chartState = null;
function bindChart() {
  const svg = $("plotSvg");
  if (!svg || !chartState) return;
  const { pts, qi, x, y } = chartState;
  const area = $("hoverArea"), tip = $("tip"), hl = $("hoverLine"), dot = $("hoverDot");
  const show = (e) => {
    const box = svg.getBoundingClientRect();
    const vx = ((e.clientX - box.left) / box.width) * CH.W;
    let j = Math.round(((vx - CH.L) / (CH.W - CH.L - CH.R)) * (pts.length - 1));
    j = Math.max(0, Math.min(pts.length - 1, j));
    const v = pts[j].values[qi];
    hl.setAttribute("x1", x(j)); hl.setAttribute("x2", x(j)); hl.setAttribute("visibility", "visible");
    dot.setAttribute("cx", x(j)); dot.setAttribute("cy", y(v)); dot.setAttribute("visibility", "visible");
    tip.innerHTML = `<b>${v}</b><span>${esc(pts[j].label)}</span>`;
    tip.style.display = "block";
    const px = (x(j) / CH.W) * box.width, py = (y(v) / CH.H) * box.height;
    tip.style.left = `${Math.min(box.width - tip.offsetWidth, Math.max(0, px - tip.offsetWidth / 2))}px`;
    tip.style.top = `${Math.max(0, py - tip.offsetHeight - 12)}px`;
  };
  area.onmousemove = show;
  area.onmouseleave = () => { tip.style.display = "none"; hl.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); };
}

function keywordCard() {
  chartState = null;
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
        <button class="btn" data-lab="${esc(q)}">Score as a title</button>
        ${c.explore_url ? `<a class="btn ghost" style="display:inline-flex;align-items:center" href="${esc(c.explore_url)}" target="_blank" rel="noopener">Open in Trends ↗</a>` : ""}
      </div>
    </div>
    <div class="chart"><h4><span>Interest over time</span><span style="color:var(--dim)">hover for daily values</span></h4>
      ${!ins.interest ? `<div class="skel" style="height:230px"></div>` : ins.interest.error ? (ins.interest.auth ? connectCard(ins.interest.auth) : `<div class="err">${esc(ins.interest.error)}</div>`) : chart(ins.interest, q)}
    </div>
  </div></div>`;
}

function renderOverview(v) {
  const rows = all();
  const r = state.result;
  const failed = r.candidates ? [] : r.seeds.filter((s) => r.related[s]?.error);
  const authErr = failed.map((s) => r.related[s].auth).find(Boolean);
  if (authErr && failed.length === r.seeds.length) { v.innerHTML = connectCard(authErr); return; }
  v.innerHTML = `
    ${failed.length ? `<div class="sec err">No data for: ${esc(failed.join(", "))}. ${esc(r.related[failed[0]].error)}</div>` : ""}
    ${keywordCard()}
    <div class="sec">${head("fire", "Breakout keywords", "keywords")}${table(rows.filter((c) => c.breakout).slice(0, 5))}</div>
    <div class="sec">${head("trend", "Rising keywords", "keywords")}${table(rows.filter((c) => !c.breakout).slice(0, 5))}</div>`;
  wire(v);
  bindChart();
}
function renderKeywords(v) {
  const r = state.result;
  const rows = all().filter((c) => state.filter === "all" || c.seeds.includes(state.filter));
  v.innerHTML = `<div class="sec">${head("search", `Keywords <span style="color:var(--dim);font-size:14px">${rows.length}</span>`)}
    <div class="chips">${["all", ...r.seeds].map((s) => `<button class="chip ${state.filter === s ? "on" : ""}" data-f="${esc(s)}">${s === "all" ? "All topics" : esc(s)}</button>`).join("")}</div>
    ${table(rows)}</div>`;
  wire(v);
}
function wire(v) {
  v.onclick = (e) => {
    const t = e.target;
    const go = t.closest("[data-go]"); if (go) return setTab(go.dataset.go);
    const f = t.closest("[data-f]"); if (f) { state.filter = f.dataset.f; return render(); }
    const lab = t.closest("[data-lab]"); if (lab) { state.lab = lab.dataset.lab; return setTab("lab"); }
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
function renderLab(v) {
  const saved = store.get("fireiq.titles", []);
  const list = [...new Set([...saved, ...(SNAPSHOT?.titles || []).map((t) => t.title)])].map((t) => scoreTitle(t, MODEL)).sort((a, b) => b.score - a.score);
  v.innerHTML = `
    <div class="sec"><div class="search" style="height:56px"><input id="labIn" placeholder="Type a title to score…" autocomplete="off" spellcheck="false" style="font-size:17px;font-weight:700"><button class="btn" id="saveT">Save</button></div></div>
    <div class="lab">
      <div class="panel gauge" id="gauge"></div>
      <div class="panel"><div class="sec-h"><h2>What's moving the score</h2></div><div id="factors"></div>
        </div>
    </div>
    <div class="sec">${head("fire", "Suggested titles")}
      <div class="panel">
        <form class="suggest" id="sugForm">
          <input id="sugKw" placeholder="Keyword, e.g. vidiq alternative" value="${esc(state.sugKw ?? state.selected ?? "")}">
          <input id="sugTool" placeholder="Your tool or product (optional), e.g. Claude Code" value="${esc(state.sugTool ?? "")}">
          <button class="btn" type="submit">Suggest 5 titles</button>
        </form>
        <div id="sug" style="margin-top:6px"></div>
      </div>
    </div>
    <div class="sec">${head("search", "Your titles")}
      <table><thead><tr><th>Title</th><th class="r">Score</th></tr></thead><tbody>
      ${list.map((r) => `<tr data-t="${esc(r.title)}"><td class="kw">${esc(r.title)}</td><td class="r"><span class="badge ${r.score >= 70 ? "b-green" : r.score >= 50 ? "b-amber" : "b-red"}">${r.score}</span></td></tr>`).join("")}
      </tbody></table></div>`;
  const input = $("labIn");
  input.value = state.lab;
  const update = () => {
    state.lab = input.value; store.set("fireiq.labTitle", state.lab);
    const t = input.value.trim();
    const r = t ? scoreTitle(t, MODEL) : { score: 0, chars: 0, words: 0, contributions: {}, vocab: 0 };
    const a = Math.PI * (1 - r.score / 100), x = 100 + 80 * Math.cos(a), y = 100 - 80 * Math.sin(a);
    $("gauge").innerHTML = `<svg viewBox="0 0 200 110" width="100%" style="max-width:240px"><path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="#1f2433" stroke-width="14" stroke-linecap="round"/>${r.score ? `<path d="M20 100 A80 80 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}" fill="none" stroke="${col(r.score)}" stroke-width="14" stroke-linecap="round"/>` : ""}</svg>
      <div class="n" style="color:${t ? col(r.score) : "var(--dim)"}">${r.score}</div><div class="l">out of 100 · ${r.chars} chars · ${r.words} words</div>
      <div class="v">${!t ? "Type a title" : r.score >= 70 ? "Strong title" : r.score >= 50 ? "Could be stronger" : "Weak title"}</div>`;
    const rows = Object.entries(r.contributions).map(([k, v]) => [NAMES[k] || k, v]);
    if (Math.abs(r.vocab) >= 0.5) rows.push(["Topic words", r.vocab]);
    rows.sort((p, q) => Math.abs(q[1]) - Math.abs(p[1]));
    const max = Math.max(5, ...rows.map((p) => Math.abs(p[1])));
    $("factors").innerHTML = rows.slice(0, 8).map(([n, val]) => { const w = (Math.abs(val) / max) * 50, pos = val >= 0; return `<div class="factor"><span class="name">${esc(n)}</span><div class="fbar"><i style="left:${pos ? 50 : 50 - w}%;width:${w}%;background:${pos ? "var(--green)" : "var(--red)"}"></i></div><span class="val" style="color:${pos ? "var(--green)" : "var(--red)"}">${pos ? "+" : ""}${val.toFixed(1)}</span></div>`; }).join("") || `<div class="empty" style="padding:8px 0">Nothing yet.</div>`;
  };
  input.oninput = update;
  update();
  renderSuggestions();
  $("sugForm").onsubmit = (e) => { e.preventDefault(); suggest(false); };
  $("saveT").onclick = () => { const t = input.value.trim(); if (t) { store.set("fireiq.titles", [t, ...saved.filter((x) => x !== t)].slice(0, 30)); renderLab(v); } };
  v.onclick = (e) => {
    if (e.target.closest("#moreT")) return suggest(true);
    if (e.target.closest("a")) return;
    const r = e.target.closest("[data-t]"); if (r) { state.lab = r.dataset.t; input.value = r.dataset.t; update(); scrollTo({ top: 0, behavior: "smooth" }); }
  };
  input.focus();
}

// "more" asks for 5 titles that haven't been shown yet for this keyword and tool.
async function suggest(more) {
  const keyword = $("sugKw").value.trim();
  const tool = $("sugTool").value.trim();
  if (!keyword) return;
  if (!connected()) { state.sug = { error: "Not connected", auth: state.conn?.rejected ? "rejected" : "missing" }; return renderSuggestions(); }
  const same = state.sugKw === keyword && state.sugTool === tool;
  state.sugKw = keyword; state.sugTool = tool;
  if (!more || !same) state.sugShown = [];
  const prev = state.sug;
  state.sug = { loading: true, prev: more && same ? prev : null };
  renderSuggestions();
  const done = job(`Researching top YouTube titles for “${keyword}”`);
  try {
    state.sug = (await api("/api/titles", { keyword, tool, exclude: state.sugShown.join("\n") })).data;
    state.sugShown.push(...state.sug.titles.map((t) => t.title));
  } catch (e) { state.sug = { error: e.message, auth: e.auth }; }
  done();
  if (state.tab === "lab") renderSuggestions();
}
function renderSuggestions() {
  const el = $("sug"); if (!el) return;
  const s = state.sug;
  if (!s) { el.innerHTML = `<div class="note">Scrapes the most-viewed YouTube videos for the keyword with Firecrawl, works out which title patterns earn the most views, writes new titles in those patterns (and adapts the top titles to your tool), then picks 5 strong ones. Edit them so they match your video.</div>`; return; }
  if (s.loading) { el.innerHTML = Array.from({ length: 5 }, () => `<div class="skel" style="height:48px;margin-top:8px"></div>`).join(""); return; }
  if (s.error) { el.innerHTML = s.auth ? connectCard(s.auth) : `<div class="err" style="margin-top:10px">${esc(s.error)}</div>`; return; }
  el.innerHTML = `<table class="sug"><thead><tr><th>Title</th><th class="r">Score</th></tr></thead><tbody>
    ${s.titles.map((t) => `<tr data-t="${esc(t.title)}"><td><div>${esc(t.title)}<span class="pattern">${esc(t.pattern)}</span></div>
      ${t.inspired_by ? `<div class="from">Inspired by <a href="${esc(t.inspired_url)}" target="_blank" rel="noopener">${esc(t.inspired_by)}</a>${t.inspired_views ? ` · ${fmt(t.inspired_views)} views` : ""}</div>` : `<div class="from">From title-score: one of the framings that lifts vidIQ's score most</div>`}</td>
      <td class="r"><span class="badge ${t.score >= 70 ? "b-green" : t.score >= 50 ? "b-amber" : "b-red"}">${t.score}</span></td></tr>`).join("")}
  </tbody></table>
  <div class="note" style="display:flex;justify-content:space-between;align-items:center;gap:12px"><span>Click a title to score it above.</span><button class="btn ghost" id="moreT" style="height:34px">Suggest 5 more</button></div>
  <div class="research">
    <div>
      <h4>What's working for “${esc(state.sugKw)}”</h4>
      <div class="pats">${s.patterns.map((p) => `<div class="pat"><span>${esc(p.name)}</span><div class="pbar"><i style="width:${Math.round(p.share * 100)}%"></i></div><b>${Math.round(p.share * 100)}%</b></div>`).join("")}</div>
      <div class="note">Share of views among the ${s.studied} top videos studied. A title can use several patterns.</div>
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
document.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));

// Opens on "claude code": live when connected (cached after the first load), otherwise the saved run.
const DEFAULT_TOPIC = "claude code";
$("q").value = DEFAULT_TOPIC;
renderStatus();
render();
checkConnection().then(() => {
  if (connected()) research([DEFAULT_TOPIC], opts());
  else if (SNAPSHOT) openSnapshot(DEFAULT_TOPIC);
});
