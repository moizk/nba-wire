import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { brotliCompressSync, gzipSync, constants as Z } from 'node:zlib';
import { refreshAll } from './feeds.js';
import { renderPage, renderList, configureAssets, cspHashes } from './render.js';
import { sha256Short } from './hash.js';

const here = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 8420);
const HOST = process.env.HOST || '0.0.0.0';
const REFRESH_MS = Number(process.env.REFRESH_MS || 90_000);

// ---------------------------------------------------------------------------
// Precompressed response cache
//
// The whole performance story lives here. Feeds are polled on a timer, the page
// is rendered once per cycle, and both encodings are compressed once per cycle.
// Serving a request is then a map lookup and a socket write — no rendering, no
// compression, no feed I/O ever happens while a client is waiting.
// ---------------------------------------------------------------------------

/** @type {Map<string, {br:Buffer, gz:Buffer, raw:Buffer, etag:string, type:string}>} */
let assets = new Map();
let state = null;
let building = false;

async function bake(body, type) {
  const raw = Buffer.from(body);
  return {
    raw,
    etag: `"${await sha256Short(body)}"`,
    // Max compression is affordable because it runs once per refresh cycle,
    // entirely off the request path.
    br: brotliCompressSync(raw, {
      params: {
        [Z.BROTLI_PARAM_QUALITY]: 11,
        [Z.BROTLI_PARAM_SIZE_HINT]: raw.length,
      },
    }),
    gz: gzipSync(raw, { level: 9 }),
    type,
  };
}

async function rebuild() {
  if (building) return;
  building = true;
  const t0 = performance.now();
  try {
    const next = await refreshAll();
    next.sig = await sha256Short(next.stories.map((s) => s.link).join('\n'), 16);

    const list = renderList(next);
    next.listEtag = `"${await sha256Short(list)}"`;
    const page = renderPage(next);
    const status = JSON.stringify({ sig: next.sig, builtAt: next.builtAt, stories: next.counts.stories });
    const wire = JSON.stringify({
      builtAt: next.builtAt,
      counts: next.counts,
      health: next.health,
      stories: next.stories.map((s) => ({
        title: s.title, link: s.link, summary: s.summary, image: s.image,
        published: s.published, source: s.source.id, sourceName: s.source.name,
        teams: s.teams, outlets: s.outlets, alsoIn: s.alsoIn,
      })),
    });

    const fresh = new Map();
    fresh.set('/', await bake(page, 'text/html; charset=utf-8'));
    const listAsset = await bake(list, 'text/html; charset=utf-8');
    listAsset.etag = next.listEtag;   // must match what the page advertises
    fresh.set('/fragment/list', listAsset);
    fresh.set('/api/status', await bake(status, 'application/json; charset=utf-8'));
    fresh.set('/api/wire', await bake(wire, 'application/json; charset=utf-8'));

    assets = fresh;
    state = next;

    const kb = (fresh.get('/').br.length / 1024).toFixed(1);
    const rawKb = (fresh.get('/').raw.length / 1024).toFixed(1);
    log(`refresh ok  ${next.counts.live}/${next.counts.sources} feeds · `
      + `${next.counts.raw} items → ${next.counts.stories} stories · `
      + `page ${rawKb}kB → ${kb}kB br · ${Math.round(performance.now() - t0)}ms`);
  } catch (err) {
    log(`refresh FAILED: ${err.stack || err.message}`);
  } finally {
    building = false;
  }
}

function log(msg) {
  process.stdout.write(`[${new Date().toISOString().slice(11, 19)}] ${msg}\n`);
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

function csp() {
  const h = cspHashes();
  return [
    "default-src 'none'",
    "img-src https: data:",
    `style-src ${h.css}`,
    `script-src ${h.js}`,
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

const WARMING = Buffer.from(
  `<!doctype html><meta charset="utf-8"><title>NBA Wire — warming up</title>`
  + `<meta http-equiv="refresh" content="2">`
  + `<style>html{background:#e7e9ec;color:#0b0c0e;font:14px -apple-system,Helvetica,sans-serif;`
  + `display:grid;place-items:center;height:100%}div{text-align:center}b{display:block;font-size:19px;`
  + `letter-spacing:-.02em;margin-bottom:6px}</style>`
  + `<div><b>NBA WIRE</b>Pulling the first wire…</div>`,
);

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

function pickEncoding(req) {
  const ae = req.headers['accept-encoding'] || '';
  if (/\bbr\b/.test(ae)) return ['br', 'br'];
  if (/\bgzip\b/.test(ae)) return ['gz', 'gzip'];
  return ['raw', null];
}

const server = createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  const method = req.method || 'GET';

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');

  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD', 'content-length': 0 });
    return res.end();
  }

  if (url === '/healthz') {
    const ok = !!state;
    const body = JSON.stringify({
      ok,
      builtAt: state?.builtAt ?? null,
      ageMs: state ? Date.now() - state.builtAt : null,
      counts: state?.counts ?? null,
      feeds: state?.health?.map((h) => ({ id: h.id, ok: h.ok })) ?? [],
    });
    res.writeHead(ok ? 200 : 503, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(body),
    });
    return res.end(method === 'HEAD' ? undefined : body);
  }

  const asset = assets.get(url);

  if (!asset) {
    if (url === '/' ) {
      // First cycle has not landed yet.
      res.writeHead(503, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'retry-after': '2',
        'content-length': WARMING.length,
      });
      return res.end(method === 'HEAD' ? undefined : WARMING);
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'content-length': 10 });
    return res.end(method === 'HEAD' ? undefined : 'not found\n');
  }

  // Revalidate cheaply: an unchanged wire costs the client a 304 and no body.
  if (etagMatches(req.headers['if-none-match'], asset.etag)) {
    res.writeHead(304, { etag: asset.etag, 'cache-control': 'no-cache' });
    return res.end();
  }

  const [key, encoding] = pickEncoding(req);
  const body = asset[key];

  const headers = {
    'content-type': asset.type,
    'content-length': body.length,
    etag: asset.etag,
    'cache-control': 'no-cache',
    vary: 'Accept-Encoding',
  };
  if (encoding) headers['content-encoding'] = encoding;
  if (asset.type.startsWith('text/html')) headers['content-security-policy'] = csp();

  res.writeHead(200, headers);
  res.end(method === 'HEAD' ? undefined : body);
});

server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

// Local/VPS entry: assets come off disk, so there is still no build step here.
await configureAssets(
  readFileSync(join(here, 'ui/app.css'), 'utf8'),
  readFileSync(join(here, 'ui/app.js'), 'utf8'),
);

server.listen(PORT, HOST, () => {
  log(`NBA WIRE listening on http://localhost:${PORT}  (refresh every ${REFRESH_MS / 1000}s)`);
  rebuild();
  const timer = setInterval(rebuild, REFRESH_MS);
  timer.unref?.();
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    log('shutting down');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
