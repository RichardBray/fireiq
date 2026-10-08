# fireIQ app

A small YouTube research app in the style of vidIQ, running on your own Firecrawl account.

- **Overview / Keywords:** rising, breakout and most-searched YouTube keywords for your topics from Firecrawl Trends. Click a keyword for a 0–100 interest-over-time chart; tick up to 5 to compare them.
- **Videos:** YouTube's top videos for a keyword with outlier badges and thumbnails. **Hot right now** (the default) ranks them by views per day, so recent videos that are taking off stand out; **Most viewed** ranks by total views.
- **Title Lab:** scores a title as you type, suggests titles from the most-viewed videos for a keyword, and keeps the ones you star.

## How it's built

- `public/`: the page, served as static files. Firecrawl calls run from the browser through the Worker, and results are cached in the browser's IndexedDB, so repeating something costs nothing.
- `worker/index.ts`: a [Hono](https://hono.dev) app on Cloudflare Workers. **Sign in with Firecrawl** (or **Use an API key instead**) stores the key in an encrypted `HttpOnly` cookie that page scripts can't read. The Worker adds it to requests and only forwards the calls fireIQ makes: Trends and YouTube results pages.

## Run it locally

Needs [Bun](https://bun.sh).

```sh
bun install
echo "COOKIE_SECRET=$(openssl rand -base64 48)" > .dev.vars
bunx wrangler dev
```

## Deploy

```sh
bunx wrangler login
bunx wrangler secret put COOKIE_SECRET   # a long random string
bunx wrangler deploy
```

## Cost

| Action | Credits |
|---|---|
| Research a topic (rising, breakout and most-searched keywords) | 5 per topic |
| Click a keyword (chart) or compare keywords | 5 |
| A keyword's top videos (fetched when you click the keyword) | 2 |
| Suggest titles (top videos + trending searches + Firecrawl's language model) | up to 12, less for keywords you've already researched; "Suggest 5 more" is free |

Title Lab starts loading suggestions before you press **Suggest**: when it opens with a keyword filled in, when you pause typing a keyword, or when you point at the button. So opening the Lab with a new keyword spends those credits even if you never press it.

## How title suggestions work

1. Scrape YouTube's results for the keyword sorted by views (all time and this year) and work out which title patterns earn the most views.
2. Get the rising, breakout and most-searched YouTube searches for the keyword from Trends (free if you already researched it on Overview).
3. Scrape the same YouTube page with Firecrawl's JSON format, which runs a language model over it (+4 credits). It reads what the subject is and what viewers click on, then writes 15 new titles, working the trending searches in where they fit, each naming the existing title whose pattern it borrows. It's told not to invent statistics.
4. Score all 15 with the title-score model. Titles that contain a phrase people are searching for now get a ranking bonus and a 🔍 tag; the title score itself is unchanged. Show the 5 strongest with different patterns. **Suggest 5 more** shows the next 5 without another call.

If the language model call fails, `public/lib/titles.js` falls back to templates. Edit suggestions to match your video.

## Notes

- Title scores approximate vidIQ's; they're best for ranking options against each other.
- Trends values are relative (0–100), not search counts.
- Firecrawl limits requests per minute, so at most 3 calls run at once and a 429 waits for the reset.
- The YouTube parser in `public/lib/firecrawl.js` depends on YouTube's results page and may need updating if it changes.
- Sign in with Firecrawl uses the same browser flow as the Firecrawl CLI.
