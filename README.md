# fireIQ

YouTube research skills for coding agents, built on [Firecrawl](https://firecrawl.dev): find what people are searching for, see which titles already work, and score your own.

## Skills

| Skill | What it does | Built on |
|---|---|---|
| [`trend-scout`](skills/trend-scout) | Rising and breakout searches around your topics, compared over time, turned into video ideas with scored titles | Firecrawl Trends (Alexandria) |

Planned: `title-research` (top-performing titles for a topic), `title-score` (offline title scoring), `description` (description, tags and chapters from a transcript), `outliers` (videos far above their channel's usual views).

## App

[`app/`](app) is a vidIQ-style web app on the same data: rising YouTube searches, interest-over-time charts, a live title scorer and title suggestions from the most-viewed videos for a keyword. It runs on your own Firecrawl account: `cd app && bun install && bun server.ts`. See [app/README.md](app/README.md).

## Install

Needs the [Firecrawl CLI](https://docs.firecrawl.dev/sdks/cli), signed in with `firecrawl login`, and Python 3.

```sh
git clone <repo url> ~/fireiq
ln -sfn ~/fireiq/skills/trend-scout ~/.claude/skills/trend-scout
```

Then ask your agent for trending topics, or run `/trend-scout claude code, ai agent`.

## Cost

Each Firecrawl Trends call costs 5 credits. A `trend-scout` run with 5 seeds and 8 comparisons is about 35 credits, and the script prints the planned spend before it calls anything.

## Limits

Trends values are relative, not search counts, and there is no keyword-difficulty or competition data. Each skill says so in its report.
