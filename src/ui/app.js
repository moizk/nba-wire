/* NBA WIRE client. No framework, no build step, no dependencies.
 *
 * Filtering never re-renders: every row is in the DOM once, and search/source/
 * team filters only toggle a single class. That keeps a 250-row wire filtering
 * at input speed even on a slow machine. */

(() => {
  'use strict';

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const listEl  = $('#list');
  const qEl     = $('#q');
  const wireEl  = $('#wire');
  const countEl = $('#count');
  const pillEl  = $('#newpill');
  const srcPanel = $('#srcpanel');
  const srcToggle = $('#srctoggle');
  const srcBody = $('#srcbody');
  const srcState = $('#srcstate');

  let rows = [];
  let visible = [];
  let sel = -1;

  const filters = { q: '', source: '', team: '' };

  /* ---------------------------------------------------------------- rows */

  function indexRows() {
    // The lead is a row for every purpose except styling.
    rows = $$('.row, .lead', listEl);
    for (const r of rows) {
      // Cache the haystack once instead of re-reading textContent per keystroke.
      if (!r._hay) r._hay = (r.dataset.x || r.textContent).toLowerCase();
    }
  }

  function apply() {
    const q = filters.q;
    const src = filters.source;
    const team = filters.team;
    visible = [];

    for (const r of rows) {
      let ok = true;
      if (src && r.dataset.s !== src) ok = false;
      if (ok && team && !(r.dataset.t || '').split(',').includes(team)) ok = false;
      if (ok && q && r._hay.indexOf(q) === -1) ok = false;
      r.classList.toggle('hide', !ok);
      if (ok) visible.push(r);
    }

    countEl.textContent = visible.length;
    $('#emptystate').hidden = visible.length > 0;
    syncCap();

    if (sel >= 0) {
      const cur = rows[sel];
      if (!cur || cur.classList.contains('hide')) select(-1);
    }
  }

  function select(i, scroll = true) {
    if (sel >= 0 && rows[sel]) rows[sel].classList.remove('sel');
    sel = i;
    if (i < 0 || !rows[i]) return;
    const el = rows[i];
    el.classList.add('sel');
    if (scroll) el.scrollIntoView({ block: 'nearest' });
  }

  function move(delta) {
    if (!visible.length) return;
    const cur = sel >= 0 ? rows[sel] : null;
    let idx = cur ? visible.indexOf(cur) : -1;
    idx = idx < 0 ? (delta > 0 ? 0 : visible.length - 1) : idx + delta;
    idx = Math.max(0, Math.min(visible.length - 1, idx));
    select(rows.indexOf(visible[idx]));
  }

  function openSel() {
    const el = sel >= 0 ? rows[sel] : visible[0];
    if (el) window.open(el.href, '_blank', 'noopener');
  }

  /* ------------------------------------------------------------- filters */

  function setSource(id) {
    filters.source = filters.source === id ? '' : id;
    syncPressed();
    apply();
  }
  function setTeam(id) {
    filters.team = filters.team === id ? '' : id;
    syncPressed();
    apply();
  }
  function syncPressed() {
    for (const b of $$('.opt[data-source]')) b.setAttribute('aria-pressed', String(b.dataset.source === filters.source));
    for (const b of $$('.opt[data-team]'))   b.setAttribute('aria-pressed', String(b.dataset.team === filters.team));
  }

  /* ------------------------------------------------------- sources panel */

  const PANEL_KEY = 'nbawire.sources';

  function setPanel(open, remember = true) {
    srcPanel.classList.toggle('open', open);
    srcToggle.setAttribute('aria-expanded', String(open));
    srcBody.hidden = !open;
    if (remember) {
      try { localStorage.setItem(PANEL_KEY, open ? '1' : '0'); } catch { /* private mode */ }
    }
  }

  srcToggle.addEventListener('click', () => setPanel(srcBody.hidden));

  // Collapsed by default; a deliberate choice to open it is remembered.
  let startOpen = false;
  try { startOpen = localStorage.getItem(PANEL_KEY) === '1'; } catch { /* private mode */ }
  setPanel(startOpen, false);

  /** Show the active filter on the cap, so it is visible while shut. */
  function syncCap() {
    const parts = [];
    if (filters.source) {
      const b = $(`.opt[data-source="${filters.source}"]`);
      parts.push(b ? b.querySelector('.lbl').textContent : filters.source);
    }
    if (filters.team) {
      const b = $(`.opt[data-team="${filters.team}"]`);
      parts.push(b ? b.querySelector('.lbl').textContent : filters.team);
    }
    const label = parts.join(' · ');
    srcState.textContent = label || srcState.dataset.base;
    srcState.classList.toggle('on', !!label);
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('.opt');
    if (!b) return;
    if (b.dataset.source !== undefined) setSource(b.dataset.source);
    else if (b.dataset.team !== undefined) setTeam(b.dataset.team);
    else if (b.dataset.clear !== undefined) {
      filters.source = filters.team = filters.q = '';
      qEl.value = '';
      syncPressed(); apply();
    }
  });

  // Debounce is unnecessary — a filter pass is a class toggle over ~250 nodes.
  qEl.addEventListener('input', () => {
    filters.q = qEl.value.trim().toLowerCase();
    qEl.parentElement.classList.toggle('on', qEl.value.length > 0);
    apply();
  });

  /* ------------------------------------------------------------ keyboard */

  document.addEventListener('keydown', (e) => {
    const typing = e.target === qEl;

    if (e.key === 'Escape') {
      // Escape clears an active search whether or not the box still has focus;
      // otherwise it just drops the selection.
      if (filters.q) {
        qEl.value = '';
        filters.q = '';
        qEl.parentElement.classList.remove('on');
        apply();
        qEl.blur();
      } else if (typing) {
        qEl.blur();
      } else {
        select(-1);
      }
      return;
    }
    if (typing) {
      if (e.key === 'Enter')      { e.preventDefault(); qEl.blur(); if (visible.length) select(rows.indexOf(visible[0])); }
      if (e.key === 'ArrowDown')  { e.preventDefault(); qEl.blur(); move(1); }
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    switch (e.key) {
      case '/': e.preventDefault(); qEl.focus(); qEl.select(); break;
      case 'j': case 'ArrowDown': e.preventDefault(); move(1); break;
      case 'k': case 'ArrowUp':   e.preventDefault(); move(-1); break;
      case 'Enter': case 'o':     e.preventDefault(); openSel(); break;
      case 'g': e.preventDefault(); if (visible.length) { select(rows.indexOf(visible[0])); wireEl.scrollTop = 0; } break;
      case 'G': e.preventDefault(); if (visible.length) select(rows.indexOf(visible[visible.length - 1])); break;
      case 'r': e.preventDefault(); check(true); break;
      case 's': e.preventDefault(); setPanel(srcBody.hidden); break;
      case '0': e.preventDefault(); filters.source = filters.team = ''; syncPressed(); apply(); break;
      default: {
        // 1–9 jump straight to a source filter, in rail order.
        if (e.key >= '1' && e.key <= '9') {
          const opts = $$('.opt[data-source]');
          const t = opts[+e.key - 1];
          if (t) {
            e.preventDefault();
            setSource(t.dataset.source);
            // Open the panel so the shortcut's effect is visible.
            if (filters.source) setPanel(true);
          }
        }
      }
    }
  });

  /* ----------------------------------------------------------- timestamps */

  const REL = [[60, 's'], [3600, 'm'], [86400, 'h'], [604800, 'd']];
  function rel(ts) {
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 60) return 'now';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    if (s < 604800) return Math.floor(s / 86400) + 'd';
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function stampAll() {
    for (const el of $$('[data-ts]')) {
      const t = +el.dataset.ts;
      if (t) el.textContent = rel(t);
    }
  }

  /* ---------------------------------------------------------- live update */

  let sig = document.body.dataset.sig || '';
  let pendingHtml = null;

  async function check(force = false) {
    try {
      const r = await fetch('/api/status', { cache: 'no-store' });
      if (!r.ok) return;
      const s = await r.json();
      if (s.sig === sig && !force) return;
      const frag = await fetch('/fragment/list', { cache: 'no-store' });
      if (!frag.ok) return;
      pendingHtml = await frag.text();
      sig = s.sig;
      if (force) return swapIn();
      pillEl.querySelector('b').textContent = s.stories;
      pillEl.classList.add('on');
    } catch { /* offline or a refresh in flight; the next tick retries */ }
  }

  function swapIn() {
    if (!pendingHtml) return;
    const top = wireEl.scrollTop === 0;
    listEl.innerHTML = pendingHtml;
    pendingHtml = null;
    pillEl.classList.remove('on');
    sel = -1;
    indexRows();
    apply();
    stampAll();
    if (top) wireEl.scrollTop = 0;
  }

  pillEl.addEventListener('click', swapIn);

  /* ------------------------------------------------------------------ go */

  indexRows();
  apply();
  stampAll();
  setInterval(stampAll, 30_000);
  setInterval(() => check(false), 45_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(false); });
})();
