# fireIQ app

A small YouTube research app in the style of vidIQ, running on your own Firecrawl account.

- **Overview / Keywords:** rising and breakout YouTube searches for your topics from Firecrawl Trends. Click a keyword for its stats and a 0–100 interest-over-time chart.
- **Title Lab:** scores a title as you type, and suggests titles from the most-viewed YouTube videos for a keyword.

## Run it

Needs [Bun](https://bun.sh) and a Firecrawl account (the free plan includes 1,000 credits a month).

```sh
bun install
bun server.ts
```

Open http://localhost:4321 and press **Sign in with Firecrawl**, or **Add API key**. The key is stored in your browser and sent to the server in an `x-firecrawl-key` header. To skip signing in locally, start the server with `FIRECRAWL_API_KEY=fc-... bun server.ts`; **Disconnect** in the nav stops the page using that key.

## Cost

| Action | Credits |
|---|---|
| Research a topic (rising and breakout keywords) | 5 per topic |
| Click a keyword (interest-over-time chart) | 5 |
| Suggest titles for a keyword | 2 |
| A keyword's top videos (fetched when you click the keyword, shared with title suggestions) | 2 |

Responses are cached in `data/cache/`, so repeating something costs nothing.

## How title suggestions work

No LLM is involved. `lib/titles.ts` follows the title-research skill's steps in code:

1. Scrape YouTube's results for the keyword sorted by views, for all time and for this year.
2. Work out which title patterns (how to, versus, "I did X", a year, a question…) earn the most views.
3. Write candidates from templates for that kind of keyword (a product, an "X alternative", "X vs Y", "how to …", or a topic), and adapt the top titles to your tool if you give one.
4. Score them all with the title-score model and pick 5 strong ones with different patterns. **Suggest 5 more** gives 5 you haven't seen.

Suggestions are templates, so edit them to match your video.

## Notes

- Title scores approximate vidIQ's; they're best for ranking options against each other.
- Trends values are relative (0–100), not search counts.
- Firecrawl limits requests per minute, so the server runs at most 3 calls at once and waits out a 429.
- The YouTube parser in `lib/fireiq.ts` depends on YouTube's results page and may need updating if it changes.

## Files

- `server.ts`: Bun server for the page and the `/api` routes, plus the sign-in status proxy.
- `lib/fireiq.ts`: Firecrawl Node SDK calls. `lib/titles.ts`: the title suggester.
- `index.html`, `app.js`: the page. `score.js` + `model.js`: the title-score model in JavaScript.
- `data.js`: a saved Trends run, shown when you're not connected.
