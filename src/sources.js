// The entire source registry. Add a feed here and it shows up everywhere —
// rail, filters, keyboard shortcuts, dedupe weighting. Nothing else to touch.
//
// weight  : tie-breaker when the same story lands from several outlets. The
//           highest-weight copy becomes the canonical headline.
// kind    : wire | major | rumor | analysis | social  (drives the chip colour)
// nbaOnly : feed carries other sports too, so filter items down to basketball.

export const SOURCES = [
  {
    id: 'realgm', name: 'RealGM', short: 'RGM', kind: 'wire', weight: 1.0,
    url: 'https://basketball.realgm.com/rss/wiretap/0/0.xml',
    site: 'https://basketball.realgm.com',
  },
  {
    id: 'espn', name: 'ESPN', short: 'ESPN', kind: 'major', weight: 0.98,
    url: 'https://www.espn.com/espn/rss/nba/news',
    site: 'https://www.espn.com/nba/',
  },
  {
    id: 'hoopsrumors', name: 'Hoops Rumors', short: 'HR', kind: 'rumor', weight: 0.94,
    url: 'https://www.hoopsrumors.com/feed',
    site: 'https://www.hoopsrumors.com',
  },
  {
    id: 'yahoo', name: 'Yahoo Sports', short: 'YHO', kind: 'major', weight: 0.90,
    url: 'https://sports.yahoo.com/nba/rss.xml',
    site: 'https://sports.yahoo.com/nba/',
  },
  {
    id: 'cbs', name: 'CBS Sports', short: 'CBS', kind: 'major', weight: 0.88,
    url: 'https://www.cbssports.com/rss/headlines/nba/',
    site: 'https://www.cbssports.com/nba/',
  },
  {
    id: 'sbnation', name: 'SB Nation', short: 'SBN', kind: 'analysis', weight: 0.82,
    url: 'https://www.sbnation.com/rss/nba/index.xml',
    site: 'https://www.sbnation.com/nba',
  },
  {
    id: 'rotowire', name: 'RotoWire', short: 'RW', kind: 'wire', weight: 0.80,
    url: 'https://www.rotowire.com/rss/news.php?sport=NBA',
    site: 'https://www.rotowire.com/basketball/',
  },
  {
    id: 'clutchpoints', name: 'ClutchPoints', short: 'CP', kind: 'analysis', weight: 0.72,
    url: 'https://clutchpoints.com/feed',
    site: 'https://clutchpoints.com/nba',
    nbaOnly: true,
  },
  {
    id: 'talkbasket', name: 'TalkBasket', short: 'TB', kind: 'analysis', weight: 0.66,
    url: 'https://talkbasket.net/feed',
    site: 'https://talkbasket.net',
  },
  {
    id: 'sportingnews', name: 'Sporting News', short: 'SN', kind: 'major', weight: 0.64,
    url: 'https://www.sportingnews.com/us/rss',
    site: 'https://www.sportingnews.com/us/nba',
    nbaOnly: true,
  },
  {
    id: 'reddit', name: 'r/nba', short: 'RDT', kind: 'social', weight: 0.40,
    url: 'https://www.reddit.com/r/nba/hot/.rss',
    site: 'https://www.reddit.com/r/nba/',
    // Reddit 429s anything that polls its public RSS on a tight loop.
    intervalMs: 300_000,
  },
];

// HoopsHype was requested but is deliberately absent: it retired its RSS feed
// (every /feed, /rss, /wp-json path 404s behind a Next.js app) and its
// robots.txt disallows anthropic-ai / Claude / Claude-Web by name. Hoops Rumors
// above covers the same rumour beat. To add it back, drop an entry in.

export const BY_ID = new Map(SOURCES.map((s) => [s.id, s]));
