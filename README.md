# NBA WIRE

Every NBA feed on one screen. ~380 items pulled from 11 outlets each cycle, de-duplicated
into ~270 ranked stories, rendered once, and served precompressed from memory.

**Stormtrooper shell**: flat white surfaces throughout, hairline seams, no gradients or
drop shadows. The only black left is the wordmark badge and whatever is actively selected.
Full-screen, three panes, keyboard-driven.

```bash
npm start          # http://localhost:8420
```

Node 20+. **Zero runtime dependencies** — no framework, no bundler, no build step.

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

## Interface notes

The wire owns the left column and takes all the width it can — it is the product. The
right column stacks **Sources**, **Trending** and **Feed Health**, with Sources collapsed
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

- **No `User-Agent` is sent.** ESPN answers a browser UA with an empty `202`, and Reddit
  `429`s any custom UA. The default agent is the one string all 11 accept.
- **Reddit polls every 5 minutes** (`intervalMs`), not every cycle, because it rate-limits
  tight pollers.

## Routes

| | |
|---|---|
| `/` | the console |
| `/api/wire` | full ranked wire as JSON |
| `/api/status` | `{sig, builtAt, stories}` — what the client polls |
| `/fragment/list` | the story list, for in-place updates |
| `/healthz` | liveness + per-feed status |

The client polls `/api/status` every 45 s and on tab focus. When the signature changes it
fetches `/fragment/list` and offers a **New wire** pill rather than yanking the list out
from under you.

## Config

| env | default | |
|---|---|---|
| `PORT` | `8420` | |
| `HOST` | `0.0.0.0` | |
| `REFRESH_MS` | `90000` | feed poll interval |

## Layout

```
src/
  server.js      HTTP, precompressed response cache, ETag/304, CSP
  feeds.js       parallel polling, per-source intervals, conditional requests
  parse.js       RSS + Atom reader, entity/CDATA/charset handling
  normalize.js   cleaning, de-duplication, clustering, ranking
  teams.js       30-team detection, mixed-sport filtering
  render.js      HTML rendering, inlining, CSP hashes
  sources.js     the feed registry — the only file you need to edit
  ui/app.css     the flat white shell
  ui/app.js      filtering, keyboard, live updates
```

## Security

Responses carry a strict CSP built from **SHA-256 hashes of the inlined blocks** — no
`unsafe-inline` anywhere — plus `nosniff`, `no-referrer` and `frame-ancestors 'none'`.
All feed-derived text is escaped, and only `http(s)` URLs are ever emitted as links, so a
`javascript:` URL in a feed can't become a live link.
