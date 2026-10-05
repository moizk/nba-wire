import { stripHtml } from './parse.js';
import { detectTeams, looksLikeNBA, otherSportSignal, isWomensBasketball, isNonNbaBasketball } from './teams.js';

// ---------------------------------------------------------------------------
// URL canonicalisation
// ---------------------------------------------------------------------------

const TRACKING = /^(utm_|ico$|cmp$|cmpid$|ref$|ref_src$|src$|smid$|partner$|yptr$|guccounter$|__twitter|fbclid$|gclid$)/i;

export function canonicalUrl(raw) {
  try {
    const u = new URL(raw);
    u.hash = '';
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    u.protocol = 'https:';
    // RotoWire emits https://host//path — collapse the duplicate separators.
    u.pathname = u.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';
    for (const k of [...u.searchParams.keys()]) {
      if (TRACKING.test(k)) u.searchParams.delete(k);
    }
    return u.toString();
  } catch {
    return raw;
  }
}

/** Bare domain, for the "via" label under a headline. */
export function displayHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Title fingerprinting
// ---------------------------------------------------------------------------

const STOP = new Set([
  'a','an','the','and','or','but','of','in','on','at','to','for','with','from','by','as','is','are','was','were','be','been','has','have','had','will','would','could','should','after','before','into','over','about','his','her','their','its','it','he','she','they','this','that','these','those','says','said','report','reports','reportedly','per','via','new','nba',
]);

