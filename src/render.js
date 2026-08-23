import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SOURCES } from './sources.js';
import { TEAMS } from './teams.js';

const here = dirname(fileURLToPath(import.meta.url));

// CSS and client JS are read once at boot and inlined. Inlining costs a few KB
// of HTML but removes two round trips, and the whole document compresses as a
// single Brotli stream — a clear win for a page this size.
const CSS = readFileSync(join(here, 'ui/app.css'), 'utf8');
const JS = readFileSync(join(here, 'ui/app.js'), 'utf8');

// Exact hashes of the inlined blocks, so the CSP can allow precisely these two
// and nothing else — no 'unsafe-inline' anywhere.
export const INLINE_HASHES = {
  css: `'sha256-${createHash('sha256').update(CSS).digest('base64')}'`,
  js: `'sha256-${createHash('sha256').update(JS).digest('base64')}'`,
};

const AMP = /&/g, LT = /</g, GT = />/g, QUOT = /"/g;
export function esc(s) {
  if (!s) return '';
  return String(s).replace(AMP, '&amp;').replace(LT, '&lt;').replace(GT, '&gt;').replace(QUOT, '&quot;');
}

// Only ever emit http(s) links from feed data; a javascript: URL in a feed
// must not become a live link in the page.
function safeUrl(u) {
  return /^https?:\/\//i.test(u || '') ? esc(u) : '#';
}

const TEAM_ABBR = new Map(TEAMS.map((t) => [t.id, t.abbr]));

function chipClass(kind) {
  return kind === 'rumor' ? 'chip rumor' : kind === 'social' ? 'chip social' : 'chip';
}

function teamChips(ids) {
  let out = '';
  for (const id of ids) out += `<span class="chip team">${TEAM_ABBR.get(id) || id}</span>`;
  return out;
}

function row(s) {
  const teams = s.teams.join(',');
  // data-x is the pre-lowered search haystack, so the client never has to walk
  // the DOM subtree of a row while the user is typing.
  const hay = `${s.title} ${s.source.name} ${s.teams.map((t) => TEAM_ABBR.get(t) || '').join(' ')}`.toLowerCase();
  return `<a class="row" href="${safeUrl(s.link)}" target="_blank" rel="noopener noreferrer"`
    + ` data-s="${esc(s.source.id)}" data-t="${esc(teams)}" data-x="${esc(hay)}">`
    + `<span class="when"><i data-ts="${s.published}">·</i></span>`
    + `<span class="c">`
    + `<h3>${esc(s.title)}</h3>`
    + (s.summary ? `<p>${esc(s.summary)}</p>` : '')
    + `<span class="meta">`
    // Narrow layouts drop the timestamp gutter, so the time rejoins the chips.
    + `<span class="chip when-m" data-ts="${s.published}">·</span>`
    + `<span class="${chipClass(s.source.kind)} src">${esc(s.source.short)}</span>`
    + teamChips(s.teams)
    + (s.outlets > 1 ? `<span class="chip x">${s.outlets}× outlets</span>` : '')
    + `</span></span></a>`;
}

function lead(s) {
  if (!s) return '';
  const art = s.image
    ? `<span class="art"><img src="${safeUrl(s.image)}" alt="" loading="eager" decoding="async" referrerpolicy="no-referrer"></span>`
    : '';
  const hay = `${s.title} ${s.source.name} ${s.teams.map((t) => TEAM_ABBR.get(t) || '').join(' ')}`.toLowerCase();
  // The lead carries the same filter data as any row so that searching or
  // filtering by team hides it too, and the visible count stays honest.
  return `<a class="lead${art ? '' : ' noart'}" href="${safeUrl(s.link)}" target="_blank" rel="noopener noreferrer"`
    + ` data-s="${esc(s.source.id)}" data-t="${esc(s.teams.join(','))}" data-x="${esc(hay)}">`
    + art
    + `<span class="c">`
    + `<span class="meta"><span class="${chipClass(s.source.kind)} src">${esc(s.source.short)}</span>`
    + teamChips(s.teams)
    + (s.outlets > 1 ? `<span class="chip x">${s.outlets}× outlets</span>` : '')
    + `<span class="chip" data-ts="${s.published}">·</span></span>`
    + `<h2>${esc(s.title)}</h2>`
    + (s.summary ? `<p>${esc(s.summary)}</p>` : '')
    + `</span></a>`;
}

