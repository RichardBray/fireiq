#!/usr/bin/env python3
"""Find rising search topics with Firecrawl Trends (Alexandria).

For each seed term, pulls rising and top related queries, then compares the
strongest candidates over time so rising topics can be told apart from fading ones.
Every call costs 5 Firecrawl credits; the planned spend is printed before anything runs.

Usage:
  trend_scout.py "claude code" "ai agent" "web scraping" [--property youtube] [--geo US]
                 [--time "today 1-m"] [--compare 8] [--max-credits 100] [--json out.json]
"""
import argparse, concurrent.futures as cf, json, os, subprocess, sys, tempfile

CREDITS_PER_CALL = 5

p = argparse.ArgumentParser()
p.add_argument("seeds", nargs="+")
p.add_argument("--property", default="youtube", choices=["web", "images", "news", "youtube", "shopping"])
p.add_argument("--geo", default="US", help="ISO country, region (US-CA) or empty string for worldwide")
p.add_argument("--time", default="today 1-m")
p.add_argument("--compare", type=int, default=8, help="candidates to compare over time (0 to skip)")
p.add_argument("--max-credits", type=int, default=100)
p.add_argument("--json", dest="json_out")
args = p.parse_args()


def call(capability, options):
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
        out = f.name
    r = subprocess.run(["firecrawl", "scrape", f"firecrawl-trends/{capability}", "--options", json.dumps(options),
                        "--json", "-o", out], capture_output=True, text=True, stdin=subprocess.DEVNULL, timeout=120)
    try:
        return json.load(open(out))["data"]["alexandria"][0]["data"]
    except (OSError, ValueError, KeyError, IndexError):
        sys.stderr.write(f"{capability} {options.get('keyword') or options.get('keywords')}: failed: {(r.stderr or r.stdout)[-300:]}\n")
        return None
    finally:
        os.unlink(out)


# The anchor rides along in every comparison batch so batches share one 0-100 scale.
anchor = args.seeds[0]
batches = -(-args.compare // 4) if args.compare else 0
planned = (len(args.seeds) + batches) * CREDITS_PER_CALL
print(f"Planned: {len(args.seeds)} related-query calls + up to {batches} comparison calls = up to {planned} credits", file=sys.stderr)
if planned > args.max_credits:
    sys.exit(f"Over --max-credits {args.max_credits}; pass fewer seeds, a lower --compare, or raise the limit.")

base = {"geo": args.geo, "property": args.property, "time": args.time}
with cf.ThreadPoolExecutor(8) as ex:
    related = dict(zip(args.seeds, ex.map(lambda s: call("trends/related_queries", {**base, "keyword": s}), args.seeds)))

candidates = {}
for seed, d in related.items():
    for kind in ("rising", "top"):
        for q in (d or {}).get(kind) or []:
            c = candidates.setdefault(q["query"], {"query": q["query"], "seeds": [], "rising": None, "top": None})
            if seed not in c["seeds"]:
                c["seeds"].append(seed)
            c[kind] = q.get("formatted_value") or q.get("value")
            if kind == "rising":
                c["breakout"] = c.get("breakout") or bool(q.get("breakout"))
                c["rise_value"] = max(c.get("rise_value") or 0, q.get("value") or 0)

# Breakouts first, then the biggest rises, then terms that rose under more than one seed.
ranked = sorted(candidates.values(), key=lambda c: (bool(c.get("breakout")), c.get("rise_value") or 0, len(c["seeds"])), reverse=True)
rising_only = [c for c in ranked if c["rising"] is not None and c["query"] != anchor]

compared = []
if args.compare:
    picks = [c["query"] for c in rising_only[:args.compare]]
    groups = [picks[i:i + 4] for i in range(0, len(picks), 4)]
    with cf.ThreadPoolExecutor(4) as ex:
        results = list(ex.map(lambda g: call("trends/interest_over_time", {**base, "keywords": [anchor, *g]}), groups))
    for g, d in zip(groups, results):
        if not d:
            continue
        pts = d.get("points") or []
        for i, term in enumerate(g, start=1):
            series = [pt["values"][i] for pt in pts if not pt.get("partial")]
            if not series:
                continue
            recent = series[-7:]
            earlier = series[:-7] or series
            compared.append({
                "query": term,
                "avg": round(sum(series) / len(series), 1),
                "last_7d": round(sum(recent) / len(recent), 1),
                "momentum": "rising" if sum(recent) / len(recent) > 1.2 * sum(earlier) / len(earlier) else
                            "fading" if sum(recent) / len(recent) < 0.8 * sum(earlier) / len(earlier) else "steady",
                "anchor_avg": (d.get("averages") or [None])[0],
            })

report = {"seeds": args.seeds, "property": args.property, "geo": args.geo, "time": args.time, "anchor": anchor,
          "candidates": ranked, "compared": compared,
          "failed_seeds": [s for s, d in related.items() if d is None]}
if args.json_out:
    json.dump(report, open(args.json_out, "w"), indent=1, ensure_ascii=False)

print(f"\n## Rising {args.property} searches ({args.geo or 'worldwide'}, {args.time})\n")
print("| Query | Rise | Top score | Found under |")
print("|---|---|---|---|")
for c in rising_only[:40]:
    print(f"| {c['query']} | {c['rising']} | {c['top'] if c['top'] is not None else ''} | {', '.join(c['seeds'])} |")
if compared:
    print(f"\n## Over time (0-100, shared scale with \"{anchor}\")\n")
    print("| Query | Avg | Last 7 days | Momentum | Anchor avg |")
    print("|---|---|---|---|---|")
    for c in sorted(compared, key=lambda c: -c["last_7d"]):
        print(f"| {c['query']} | {c['avg']} | {c['last_7d']} | {c['momentum']} | {c['anchor_avg']} |")
if report["failed_seeds"]:
    print(f"\nFailed seeds (no data): {', '.join(report['failed_seeds'])}")
