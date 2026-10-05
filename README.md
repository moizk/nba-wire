# NBA WIRE

Every NBA feed on one screen. ~380 items pulled from 11 outlets each cycle, de-duplicated
into ~270 ranked stories, rendered once, and served precompressed from memory. Today's games,
with live scores, sit in the middle column.

**Stormtrooper shell**: flat white surfaces throughout, hairline seams, no gradients or
drop shadows. The only black left is the wordmark badge and whatever is actively selected.
Full-screen, three panes, keyboard-driven.

```bash
npm start          # http://localhost:8420
```

Node 20+. **Zero runtime dependencies** — no framework, no bundler, no build step. Runs
either as a Node server or on Cloudflare Workers; see [Deploying](#deploying).

---

## Why it's fast

The design rule is that **nothing happens on the request path**. Feeds are polled on a
background timer; the page is rendered once per cycle; both encodings are compressed once
per cycle. Serving a request is a `Map` lookup and a socket write.

Measured on this machine (3,000 requests, 50 concurrent connections, keep-alive;
reproduce with `node .claude/tmp/bench.mjs`):

| Request | Throughput | p50 | p99 | Bytes |
|---|---|---|---|---|
| `GET /` (brotli) | 32,445 req/s | 1.26 ms | 3.84 ms | 46 kB |
| `GET /` (gzip) | 35,155 req/s | 1.28 ms | 2.75 ms | 59 kB |
| `GET /` revalidated → `304` | 54,942 req/s | 0.82 ms | 3.01 ms | 0 |
| `GET /api/status` | 62,118 req/s | 0.74 ms | 1.66 ms | 63 B |

The full page is **258 kB of HTML → 48 kB Brotli**, and that single response contains the
CSS and the client script inline, so a cold load is *one* request with no
render-blocking round trips. There are no web fonts. Repeat visits usually cost a `304`
with an empty body.

Other deliberate choices:

- **Brotli quality 11 / gzip level 9.** Affordable precisely because it runs once per
  refresh, off the request path.
- **Filtering never re-renders.** Every row is in the DOM once; search, source and team
  filters toggle a single class, against a search haystack cached per row.
- **`content-visibility: auto`** on rows, so the browser skips layout for the ~250
  stories below the fold.
- **Conditional polling.** Each source's `ETag`/`Last-Modified` is replayed on the next
  cycle; unchanged feeds cost a 304. In steady state ~6 of 11 sources return 304 and a
  refresh drops from ~2.0 s to ~1.35 s.

## How the mashup works

1. **Fetch** — all sources in parallel, 9 s timeout each. A failure falls back to the last
   good payload and shows amber in the Feed Health panel, so one bad feed never blanks the
   wire. A well-formed feed that is simply empty reports "no items" rather than failing —
   RotoWire's NBA feed empties out between games.
2. **Parse** — a small RSS 2.0 + Atom reader. Handles CDATA, double-encoded entities,
   `media:*` / `enclosure` artwork, and per-feed charsets (RealGM still ships ISO-8859-1).
3. **Clean** — drops feed furniture (promo rows, subreddit megathreads, link roundups),
   Getty photo captions that outlets put in `<description>` instead of article text, and
   WordPress "The post … appeared first on …" footers.
4. **De-duplicate** — near-identical headlines cluster by Jaccard similarity over
   significant tokens. The heaviest outlet's wording becomes canonical; the rest become
   corroboration. Distinct outlets only — two Yahoo posts about one signing is Yahoo
   repeating itself, not the league confirming it.
5. **Rank** — recency (6 h half-life) 62%, outlet weight 22%, corroboration 16%.
6. **Tag** — all 30 teams detected from headline aliases, and everything that isn't
   men's NBA basketball is dropped (see below).

### Keeping it NBA

Almost every feed here carries something else — NFL and golf cross-promos in the ESPN and
CBS "NBA" feeds, the WNBA in RealGM's and TalkBasket's, and whole other sports in
ClutchPoints'. Filtering runs in two modes, because one setting cannot serve both cases:

- **Lenient (every source).** Rejects only what positively advertises another sport. An
  `/nba/` path wins outright; another sport as its own path segment (`/nfl/`, `/golf/`)
  is an immediate rejection; then the sport buried in a slug under a generic section
  (`/editorials/flyers-…-nhl-free-agency`); then vocabulary that gives the game away
  (`touchdown`, `quarterback`, `innings`). Costs **0** stories on RealGM, Hoops Rumors,
  SB Nation and r/nba while clearing the cross-promos out of ESPN, Yahoo, CBS and
  TalkBasket.
- **Strict (`nbaOnly`: ClutchPoints, Sporting News).** Additionally *requires* positive
  evidence of basketball. Reserved for feeds that are mostly not NBA — ClutchPoints ships
  75 items of which ~4 are. Applying it everywhere was measured and rejected: it would
  drop "Rookie Extension Market Remains Quiet With Only Victor Wembanyama" from RealGM and
  "Kyrie Irving says Kobe Bryant gave him 'The Alchemist'" from TalkBasket.

Two rules do the heavy lifting:

**Team nicknames count, bare cities do not.** `TEAMS` keeps `nicknames` and `cities`
apart. Tagging uses both, but the filter trusts only nicknames — "Memphis", "Boston" and
"Philadelphia" are also college-football, NFL and NHL cities, which is how
"UNLV QB Jackson Arnold … vs. Memphis" once led the wire as a Grizzlies story.

**The WNBA is excluded, on every source.** It is a separate league on an NBA wire, so it
is rejected rather than accepted as a basketball signal — matched by league name, by
`/wnba/` paths and slugs, and by city-qualified team names (bare "Storm", "Sky", "Sun" and
"Fever" are ordinary words, so "Nuggets storm back to beat Suns" survives). An explicit
`/nba/` path still outranks a WNBA mention, which keeps genuine crossover stories like
`/nba/news/timberwolves-lynx-ownership-shakeup-nba-wnba-marc-stad`.

Stories carried by two or more independent outlets surface in **Trending**.

## Games

The middle column is the day's slate: tip time (in the viewer's own zone), national TV,
and once a game starts the score and clock, with the winner bolded at the final. A date
switcher in its cap steps one day either way — **yesterday, today, tomorrow** — with the
arrows or `[` / `]`. All three days are rendered into the page, so switching costs no request.

