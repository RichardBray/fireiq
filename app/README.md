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

## Sample data

Signed out, fireIQ runs on a saved sample for one topic (`public/data.js`): its keywords, charts and top videos for the leading ones, and title ideas for three. To rebuild it, which costs about 100 credits:

```sh
FIRECRAWL_API_KEY=fc-... bun scripts/make-sample.js "claude code"
```

## Deploy

```sh
bunx wrangler login
bunx wrangler secret put COOKIE_SECRET   # a long random string
bunx wrangler secret put GLM_API_KEY     # optional: Title Lab writes titles with GLM
bunx wrangler deploy
```

GLM is called on the OpenAI-style `chat/completions` route at `https://api.z.ai/api/paas/v4` with model `glm-5.3-flash`. Set `GLM_BASE_URL` or `GLM_MODEL` (as vars or secrets) to use another endpoint or model. Without `GLM_API_KEY`, or when GLM returns an error, Title Lab uses Firecrawl's language model as before. After a key or balance error, the Worker skips GLM for 10 minutes. Locally, add `GLM_API_KEY=...` to `.dev.vars`.

## Cost

| Action | Credits |
|---|---|
| Research a topic (rising, breakout and most-searched keywords) | 5 per topic |
| Click a keyword (chart) or compare keywords | 5 |
| A keyword's top videos (fetched when you click the keyword) | 2 |
| Suggest titles (top videos + trending searches + a language model) | up to 8 with GLM, up to 12 without; less for keywords you've already researched. "Suggest 5 more" is free |

Titles start loading before you ask for them: for the keyword a search selects (once its chart and videos are in), when you point at a keyword's **Suggest titles** button, when the Lab opens with a keyword filled in, when you pause typing one, or when you point at **Suggest 5 titles**. So a search costs about 10 credits more than the table shows, even if you never open the Lab.

## How title suggestions work

1. Scrape YouTube's results for the keyword sorted by views (all time and this year) and work out which title patterns earn the most views.
2. Get the rising, breakout and most-searched YouTube searches for the keyword from Trends (free if you already researched it on Overview).
3. A language model reads the top videos, works out what the subject is and what viewers click on, then writes 15 new titles, working the trending searches in where they fit, each naming the existing title whose pattern it borrows. It's told not to invent statistics. It uses GLM if the Worker has a key for it (no Firecrawl credits). Otherwise, or if GLM fails (for example no balance left), it scrapes the YouTube page again with Firecrawl's JSON format, which runs Firecrawl's language model over it (+4 credits).
4. Score all 15 with the title-score model. Titles that contain a phrase people are searching for now get a ranking bonus and a 🔍 tag; the title score itself is unchanged. Show the 5 strongest with different patterns. **Suggest 5 more** shows the next 5 without another call.

If both language models fail, `public/lib/titles.js` falls back to templates. Edit suggestions to match your video.

## Notes

- Title scores approximate vidIQ's; they're best for ranking options against each other.
- Trends values are relative (0–100), not search counts.
- Firecrawl limits requests per minute, so at most 3 calls run at once and a 429 waits for the reset.
- The YouTube parser in `public/lib/firecrawl.js` depends on YouTube's results page and may need updating if it changes.
- Sign in with Firecrawl uses the same browser flow as the Firecrawl CLI.
