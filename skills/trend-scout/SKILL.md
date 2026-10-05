---
name: trend-scout
description: Find YouTube video topics people are searching for right now with Firecrawl Trends - rising and breakout searches around seed terms, compared over time so rising topics stand out from fading ones - then turn the best into ranked video ideas with scored titles. Use when the user asks for trending topics, keyword research, video ideas backed by search data, what people are searching for, or a free alternative to vidIQ or keyword tools.
user-invocable: true
argument-hint: "[seed terms, e.g. 'claude code, ai agent, web scraping'] [--web | --youtube] [--geo US]"
---

# trend-scout

Pipeline: **seeds → rising searches → compare over time → filter → ideas → titles**.

Depends on the `firecrawl` CLI, authenticated (`firecrawl login`). Every Trends call costs 5 credits; a typical run of 5 seeds and 8 comparisons is about 35 credits.

```bash
SKILL_DIR=<absolute path of the directory containing this SKILL.md>
SCORE="$SKILL_DIR/../title-score/scripts/score.py"
for d in ~/.claude/skills ~/.claude-work/skills; do [ -f "$SCORE" ] || SCORE="$d/title-score/scripts/score.py"; done
```

The loop finds `title-score` when it's installed as a skill of its own rather than next to this one.

## Step 1: Seeds

Use the user's seed terms. If they gave none, ask what the channel covers and suggest 4 to 8 broad seeds (e.g. "claude code", "ai agent", "local llm"). Broad seeds surface more rising queries than narrow ones. Default to YouTube searches in the US over the last month; use `--property web` for blog or SEO topics.

## Step 2: Pull the data

```bash
python3 "$SKILL_DIR/scripts/trend_scout.py" "claude code" "ai agent" "local llm" --json /tmp/trend-scout.json
```

Options: `--property youtube|web|news|shopping|images`, `--geo US` (or `""` for worldwide, `US-CA` for a state), `--time "today 1-m"` (also `now 7-d`, `today 3-m`, `today 12-m`), `--compare 8` (candidates to compare over time, 0 to skip), `--max-credits 100`.

The script prints the planned spend first and refuses to run past `--max-credits`.

## Step 3: Filter

Read the tables and drop noise before suggesting anything:
- Queries that match the seed's words but not its meaning (for "codex": Warhammer, Magic: The Gathering, games).
- Pure news names with no angle (a sports game, a celebrity).
- Non-English variants, unless the user makes content in that language.
- Anything the user has already made. If they have a channel, check their recent uploads (their channel's RSS feed: `https://www.youtube.com/feeds/videos.xml?channel_id=<id>`) or ask.

Group what is left into topics: several rising queries are often one topic ("claude code local llm" + "best local llm for coding" + "free claude code").

## Step 4: Ideas

For each of the best 5 to 8 topics give:
- **The topic and the angle**: what the video promises the viewer.
- **The evidence**: each rising query with its value (Breakout or +N%), its top score if it has one, and its momentum from the over-time table.
- **Why now or why evergreen**: breakouts are a window that closes; high "top" scores with steady momentum are evergreen search topics that keep earning views.
- **The risk**: a fading trend, a crowded topic, or a term that is mostly noise.

## Step 5: Titles

Draft 3 titles for each of the top 3 topics and score them:

```bash
printf "Title one\nTitle two\n" | python3 "$SCORE" -
```

If `$SCORE` doesn't exist, the `title-score` skill isn't installed: say so and give the titles unscored. Report scores as a ranking, not as vidIQ's own numbers.

## Be honest about the data

Say these once per report:
- Trends values are **relative**, not search counts. "Breakout" means very fast growth (often from a small base), and "+170%" can be a small number of searches. The "top" score (0 to 100) is the better signal of size.
- The over-time table shares one scale with the first seed (the anchor), so values compare within one run, not across runs.
- There is no competition or keyword-difficulty data: a rising topic can already be crowded. Search YouTube for the topic before committing.
- Never invent a value. If a seed failed, say so.
