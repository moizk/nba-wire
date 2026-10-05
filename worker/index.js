import { refreshAll } from '../src/feeds.js';
import { renderPage, renderList, configureAssets, cspHashes } from '../src/render.js';
import { sha256Short } from '../src/hash.js';
import { CSS, JS } from './assets.generated.js';

// Bump to invalidate every cached route at once.
const V = 'v1';

// Only three keys are stored. `/api/status` is derived from the `list` key's
// metadata rather than being a key of its own, because KV quota is counted per
// key written per cycle, and the free plan allows 1,000 writes/day:
//   4 keys x 288 cycles (*/5) = 1,152/day  -> over
//   3 keys x 288 cycles       =   864/day  -> under, and cycles that change
//                                             nothing write zero.
const ROUTES = new Map([
  ['/', { key: 'page', type: 'text/html; charset=utf-8' }],
  ['/fragment/list', { key: 'list', type: 'text/html; charset=utf-8' }],
  ['/api/wire', { key: 'wire', type: 'application/json; charset=utf-8' }],
]);

// configureAssets only hashes two strings; memoise it per isolate.
let assetsReady = null;
const ensureAssets = () => (assetsReady ??= configureAssets(CSS, JS));

// Guards against a burst of cold requests each kicking off its own rebuild.
let building = false;

/**
 * RFC 9110 weak comparison for If-None-Match.
 *
 * Cloudflare rewrites our strong ETag to a weak one (W/"...") whenever it
 * compresses at the edge, which is every real browser request. A strict string
 * compare therefore never matched, and each poll re-sent the whole fragment.
 * Also handles comma-separated lists and "*".
 */
function etagMatches(header, etag) {
  if (!header || !etag) return false;
  if (header.trim() === '*') return true;
  const strip = (v) => v.trim().replace(/^W\//, '');
  const target = strip(etag);
  return header.split(',').some((v) => strip(v) === target);
}

function securityHeaders(type) {
  const h = {
    'content-type': type,
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
  };
  if (type.startsWith('text/html')) {
    const c = cspHashes();
    h['content-security-policy'] = [
      "default-src 'none'",
      'img-src https: data:',
      `style-src ${c.css}`,
      `script-src ${c.js}`,
      "connect-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join('; ');
  }
  return h;
}

/**
 * Poll every feed, rebuild all four routes and store them in KV.
 *
 * No compression happens here: Cloudflare compresses at the edge, and doing it
 * ourselves was measured at 203ms of CPU per cycle against 22ms for the actual
 * work — it would dominate the Worker's entire budget for no gain.
 */
async function build(env) {
  await ensureAssets();
  const state = await refreshAll();

  // Never publish an empty wire. If every feed failed, keep serving whatever is
  // already in KV until the next run.
  if (!state.stories.length) return { ok: false, reason: 'no stories built' };

  state.sig = await sha256Short(state.stories.map((s) => s.link).join('\n'), 16);

  // list() returns metadata without the value, so checking whether anything
  // changed costs a list operation rather than a 225kB read.
  const prev = await env.WIRE.list({ prefix: `${V}:page`, limit: 1 });
  if (prev.keys?.[0]?.metadata?.sig === state.sig) {
    return { ok: true, skipped: 'unchanged', stories: state.counts.stories };
  }

  // The fragment's ETag is embedded in the page so the client can send a
  // conditional request on its first poll; it must match what we store.
  const list = renderList(state);
  state.listEtag = `"${await sha256Short(list)}"`;

  const payloads = [
    ['page', renderPage(state), 'text/html; charset=utf-8'],
    ['list', list, 'text/html; charset=utf-8'],
    ['wire', JSON.stringify({
      builtAt: state.builtAt,
      counts: state.counts,
      health: state.health,
      stories: state.stories.map((s) => ({
        title: s.title, link: s.link, summary: s.summary, image: s.image,
        published: s.published, source: s.source.id, sourceName: s.source.name,
        teams: s.teams, outlets: s.outlets, alsoIn: s.alsoIn,
      })),
    }), 'application/json; charset=utf-8'],
  ];

  await Promise.all(payloads.map(async ([key, body, type]) => {
    const etag = key === 'list' ? state.listEtag : `"${await sha256Short(body)}"`;
    await env.WIRE.put(`${V}:${key}`, body, {
      metadata: {
        etag, type, builtAt: state.builtAt,
        sig: state.sig, stories: state.counts.stories,
      },
    });
  }));

  return { ok: true, stories: state.counts.stories, live: state.counts.live };
}

async function buildOnce(env) {
  if (building) return;
  building = true;
  try { await build(env); } finally { building = false; }
}

const WARMING = `<!doctype html><meta charset="utf-8"><title>NBA Wire — warming up</title>`
  + `<meta http-equiv="refresh" content="3">`
  + `<style>html{background:#eef0f2;color:#16181c;font:14px -apple-system,Helvetica,sans-serif;`
  + `display:grid;place-items:center;height:100%}div{text-align:center}b{display:block;font-size:19px;`
  + `letter-spacing:-.02em;margin-bottom:6px}</style>`
  + `<div><b>NBA WIRE</b>Pulling the first wire…</div>`;

export default {
  // Cron Trigger. Schedule lives in wrangler.toml.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(build(env));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('method not allowed\n', { status: 405, headers: { allow: 'GET, HEAD' } });
    }

    // Both of these want the build's metadata, not its content. list() hands
    // back metadata without transferring any value.
    if (url.pathname === '/healthz' || url.pathname === '/api/status') {
      const found = await env.WIRE.list({ prefix: `${V}:list`, limit: 1 });
      const m = found.keys?.[0]?.metadata;
      const body = url.pathname === '/api/status'
        ? JSON.stringify({ sig: m?.sig ?? null, builtAt: m?.builtAt ?? null, stories: m?.stories ?? null })
        : JSON.stringify({
          ok: !!m,
          builtAt: m?.builtAt ?? null,
          ageMs: m ? Date.now() - m.builtAt : null,
          stories: m?.stories ?? null,
        });
      return new Response(body, {
        status: m || url.pathname === '/api/status' ? 200 : 503,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      });
    }

    const route = ROUTES.get(url.pathname);
    if (!route) return new Response('not found\n', { status: 404, headers: { 'content-type': 'text/plain' } });

    await ensureAssets();

    // cacheTtl keeps hot routes in the colo's cache, which cuts both latency
    // and KV read operations. 60s is the minimum Cloudflare accepts.
    const { value, metadata } = await env.WIRE.getWithMetadata(`${V}:${route.key}`, {
      type: 'text',
      cacheTtl: 60,
    });

    if (value === null) {
      // Nothing published yet — first deploy, before the first cron fires.
      ctx.waitUntil(buildOnce(env));
      return new Response(WARMING, {
        status: 503,
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '3' },
      });
    }

    const etag = metadata?.etag || '';
    if (etagMatches(request.headers.get('if-none-match'), etag)) {
      return new Response(null, { status: 304, headers: { etag, 'cache-control': 'no-cache' } });
    }

    const headers = securityHeaders(metadata?.type || route.type);
    if (etag) headers.etag = etag;

    return new Response(request.method === 'HEAD' ? null : value, { headers });
  },
};