/** The swappable part of the page: lead + every row. */
export function renderList(state) {
  const stories = state.stories;
  if (!stories.length) return '';
  // Prefer a top story that carries an image — several feeds (ESPN, RotoWire)
  // ship no artwork at all, and an imageless lead wastes the slot.
  let li = 0;
  for (let i = 0; i < Math.min(6, stories.length); i++) {
    if (stories[i].image) { li = i; break; }
  }
  let html = lead(stories[li]);
  for (let i = 0; i < stories.length; i++) {
    if (i !== li) html += row(stories[i]);
  }
  return html;
}

function railSources(state) {
  const health = new Map(state.health.map((h) => [h.id, h]));
  const counts = new Map();
  for (const s of state.stories) counts.set(s.source.id, (counts.get(s.source.id) || 0) + 1);

  let html = '';
  SOURCES.forEach((s, i) => {
    const h = health.get(s.id);
    const cls = h?.ok ? 'live' : 'dead';
    const key = i < 9 ? `<span class="k">${i + 1}</span>` : '';
    html += `<button class="opt" type="button" data-source="${esc(s.id)}" aria-pressed="false"`
      + ` title="${esc(s.name)} — ${h?.ok ? `${h.count} items in ${h.ms}ms` : `offline: ${esc(h?.error || 'unknown')}`}">`
      + `<span class="dot ${cls}"></span>`
      + `<span class="lbl">${esc(s.name)}</span>`
      + key
      + `<span class="c">${counts.get(s.id) || 0}</span>`
      + `</button>`;
  });
  return html;
}

function railTeams(state) {
  const counts = new Map();
  for (const s of state.stories) for (const t of s.teams) counts.set(t, (counts.get(t) || 0) + 1);
  const active = TEAMS.filter((t) => counts.get(t.id)).sort((a, b) => counts.get(b.id) - counts.get(a.id));
  if (!active.length) return '';
  let html = '<div class="rail-group"><div class="rail-h">Teams in the news</div>';
  for (const t of active) {
    html += `<button class="opt" type="button" data-team="${esc(t.id)}" aria-pressed="false">`
      + `<span class="lbl">${esc(t.name)}</span>`
      + `<span class="c">${counts.get(t.id)}</span></button>`;
  }
  return html + '</div>';
}

function trendPanel(state) {
  if (!state.trending.length) {
    return '<div class="empty" style="padding:28px 16px">Nothing corroborated yet.<br>Stories appear here once a second outlet picks them up.</div>';
  }
  let html = '';
  state.trending.forEach((s, i) => {
    const via = [s.source.id, ...s.alsoIn].join(' · ');
    html += `<a class="tr" href="${safeUrl(s.link)}" target="_blank" rel="noopener noreferrer">`
      + `<span class="top"><span class="rank">${i + 1}</span>`
      + `<span class="chip x">${s.outlets}×</span>`
      + `<span class="chip" data-ts="${s.published}">·</span></span>`
      + `<h4>${esc(s.title)}</h4>`
      + `<div class="via">${esc(via)}</div>`
      + `</a>`;
  });
  return html;
}

function healthPanel(state) {
  let html = '';
  for (const h of state.health) {
    // A stale source still has content on screen, so it warns rather than dies.
    const cls = h.ok ? '' : h.stale ? 'warn' : 'dead';
    const note = h.ok
      ? `${h.count} · ${h.cached ? 'cached' : `${h.ms}ms`}`
      : h.stale ? `stale · ${esc(h.error || '')}` : esc(h.error || 'down');
    html += `<div class="hrow"><span class="dot ${cls}"></span>`
      + `<span>${esc(h.name)}</span>`
      + `<span class="ms">${note}</span></div>`;
  }
  return html;
}

