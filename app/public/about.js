const $ = (id) => document.getElementById(id);
const form = $("fb"), msg = $("fbMsg"), btn = form.querySelector('button[type="submit"]');
const say = (text, kind = "") => { msg.textContent = text; msg.className = `msg ${kind}`; };

// Feedback goes out as the viewer's Firecrawl team, so it needs the sign-in cookie fireIQ already uses.
let connected = false;
fetch("/api/me").then((r) => r.json()).then((me) => {
  connected = !!me.connected;
  if (!connected) say("Sign in on the fireIQ app first, then come back to send this.");
}).catch(() => {});

const HINTS = {
  FEEDBACK_WINDOW_EXPIRED: "Firecrawl takes Alexandria feedback within 20 minutes of your last search. Run a search in fireIQ, then send this again.",
  TEAM_OPTED_OUT: "Your Firecrawl team has turned feedback off. Use Contact Firecrawl below instead.",
};
form.onsubmit = async (e) => {
  e.preventDefault();
  const data = new FormData(form);
  const body = { features: data.getAll("features"), details: data.get("details"), objective: data.get("objective"), rating: data.get("rating") };
  if (!body.features.length && !String(body.details).trim()) return say("Pick a feature or tell us what you'd want.", "err");
  if (!body.rating) return say("Pick how useful fireIQ is today.", "err");
  if (!connected) return say("Sign in on the fireIQ app first, then come back to send this.", "err");
  btn.disabled = true;
  say("Sending…");
  try {
    const r = await fetch("/api/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(HINTS[j.code] || j.error || "Couldn't send. Try again in a moment.");
    form.reset();
    say("Thanks! Firecrawl has your feedback.", "ok");
  } catch (err) { say(err.message, "err"); }
  btn.disabled = false;
};
