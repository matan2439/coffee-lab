const KEY = process.env.ANTHROPIC_API_KEY || process.env.coffee_lab_anthropic_key, MODEL = process.env.SCAN_MODEL || 'claude-sonnet-5-5';
const UA = { 'user-agent': 'Mozilla/5.0 (compatible; CoffeeLabBot/1.0)', accept: 'application/json,*/*' };
const J = async (u, ms) => { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms || 7000); try { const r = await fetch(u, { signal: c.signal, headers: UA, redirect: 'follow' }); if (!r.ok) return null; return await r.json(); } catch (e) { return null; } finally { clearTimeout(t); } };
const clean = (s) => String(s || '').replace(/\/\/(business|wholesale|b2b|pro|trade)\./i, '//');
async function findSite(roaster) {
  if (!KEY || !roaster) return '';
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: MODEL, max_tokens: 400, tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }], messages: [{ role: 'user', content: 'Find the official online shop website of the specialty coffee roaster "' + roaster + '". Reply with ONLY JSON {"site": "https://..."} (homepage origin, retail shop, not wholesale) or {"site": null}.' }] }) });
  if (!r.ok) return ''; const j = await r.json(); const t = (j.content || []).filter((x) => x.type === 'text').map((x) => x.text).join(''); const m = t.match(/\{[\s\S]*\}/); try { const u = new URL(JSON.parse(m[0]).site); return u.origin; } catch (e) { return ''; }
}
module.exports = async (req, res) => {
  const send = (c, o, cache) => { res.statusCode = c; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', cache ? 'public, s-maxage=1800, stale-while-revalidate=3600' : 'no-store'); res.end(JSON.stringify(o)); };
  const q = new URL(req.url, 'http://x').searchParams; const roaster = (q.get('roaster') || '').slice(0, 80);
  let site = '', raw = (q.get('site') || '').trim(); try { if (raw) site = new URL(/^https?:/.test(raw) ? raw : 'https://' + raw).origin; } catch (e) { site = ''; }
  site = clean(site);
  try {
    if (!site) site = await findSite(roaster);
    if (!site) return send(200, { site: '', products: [], note: 'site' });
    const [meta, pj] = await Promise.all([J(site + '/meta.json', 5000), J(site + '/products.json?limit=120', 9000)]);
    const cur = (meta && (meta.currency || (meta.shop && meta.shop.currency))) || '';
    if (!pj || !Array.isArray(pj.products)) return send(200, { site, currency: cur, products: [], shopify: false }, true);
    const products = pj.products.map((p) => {
      const v = (p.variants || []).slice().sort((a, b) => parseFloat(a.price) - parseFloat(b.price)); const av = v.some((x) => x.available !== false);
      return { title: p.title, url: site + '/products/' + p.handle, price: v.length ? parseFloat(v[0].price) : null, image: (p.images && p.images[0] && p.images[0].src) || '', type: p.product_type || '', tags: Array.isArray(p.tags) ? p.tags.slice(0, 8) : String(p.tags || '').split(/,\s*/).slice(0, 8), available: av, updated: p.updated_at || p.published_at || '' };
    }).filter((p) => p.title);
    send(200, { site, currency: cur, shopify: true, products }, true);
  } catch (e) { send(502, { error: 'fail' }); }
};
