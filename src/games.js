// Games panel: yesterday, today and tomorrow's slate from ESPN's scoreboard.
//
// This replaces the Ruby season scraper (moizk/nba-schedule-2025-26) with
// something a Worker can run every cycle. That project downloaded NBA.com's
// whole-season scheduleLeagueV2.json; here each cycle asks for three single
// days instead, which is ~10kB of JSON rather than megabytes, and also carries
// live scores and clocks, which a static schedule never could.
//
// Like the rest of src/, this is runtime-agnostic: fetch + Intl only.

import { TEAMS } from './teams.js';

const SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=';

// ESPN's Akamai edge 403s any agent that carries a URL — including the
// "nbawire/1.0 (+https://nbawire.org)" string every feed accepts — but takes
// the bare product token.
const FETCH_HEADERS = { 'user-agent': 'nbawire/1.0', accept: 'application/json' };
const FETCH_TIMEOUT_MS = 9_000;

// NBA days are Eastern days. The slate rolls over at 6am ET rather than
// midnight, so a West Coast late game still reads as "today" until it ends.
const ROLLOVER_MS = 6 * 3600_000;
const ET_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
});

// ESPN's abbreviations differ from the league's for six teams.
const ESPN_ABBR = { UTAH: 'UTA', NY: 'NYK', GS: 'GSW', NO: 'NOP', SA: 'SAS', WSH: 'WAS' };
const TEAM_BY_ABBR = new Map(TEAMS.map((t) => [t.abbr, t]));

// How far the date switcher reaches either side of today.
export const DAY_OFFSETS = [-1, 0, 1];
const LABELS = { '-1': 'Yesterday', 0: 'Today', 1: 'Tomorrow' };

/** Last good games per date, so a failed fetch doesn't blank the panel. */
const cache = new Map();

function shiftDate(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function team(c) {
  const espn = c.team?.abbreviation || '';
  const abbr = ESPN_ABBR[espn] || espn;
  const known = TEAM_BY_ABBR.get(abbr);
  return {
    id: known?.id || abbr.toLowerCase(),
    abbr,
    name: c.team?.shortDisplayName || known?.name || abbr,
    logo: c.team?.logo || '',
    score: c.score ?? '',
    winner: !!c.winner,
    record: c.records?.find((r) => r.type === 'total')?.summary || '',
  };
}

function normalize(ev) {
  const comp = ev.competitions?.[0] || {};
  const status = comp.status?.type || ev.status?.type || {};
  const sides = comp.competitors || [];
  const tv = (comp.geoBroadcasts || [])
    .filter((b) => b.market?.type === 'National' && b.media?.shortName)
    .map((b) => b.media.shortName);
  return {
    id: ev.id,
    start: Date.parse(ev.date) || 0,
    // pre | in | post
    state: status.state || 'pre',
    detail: status.shortDetail || status.description || '',
    tbd: comp.timeValid === false,
    away: team(sides.find((s) => s.homeAway === 'away') || {}),
    home: team(sides.find((s) => s.homeAway === 'home') || {}),
    tv: [...new Set(tv)],
    note: comp.notes?.[0]?.headline || '',
    venue: [comp.venue?.fullName, comp.venue?.address?.city].filter(Boolean).join(', '),
    link: ev.links?.find((l) => l.rel?.includes('summary'))?.href || '',
  };
}

async function fetchDay(date) {
  const started = performance.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(SCOREBOARD + date.replace(/-/g, ''), { headers: FETCH_HEADERS, signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const games = (json.events || []).map(normalize).sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
    cache.set(date, games);
    return { date, games, ok: true, ms: Math.round(performance.now() - started) };
  } catch (err) {
    const error = err.name === 'AbortError' ? 'timeout' : err.message;
    const prev = cache.get(date);
    return { date, games: prev || [], ok: false, stale: !!prev, error, ms: Math.round(performance.now() - started) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Today plus its neighbours. Never throws: a failed day falls back to its last
 * good copy, and a day that never loaded renders as unavailable.
 */
export async function refreshGames(now = Date.now()) {
  const today = ET_DATE.format(now - ROLLOVER_MS);
  const results = await Promise.all(DAY_OFFSETS.map((o) => fetchDay(shiftDate(today, o))));

  // Drop dates that have scrolled out of the window.
  const keep = new Set(results.map((r) => r.date));
  for (const d of cache.keys()) if (!keep.has(d)) cache.delete(d);

  const failed = results.filter((r) => !r.ok);
  return {
    today,
    days: results.map((r, i) => ({
      date: r.date,
      label: LABELS[DAY_OFFSETS[i]],
      ok: r.ok || r.stale,
      games: r.games,
    })),
    health: {
      id: 'scores',
      name: 'ESPN Scores',
      ok: failed.length === 0,
      stale: failed.length > 0 && failed.every((r) => r.stale),
      ms: Math.max(...results.map((r) => r.ms)),
      count: results.reduce((n, r) => n + r.games.length, 0),
      error: failed[0]?.error || null,
    },
  };
}