const WORD_RE = /[a-z0-9']+/g;

/** Significant lowercase tokens of a headline. */
export function tokens(title) {
  const out = new Set();
  const lower = title.toLowerCase();
  let m;
  WORD_RE.lastIndex = 0;
  while ((m = WORD_RE.exec(lower))) {
    const w = m[0];
    if (w.length > 2 && !STOP.has(w)) out.add(w);
  }
  return out;
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const t of small) if (large.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

// ---------------------------------------------------------------------------
// Summary hygiene
// ---------------------------------------------------------------------------

// Several feeds (Yahoo especially) put the lead photo's Getty caption in
// <description> instead of article text: "BOSTON, MASSACHUSETTS - FEBRUARY 06:
// Anthony Davis #3 ... at the TD Garden on ...". A caption tells the reader
// nothing the headline didn't, so it is dropped rather than shown.
const CAPTION_LEAD = /^[A-Z][A-Z\s.,'&\/-]{2,48}[-\u2013\u2014]\s*[A-Z][a-zA-Z]{2,9}\.?\s+\d{1,2}(?:,\s*\d{4})?\s*[:,-]/;
const CAPTION_MARK = /\bNOTE TO USER\b|\(Photo by |\bGetty Images\b|\bvia Getty\b|\bAP Photo\b/i;

// WordPress feeds append a self-referential footer to every item.
const WP_FOOTER = /\s*The post .{0,160}? appeared first on .{0,60}?\.?\s*$/i;

function cleanSummary(raw, title) {
  let s = (raw || '').replace(WP_FOOTER, '').trim();
  if (!s) return '';
  if (CAPTION_LEAD.test(s)) return '';
  if (CAPTION_MARK.test(s.slice(0, 220))) return '';
  // A summary that merely restates the headline is noise in a dense list.
  const t = title.toLowerCase().replace(/[^a-z0-9 ]/g, '');
  if (s.toLowerCase().replace(/[^a-z0-9 ]/g, '').startsWith(t.slice(0, 60))) return '';
  return s;
}

// ---------------------------------------------------------------------------
// Boilerplate rejection
// ---------------------------------------------------------------------------

// Feeds pad themselves with recurring furniture: promo rows, subreddit
// megathreads, link roundups. It is not news and it crowds out news.
const NOISE = [
  /^get your latest/i,
  /\bdaily links\b/i,
  /\bself[- ]promotion\b/i,
  /\bfan art\b/i,
  /\b(game|post[- ]?game|postgame)\s+thread\b/i,
  /\bfree talk\b/i,
  /\bopen thread\b/i,
  /\bmegathread\b/i,
  /\bwhat are your thoughts\b/i,
  /\bsubscribe to\b/i,
  /^\s*\[?highlight\]?/i,
];

function isNoise(title) {
  for (const re of NOISE) if (re.test(title)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Build the wire
// ---------------------------------------------------------------------------

const SIX_HOURS = 6 * 3600e3;
const DUPE_THRESHOLD = 0.58;

/**
 * Collapse raw per-source items into ranked, de-duplicated stories.
 *
 * Two outlets covering one signing should read as a single story that several
 * outlets corroborated, not as five near-identical rows — corroboration is
 * signal, so it lifts the story instead of cluttering the list.
 */
export function buildWire(rawBySource, now = Date.now()) {
  const items = [];
  const seenUrl = new Map();

  for (const { source, entries } of rawBySource) {
    for (const e of entries) {
      const link = canonicalUrl(e.link);
      const title = e.title.replace(/\s+/g, ' ').trim();
      if (!title || title.length < 8 || isNoise(title)) continue;

      const teams = detectTeams(`${title} ${e.categories.join(' ')}`);

      // Every source gets the lenient pass: reject what advertises another
      // sport. It costs nothing on the NBA-only feeds and cleans up the
      // cross-promoted NFL/golf items in the ESPN, Yahoo and CBS feeds.
      if (otherSportSignal({ ...e, link })) continue;

      // Feeds that are mostly *not* basketball must additionally prove that
      // they are. Too strict for the rest: it would drop "Rookie Extension
      // Market Remains Quiet With Only Victor Wembanyama".
      if (source.nbaOnly && !looksLikeNBA({ ...e, link })) continue;

      const rawSummary = stripHtml(e.summaryRaw, 300);
      // Applied to every source, not just the mixed-sport ones: the NBA feeds
      // at RealGM, TalkBasket and Yahoo all carry WNBA items too.
      if (isWomensBasketball({ ...e, link, summary: rawSummary })) continue;

      // EuroLeague/FIBA coverage that has no NBA club in the frame.
      if (isNonNbaBasketball({ ...e, link, summary: rawSummary })) continue;

      // Same URL from two feeds: keep the heavier source.
      const prior = seenUrl.get(link);
      if (prior) {
        if (source.weight > prior.source.weight) {
          prior.source = source;
          prior.title = title;
        }
        prior.sourceIds.add(source.id);
        continue;
      }

      const published = e.published > 0 ? Math.min(e.published, now + 60e3) : now;
      const item = {
        title,
        link,
        image: e.image || '',
        summary: cleanSummary(rawSummary, title),
        author: e.author || '',
        published,
        source,
        teams,
        host: displayHost(link),
        sourceIds: new Set([source.id]),
        tok: tokens(title),
      };
      items.push(item);
      seenUrl.set(link, item);
    }
  }

  // Greedy near-duplicate clustering. Newest first, so the earliest-seen
  // representative of a cluster is also the freshest copy.
  items.sort((a, b) => b.published - a.published);

  const stories = [];
  for (const it of items) {
    let host = null;
    for (const s of stories) {
      // Only compare against stories in a plausible time window; the same news
      // does not resurface three days apart.
      if (Math.abs(s.published - it.published) > 36 * 3600e3) continue;
      if (jaccard(s.tok, it.tok) >= DUPE_THRESHOLD) { host = s; break; }
    }
    if (host) {
      host.dupes.push(it);
      for (const id of it.sourceIds) host.sourceIds.add(id);
      // A heavier outlet takes over as the canonical headline.
      if (it.source.weight > host.source.weight) {
        host.title = it.title;
        host.link = it.link;
        host.host = it.host;
        host.summary = it.summary || host.summary;
        host.image = host.image || it.image;
        host.source = it.source;
      }
      continue;
    }
    it.dupes = [];
    stories.push(it);
  }

  // Score: recency dominates on a news wire, then outlet authority, then how
  // many independent outlets are carrying it.
  for (const s of stories) {
    const ageH = Math.max(0, (now - s.published) / 3600e3);
    const recency = Math.exp(-ageH / (SIX_HOURS / 3600e3));
    // Distinct outlets only. Two Yahoo posts about one signing is Yahoo
    // repeating itself, not the league confirming it.
    s.outlets = s.sourceIds.size;
    s.alsoIn = [...s.sourceIds].filter((id) => id !== s.source.id);
    const corroboration = Math.min(1, (s.outlets - 1) / 3);
    s.score = recency * 0.62 + s.source.weight * 0.22 + corroboration * 0.16;
    delete s.tok;
    delete s.sourceIds;
    for (const d of s.dupes) { delete d.tok; delete d.sourceIds; }
  }

  stories.sort((a, b) => b.score - a.score);
  return stories;
}

/** Stories multiple independent outlets picked up — the day's real news. */
export function trending(stories, limit = 6) {
  return stories
    .filter((s) => s.outlets >= 2)
    .sort((a, b) => b.outlets - a.outlets || b.published - a.published)
    .slice(0, limit);
}