const CHEVRON = '<svg class="chev" viewBox="0 0 12 12" width="9" height="9" aria-hidden="true">'
  + '<path d="M4 2.5 8 6l-4 3.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const SEARCH_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/></svg>';

// Inline SVG favicon: a black band on white, matching the wordmark badge.
const FAVICON = 'data:image/svg+xml,'
  + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#fff"/><rect x="4" y="11" width="24" height="9" rx="3" fill="#0b0c0e"/></svg>');

export function renderPage(state) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="light">
<meta name="description" content="Every NBA feed on one screen. ${state.counts.stories} stories from ${state.counts.live} sources, de-duplicated and ranked.">
<meta name="referrer" content="no-referrer">
<title>NBA WIRE — ${state.counts.stories} stories, ${state.counts.live} sources</title>
<link rel="icon" href="${FAVICON}">
<style>${CSS}</style>
</head>
<body data-sig="${esc(state.sig)}">
<div class="shell">

  <header class="nav">
    <div class="mark"><b>NBA</b><span>Wire</span></div>
    <div class="pulse" title="Live"></div>
    <div class="search">
      ${SEARCH_ICON}
      <input id="q" type="search" placeholder="Search headlines, teams, sources…" autocomplete="off" spellcheck="false" aria-label="Search the wire">
      <span class="slash">/</span>
    </div>
    <button class="newpill" id="newpill" type="button"><span class="pulse"></span>New wire · <b>0</b></button>
  </header>

  <div class="body">

    <main class="plate">
      <div class="cap">The Wire <span class="n">newest first</span></div>
      <div class="wire scroll" id="wire">
        <div class="list" id="list">${renderList(state)}</div>
        <div class="empty" id="emptystate" hidden><b>Nothing matches</b>Try a different search, or press <kbd>0</kbd> to clear filters.</div>
      </div>
    </main>

    <div class="side">

      <section class="plate srcpanel" id="srcpanel">
        <button class="cap captoggle" id="srctoggle" type="button" aria-expanded="false" aria-controls="srcbody">
          ${CHEVRON}
          <span>Sources</span>
          <span class="n" id="srcstate" data-base="${state.counts.live}/${state.counts.sources}">${state.counts.live}/${state.counts.sources}</span>
        </button>
        <div class="rail scroll" id="srcbody" hidden>
          <div class="rail-group">${railSources(state)}</div>
          ${railTeams(state)}
          <div class="rail-group">
            <button class="opt" type="button" data-clear=""><span class="lbl">Clear filters</span><span class="k">0</span></button>
          </div>
        </div>
      </section>

      <section class="plate trendpanel">
        <div class="cap">Trending <span class="n">2+ outlets</span></div>
        <div class="trend scroll">${trendPanel(state)}</div>
      </section>

      <section class="plate healthpanel">
        <div class="cap">Feed health <span class="n">${state.buildMs}ms</span></div>
        <div class="health scroll">${healthPanel(state)}</div>
      </section>

    </div>

  </div>

  <footer class="strip">
    <span class="hint"><kbd>j</kbd><kbd>k</kbd>move</span>
    <span class="hint"><kbd>↵</kbd>open</span>
    <span class="hint"><kbd>/</kbd>search</span>
    <span class="hint"><kbd>1</kbd>–<kbd>9</kbd>source</span>
    <span class="hint"><kbd>0</kbd>clear</span>
    <span class="hint"><kbd>s</kbd>sources</span>
    <span class="hint"><kbd>r</kbd>refresh</span>
    <span class="grow"></span>
    <span class="stat"><b id="count">${state.counts.stories}</b> stories · ${state.counts.live}/${state.counts.sources} feeds · from ${state.counts.raw} items</span>
  </footer>

</div>
<script>${JS}</script>
</body>
</html>`;
}
