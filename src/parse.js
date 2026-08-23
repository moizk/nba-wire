// Minimal, allocation-light RSS 2.0 + Atom parser.
//
// A general XML DOM would be wasted here: feeds are flat lists of items with a
// dozen known fields. We slice on <item>/<entry> boundaries and pull named tags
// out of each block, which is roughly an order of magnitude cheaper and has no
// dependency footprint. Parsing only happens on the refresh timer, never on a
// request, so the budget is generous either way.

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', rsquo: '’',
  lsquo: '‘', ldquo: '“', rdquo: '”', middot: '·',
  eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç',
  uuml: 'ü', ouml: 'ö', auml: 'ä', ntilde: 'ñ',
  oacute: 'ó', aacute: 'á', iacute: 'í', uacute: 'ú',
  scaron: 'š', ccaron: 'č', trade: '™', reg: '®',
  copy: '©', deg: '°', frac12: '½', times: '×',
};

const ENTITY_RE = /&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g;

export function decodeEntities(s) {
  if (!s || s.indexOf('&') === -1) return s || '';
  return s.replace(ENTITY_RE, (m, e) => {
    if (e.charCodeAt(0) === 35 /* # */) {
      const hex = e[1] === 'x' || e[1] === 'X';
      const cp = parseInt(hex ? e.slice(2) : e.slice(1), hex ? 16 : 10);
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff) return m;
      try { return String.fromCodePoint(cp); } catch { return m; }
    }
    const hit = NAMED[e];
    return hit === undefined ? m : hit;
  });
}

const CDATA_RE = /<!\[CDATA\[([\s\S]*?)\]\]>/g;

function unwrap(raw) {
  if (raw == null) return '';
  let s = raw;
  if (s.indexOf('<![CDATA[') !== -1) s = s.replace(CDATA_RE, '$1');
  return decodeEntities(s).trim();
}

// Cache the per-tag regexes; the same handful get hit thousands of times.
const tagCache = new Map();
function tagRe(name) {
  let re = tagCache.get(name);
  if (!re) {
    // Matches <name>, <ns:name>, and attribute-carrying variants.
    re = new RegExp(`<(?:[a-zA-Z0-9_-]+:)?${name}(?:\\s[^>]*)?(?:/>|>([\\s\\S]*?)</(?:[a-zA-Z0-9_-]+:)?${name}>)`, 'i');
    tagCache.set(name, re);
  }
  return re;
}

/** Text content of the first matching tag in `block`. */
function pick(block, ...names) {
  for (const n of names) {
    const m = block.match(tagRe(n));
    if (m && m[1] != null) {
      const v = unwrap(m[1]);
      if (v) return v;
    }
  }
  return '';
}

