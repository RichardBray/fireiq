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
| Suggest titles for a keyword (YouTube research + Firecrawl's language model) | 7 (2 if the videos are cached); "Suggest 5 more" is free |
| A keyword's top videos (fetched when you click the keyword, shared with title suggestions) | 2 |

Responses are cached in `data/cache/`, so repeating something costs nothing.

## How title suggestions work

1. Scrape YouTube's results for the keyword sorted by views, for all time and for this year, and work out which title patterns earn the most views.
2. Scrape the same page with Firecrawl's JSON format, which runs a language model over it (+4 credits). It reads what the subject is and what viewers click on, then writes 15 new titles, each naming the existing title whose pattern it borrows. It's told not to invent statistics and to name your tool in every title if you give one.
3. Score all 15 with the title-score model and show the 5 strongest with different patterns. **Suggest 5 more** shows the next 5 without another call.

If the language model call fails, it falls back to `lib/titles.ts`'s templates, so you still get suggestions. Edit them to match your video.

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
