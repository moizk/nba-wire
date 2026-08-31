// Hashing via Web Crypto, which exists identically in Node 19+ and Workers.
// Using node:crypto here would tie the render/serve path to one runtime.

const enc = new TextEncoder();

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

async function digest(input) {
  const data = typeof input === 'string' ? enc.encode(input) : input;
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

/** Standard base64 — the form a CSP `sha256-...` source expects. */
export async function sha256Base64(input) {
  return toBase64(await digest(input));
}

/** URL-safe and truncated: used for ETags and the wire signature. */
export async function sha256Short(input, len = 22) {
  const b64 = toBase64(await digest(input));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, len);
}