Data comes from ESPN's per-day scoreboard (`src/games.js`), fetched alongside the feeds on
every cycle. This is the Worker-shaped version of the old
[nba-schedule-2025-26](https://github.com/moizk/nba-schedule-2025-26) Ruby scraper. That
project pulled NBA.com's whole-season `scheduleLeagueV2.json` once and wrote it to disk.
Here each cycle fetches three days, ~10 kB of JSON, which also carries live scores. NBA's
CDN was dropped as a source because it 403s non-browser clients.

- **NBA days are Eastern days**, and "today" rolls over at **6am ET**, so a late West Coast
  game still reads as today until it ends.
- **ESPN's edge 403s any User-Agent containing a URL**, including the one every RSS feed
  accepts, so scores are fetched as plain `nbawire/1.0`.
- **Logos** come through ESPN's resizer at 48px (~3 kB) instead of the 80 kB originals.
- A failed day keeps its last good copy and shows amber as *ESPN Scores* in Feed Health.

The client polls one route for both moving parts. Scores swap in place; a new story list
still waits behind the **New wire** pill.

## Interface notes

The wire owns the left column and takes all the width it can — it is the product. The
games take a fixed middle column, and the right column stacks **Sources**, **Trending** and **Feed Health**, with Sources collapsed
by default so it costs a 33px cap bar until you want it. Opening it is remembered in
`localStorage`; `s` toggles it, and `1`–`9` open it so a shortcut's effect is visible.
While it is shut, any active filter shows as a dark badge on its cap, so you can never end
up filtered without seeing why.

The nav is a white plate like every other surface, carrying only the wordmark, search and
— when there is news — the **New wire** button. Counts live in the status strip at the
bottom instead of the header, where `#count` tracks the current filter live rather than
sitting in the way. Feed timings stay in the Feed Health panel.

Chips (source, team, outlet count) are uniform soft grey rather than filled black — they
are metadata under the headline, not competing with it. Kind is carried by a faint tint on
the label instead of a coloured block. Every grey still clears 4.5:1 against its own
background, so "low contrast" stays readable at 9.5px:

| | ratio |
|---|---|
| source chip | 4.52 |
| team chip | 5.07 |
| summary text | 4.59 |
| outlet-count chip | 6.54 |

## Keyboard

| | |
|---|---|
| `j` / `k` , `↓` / `↑` | move |
| `↵` / `o` | open in a new tab |
| `/` | search |
| `1`–`9` | filter by source (opens the panel) |
| `[` / `]` | previous / next day of games |
| `s` | show/hide sources |
| `0` | clear filters |
| `g` / `G` | top / bottom |
| `r` | refresh now |
| `esc` | clear search / deselect |

## Sources

RealGM · ESPN · Hoops Rumors · Yahoo Sports · CBS Sports · SB Nation · RotoWire ·
ClutchPoints · TalkBasket · Sporting News · r/nba

All 11 are verified live. Add or remove one in [`src/sources.js`](src/sources.js) — a feed
registered there automatically gets a sources-panel entry, a filter, a keyboard shortcut, a
health row and dedupe weighting. Nothing else to touch.

> **On HoopsHype:** it was requested but is deliberately excluded. It retired RSS entirely
> (every `/feed`, `/rss`, `/wp-json` path 404s behind a Next.js app) and its `robots.txt`
> disallows `anthropic-ai`, `Claude` and `Claude-Web` by name, so it is not scraped here.
> Hoops Rumors covers the same rumour beat. Drop an entry into `src/sources.js` if you have
> your own arrangement with them.

Two source quirks worth knowing, both discovered by measurement:

- **A plain descriptive `User-Agent` is sent** (`nbawire/1.0 (+https://nbawire.org)`).
  The rule is narrower than "browser UAs get blocked": ESPN answers a *browser* UA with an
  empty `202` and Reddit `429`s one, but both accept an honest identifying agent. Sending
  none is not an option either — Reddit `403`s it, which is exactly what Workers do by
  default, where Node quietly sends `node`. This one string returns `200` from all 11.
- **Reddit polls every 5 minutes** (`intervalMs`), not every cycle, because it rate-limits
  tight pollers.

## Routes

| | |
|---|---|
| `/` | the console |
| `/api/wire` | full ranked wire, plus the three days of games, as JSON |
| `/api/status` | `{sig, builtAt, stories}` |
| `/fragment/live` | `{v, list, games, today}`: the story list and games panel, for in-place updates |
| `/healthz` | liveness + per-feed status |

The client sends a conditional request for `/fragment/live` every 45 s and on tab focus,
so an unchanged build costs a `304`. Games are replaced right away. The list is offered
through the **New wire** pill only when `v`, the list's own ETag, has changed, so a score
update alone never pops the pill.

## Deploying

Because every route is precomputed on a timer, this deploys as a **Cloudflare Worker**:
a Cron Trigger rebuilds the wire and writes it to KV, and the fetch handler only reads KV
and returns bytes. Nothing renders per request.

```bash
npx wrangler login
npx wrangler kv namespace create WIRE   # paste the printed id into wrangler.toml
npm run cf:deploy
```

Then attach the domain: put the site's nameservers on Cloudflare, uncomment the `routes`
block in `wrangler.toml`, and deploy again. `npm run cf:tail` streams live logs.

The first request after a deploy returns a "warming up" page and kicks off a build, so you
don't have to wait for the first cron tick.

### Why Workers, measured

The refresh splits into two very different costs:

| stage | CPU |
|---|---|
| parse 11 feeds (1.4MB XML) | 11ms |
| clean, de-duplicate, cluster, rank | 9ms |
| render HTML | 0.6ms |
| **the actual work** | **~22ms** |
| brotli quality 11 | 203ms |

So **the Worker does not compress** — Cloudflare compresses at the edge, and doing it
in-process would have been 90% of the CPU budget for no gain. The Node server keeps its
precompression, which is still right when it *is* the origin.

Budget notes: serving is a KV read and is nowhere near any limit, but the ~22ms rebuild
exceeds the free plan's 10ms CPU per invocation, so the cron wants Workers Paid ($5/mo).
KV reads use `cacheTtl: 60` to keep hot routes in the colo cache. A run that changes
anything writes 3 keys (`page`, `live`, `wire`); the games ride inside `live` and `wire`
rather than taking a fourth key, which would push `*/5` past the free plan's 1,000
writes/day. Scores are part of the build signature, so on game nights almost every cycle
writes.

A build that produces zero stories is never published — if every feed fails, the previous
wire keeps serving.

### Running it as a plain server instead

`npm start` still serves everything from Node with brotli precompression, which is what you
want on a VPS. Put Cloudflare in front for TLS and set
`cache-control: public, max-age=0, s-maxage=60, stale-while-revalidate=120` so the edge
absorbs the traffic.

## Config

| env | default | |
|---|---|---|
| `PORT` | `8420` | Node server only |
| `HOST` | `0.0.0.0` | Node server only |
| `REFRESH_MS` | `90000` | Node poll interval; on Workers the cron in `wrangler.toml` sets this |

## Layout

Everything under `src/` except `server.js` is runtime-agnostic — no `node:` imports, no
`Buffer` — so the same pipeline runs under Node and under Workers.

```
src/
  server.js      Node entry: HTTP, brotli/gzip precompression, ETag/304, CSP
  feeds.js       parallel polling, per-source intervals, conditional requests
  games.js       ESPN scoreboards for yesterday/today/tomorrow
  parse.js       RSS + Atom reader, entity/CDATA/charset handling
  normalize.js   cleaning, de-duplication, clustering, ranking
  teams.js       30-team detection, mixed-sport and WNBA filtering
  render.js      HTML rendering, asset inlining, CSP hashes
  hash.js        Web Crypto helpers (identical in Node and Workers)
  sources.js     the feed registry — the only file you need to edit
  ui/app.css     the flat white shell
  ui/app.js      filtering, keyboard, date switcher, live updates
worker/
  index.js       Workers entry: Cron Trigger rebuild + KV-backed fetch handler
scripts/
  build-assets.mjs   bakes ui/app.{css,js} into a module for the Worker
```

Local development has no build step: the Node server reads the CSS and client script off
disk. Only `npm run cf:deploy` bakes them into `worker/assets.generated.js`, because a
Worker has no filesystem.

## Security

Responses carry a strict CSP built from **SHA-256 hashes of the inlined blocks** — no
`unsafe-inline` anywhere — plus `nosniff`, `no-referrer` and `frame-ancestors 'none'`.
All feed-derived text is escaped, and only `http(s)` URLs are ever emitted as links, so a
`javascript:` URL in a feed can't become a live link.
