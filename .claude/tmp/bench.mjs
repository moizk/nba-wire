import http from 'node:http';
const agent = new http.Agent({ keepAlive: true, maxSockets: 64 });
const PORT = 8420;

function hit(path, headers = {}) {
  return new Promise((res, rej) => {
    const t0 = process.hrtime.bigint();
    const req = http.get({ port: PORT, path, agent, headers }, (r) => {
      let n = 0;
      r.on('data', (c) => { n += c.length; });
      r.on('end', () => res({ ms: Number(process.hrtime.bigint() - t0) / 1e6, status: r.statusCode, bytes: n }));
    });
    req.on('error', rej);
  });
}

async function bench(label, path, headers, total = 3000, conc = 50) {
  await Promise.all(Array.from({ length: 50 }, () => hit(path, headers))); // warm
  const lat = [];
  let done = 0, bytes = 0;
  const t0 = performance.now();
  await Promise.all(Array.from({ length: conc }, async () => {
    while (done < total) { done++; const r = await hit(path, headers); lat.push(r.ms); bytes += r.bytes; }
  }));
  const secs = (performance.now() - t0) / 1000;
  lat.sort((a, b) => a - b);
  const p = (q) => lat[Math.floor(lat.length * q)].toFixed(2);
  console.log(
    label.padEnd(34),
    `${Math.round(total / secs).toLocaleString().padStart(7)} req/s`,
    ` p50 ${p(0.5)}ms  p95 ${p(0.95)}ms  p99 ${p(0.99)}ms`,
    ` ${(bytes / total).toFixed(0)}B/req`,
  );
}

const et = await new Promise((res) => http.get({ port: PORT, path: '/', agent }, (r) => { r.resume(); res(r.headers.etag); }));
await bench('GET /            (brotli)', '/', { 'accept-encoding': 'br' });
await bench('GET /            (gzip)', '/', { 'accept-encoding': 'gzip' });
await bench('GET /            (uncompressed)', '/', {});
await bench('GET / revalidate (304)', '/', { 'accept-encoding': 'br', 'if-none-match': et });
await bench('GET /api/status', '/api/status', { 'accept-encoding': 'br' });