/** Value of `attr` on the first `<name ...>` tag. */
function pickAttr(block, name, attr, requireAttrs = null) {
  const re = new RegExp(`<(?:[a-zA-Z0-9_-]+:)?${name}\\s([^>]*)>`, 'gi');
  let m;
  while ((m = re.exec(block))) {
    const attrs = m[1];
    if (requireAttrs && !requireAttrs.test(attrs)) continue;
    const a = attrs.match(new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`, 'i'));
    if (a) return decodeEntities(a[1]).trim();
  }
  return '';
}

const ITEM_RE = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi;
const ENTRY_RE = /<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi;
const CATEGORY_RE = /<(?:[a-zA-Z0-9_-]+:)?category(?:\s[^>]*)?>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?category>/gi;
const CATEGORY_ATTR_RE = /<(?:[a-zA-Z0-9_-]+:)?category\s[^>]*term\s*=\s*["']([^"']+)["']/gi;

const IMG_SRC_RE = /<img[^>]+src\s*=\s*["']([^"']+)["']/i;
const TAG_STRIP_RE = /<[^>]*>/g;
const WS_RE = /\s+/g;

/** Turn an HTML-ish description into a clean single-line summary. */
export function stripHtml(html, limit = 320) {
  if (!html) return '';
  let s = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(TAG_STRIP_RE, ' ');
  s = decodeEntities(s).replace(WS_RE, ' ').trim();
  // Feeds routinely double-encode, leaving a second layer of markup behind.
  if (s.indexOf('<') !== -1) s = s.replace(TAG_STRIP_RE, ' ').replace(WS_RE, ' ').trim();
  if (s.length > limit) {
    const cut = s.lastIndexOf(' ', limit);
    s = s.slice(0, cut > limit * 0.6 ? cut : limit).trim() + '…';
  }
  return s;
}

function collectCategories(block) {
  const out = [];
  CATEGORY_RE.lastIndex = 0;
  let m;
  while ((m = CATEGORY_RE.exec(block))) {
    const v = unwrap(m[1]);
    if (v) out.push(v);
  }
  // Atom carries the label in a term="" attribute instead of as text.
  CATEGORY_ATTR_RE.lastIndex = 0;
  while ((m = CATEGORY_ATTR_RE.exec(block))) {
    const v = decodeEntities(m[1]).trim();
    if (v) out.push(v);
  }
  return out;
}

function firstImage(...blobs) {
  for (const b of blobs) {
    if (!b) continue;
    const m = b.match(IMG_SRC_RE);
    if (m) return decodeEntities(m[1]);
  }
  return '';
}

function parseDate(...candidates) {
  for (const c of candidates) {
    if (!c) continue;
    const t = Date.parse(c);
    if (Number.isFinite(t)) return t;
  }
  return 0;
}

/**
 * Parse a feed document into raw entries.
 * Returns [] rather than throwing — one malformed feed must not take the
 * refresh cycle down with it.
 */
export function parseFeed(xml) {
  if (!xml || xml.length < 32) return [];
  const out = [];
  const isAtom = /<feed[\s>][\s\S]{0,400}?xmlns=["']http:\/\/www\.w3\.org\/2005\/Atom/i.test(xml)
    || (xml.indexOf('<entry') !== -1 && xml.indexOf('<item') === -1);

  const re = isAtom ? ENTRY_RE : ITEM_RE;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(xml))) {
    const b = m[1];

    let link = '';
    if (isAtom) {
      // Prefer rel="alternate"; fall back to any href-bearing <link>.
      link = pickAttr(b, 'link', 'href', /rel\s*=\s*["']alternate["']/i) || pickAttr(b, 'link', 'href');
    } else {
      link = pick(b, 'link');
      if (!link) link = pickAttr(b, 'link', 'href');
      if (!link) {
        const g = pick(b, 'guid');
        if (/^https?:\/\//i.test(g)) link = g;
      }
    }

    const title = pick(b, 'title');
    if (!title || !link) continue;

    const contentBlob = pick(b, 'encoded', 'content', 'description', 'summary');
    const image =
      pickAttr(b, 'thumbnail', 'url') ||
      pickAttr(b, 'content', 'url', /(?:type\s*=\s*["']image|medium\s*=\s*["']image)/i) ||
      pickAttr(b, 'enclosure', 'url', /type\s*=\s*["']image/i) ||
      pickAttr(b, 'image', 'href') ||
      firstImage(contentBlob);

    out.push({
      title,
      link,
      image,
      guid: pick(b, 'guid', 'id') || link,
      summaryRaw: contentBlob,
      author: pick(b, 'creator', 'author', 'name'),
      categories: collectCategories(b),
      published: parseDate(
        pick(b, 'pubDate'), pick(b, 'published'), pick(b, 'updated'), pick(b, 'date'),
      ),
    });
  }
  return out;
}

/**
 * Decode bytes using the charset the feed actually declares. RealGM still ships
 * ISO-8859-1, and mis-decoding it turns every apostrophe into mojibake.
 */
export function decodeBody(buf, contentType = '') {
  let charset = '';
  const ct = /charset=["']?([\w-]+)/i.exec(contentType);
  if (ct) charset = ct[1].toLowerCase();

  if (!charset) {
    // Sniff the XML declaration from the first bytes, which are ASCII-safe.
    const head = Buffer.from(buf.buffer, buf.byteOffset, Math.min(buf.length, 200)).toString('latin1');
    const dec = /encoding=["']([\w-]+)["']/i.exec(head);
    if (dec) charset = dec[1].toLowerCase();
  }
  if (!charset || charset === 'utf8') charset = 'utf-8';

  try {
    return new TextDecoder(charset, { fatal: false }).decode(buf);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(buf);
  }
}
