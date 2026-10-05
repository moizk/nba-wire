import { SOURCES } from './sources.js';
import { parseFeed, decodeBody } from './parse.js';
import { buildWire, trending } from './normalize.js';
import { refreshGames } from './games.js';

// An honest, descriptive User-Agent — measured against all 11 sources.
//
// The rule is narrower than "browser UAs are blocked": ESPN answers a *browser*
// UA with an empty 202 (bot mitigation) and Reddit 429s one, but both accept a
// plain identifying agent. Sending none is not an option either — Reddit 403s
// it, which is what Workers do by default, unlike Node (which quietly sends
// "node"). This one string returns 200 from every source in the registry.
const FETCH_HEADERS = {
  'user-agent': 'nbawire/1.0 (+https://nbawire.org)',
  accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5',
  'accept-language': 'en-US,en;q=0.9',
};

const FETCH_TIMEOUT_MS = 9_000;

/**
 * Last good payload per source: { entries, at, etag, lastModified }.
 *
 * Serves three purposes — honouring each source's poll interval, surviving a
 * transient failure without visibly emptying the wire, and letting us send
 * conditional requests so unchanged feeds cost a 304 instead of a download.
 */
const cache = new Map();

async function fetchOne(source, now) {
  const prev = cache.get(source.id);

  // Rate-limited or slow-moving sources opt out of every cycle.
  const minInterval = source.intervalMs || 0;
  if (prev?.entries.length && now - prev.at < minInterval) {
    return { source, entries: prev.entries, ok: true, cached: true, ms: 0, bytes: 0 };
  }

  const started = performance.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers = { ...FETCH_HEADERS };
    if (prev?.etag) headers['if-none-match'] = prev.etag;
    if (prev?.lastModified) headers['if-modified-since'] = prev.lastModified;

    const res = await fetch(source.url, { headers, signal: ctl.signal, redirect: 'follow' });
    const ms = Math.round(performance.now() - started);

    if (res.status === 304 && prev?.entries.length) {
      res.body?.cancel?.();
      cache.set(source.id, { ...prev, at: now });
      return { source, entries: prev.entries, ok: true, notModified: true, ms, bytes: 0 };
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const buf = new Uint8Array(await res.arrayBuffer());
    if (!buf.length) throw new Error('empty body');
    const xml = decodeBody(buf, res.headers.get('content-type') || '');
    const entries = parseFeed(xml);
    if (!entries.length && !/<(rss|feed)\b/i.test(xml.slice(0, 2000))) {
      throw new Error('no items parsed');
    }
    // A well-formed feed with nothing in it is a real state, not an error:
    // RotoWire's NBA feed empties out between games.

    cache.set(source.id, {
      entries, at: now,
      etag: res.headers.get('etag') || '',
      lastModified: res.headers.get('last-modified') || '',
    });
    return { source, entries, ok: true, ms, bytes: buf.length };
  } catch (err) {
    const ms = Math.round(performance.now() - started);
    const error = err.name === 'AbortError' ? 'timeout' : err.message;
    // Fall back to the last good payload so one blip doesn't blank a column.
    if (prev?.entries.length) {
      return { source, entries: prev.entries, ok: false, stale: true, ms, bytes: 0, error };
    }
    return { source, entries: [], ok: false, ms, bytes: 0, error };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Poll every source in parallel and fold the results into a ranked wire,
 * alongside the games panel's scoreboards.
 * A failing feed degrades to a health-panel warning, never an exception: the
 * wire must render if any source answers.
 */
export async function refreshAll() {
  const started = performance.now();
  const now = Date.now();
  const [results, games] = await Promise.all([
    Promise.all(SOURCES.map((s) => fetchOne(s, now))),
    refreshGames(now),
  ]);

  const stories = buildWire(results, now);

  return {
    stories,
    trending: trending(stories),
    games,
    health: results.map((r) => ({
      id: r.source.id,
      name: r.source.name,
      ok: r.ok,
      stale: !!r.stale,
      cached: !!r.cached || !!r.notModified,
      ms: r.ms,
      count: r.entries.length,
      empty: r.ok && r.entries.length === 0,
      error: r.error || null,
    })),
    builtAt: now,
    buildMs: Math.round(performance.now() - started),
    counts: {
      sources: SOURCES.length,
      live: results.filter((r) => r.ok).length,
      raw: results.reduce((n, r) => n + r.entries.length, 0),
      stories: stories.length,
    },
  };
}
