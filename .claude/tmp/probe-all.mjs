import { SOURCES } from '../../src/sources.js';
import { parseFeed, stripHtml, decodeBody } from '../../src/parse.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
for (const s of SOURCES) {
  const t0 = performance.now();
  try {
    const r = await fetch(s.url, { headers: { 'user-agent': UA, accept: 'application/rss+xml,application/xml,text/xml,*/*' } });
    const xml = decodeBody(Buffer.from(await r.arrayBuffer()), r.headers.get('content-type') || '');
    const items = parseFeed(xml);
    const ms = (performance.now() - t0).toFixed(0);
    const withDate = items.filter(i => i.published > 0).length;
    const withImg  = items.filter(i => i.image).length;
    const newest = items.reduce((a,i)=>Math.max(a,i.published),0);
    const age = newest ? ((Date.now()-newest)/3600e3).toFixed(1)+'h' : 'n/a';
    console.log(`${String(items.length).padStart(3)} items | dates ${String(withDate).padStart(3)} | img ${String(withImg).padStart(3)} | newest ${age.padStart(6)} | ${ms}ms  ${s.id}`);
    if (!items.length) console.log('      !! EMPTY. head:', xml.slice(0,160).replace(/\s+/g,' '));
    else console.log(`      e.g. "${items[0].title.slice(0,80)}" -> ${items[0].link.slice(0,70)}`);
  } catch (e) {
    console.log(`  ERR ${s.id}: ${e.message}`);
  }
}
