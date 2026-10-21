// Catalog of a roaster's own web shop (Shopify or WooCommerce), normalized for the app's store.
// GET  ?roaster=&site=            -> { site, platform, currency, products:[...] }
// GET  ?site=&ids=1,2             -> { details: { id: { sizes:[{label,grams,price,available,variantId}] } } }
// POST { roaster, beans:[{id,name,origin}], products:[{id,title}] } -> { matches: { beanId: productId|null } }
const KEY = process.env.ANTHROPIC_API_KEY || process.env.coffee_lab_anthropic_key, MODEL = process.env.SCAN_MODEL || 'claude-sonnet-5-5';
const UA = { 'user-agent': 'Mozilla/5.0 (compatible; CoffeeLabBot/1.0)', accept: 'application/json,*/*' };
const J = async (u, ms) => { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms || 8000); try { const r = await fetch(u, { signal: c.signal, headers: UA, redirect: 'follow' }); if (!r.ok) return null; const tx = await r.text(); try { return { j: JSON.parse(tx), h: r.headers }; } catch (e) { return null; } } catch (e) { return null; } finally { clearTimeout(t); } };
const clean = (s) => String(s || '').replace(/\/\/(business|wholesale|b2b|pro|trade)\./i, '//');
const ent = (s) => String(s || '').replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16))).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const txt = (h) => ent(String(h || '').replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ').replace(/<br\s*\/?>|<\/p>|<\/li>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
const grams = (s) => { const t = String(s || '').toLowerCase().replace(/,/g, '.'); let m = t.match(/(\d+(?:\.\d+)?)\s*(kg|ק"ג|ק״ג|קג|קילו)/); if (m) return Math.round(parseFloat(m[1]) * 1000); m = t.match(/(\d+(?:\.\d+)?)\s*(grams|gram|gr|g|גרם|ג'|ג)(?![a-z\u0590-\u05ff])/); if (m) return Math.round(parseFloat(m[1])); m = t.match(/(\d+(?:\.\d+)?)\s*(oz)(?![a-z])/); if (m) return Math.round(parseFloat(m[1]) * 28.35); return null; };
const SIZE_ATTR = /גודל|משקל|כמות|size|weight|amount|vekt|størrelse|gewicht/i;

async function findSite(roaster) {
  if (!KEY || !roaster) return '';
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: MODEL, max_tokens: 400, tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }], messages: [{ role: 'user', content: 'Find the official online shop website of the specialty coffee roaster "' + roaster + '". Reply with ONLY JSON {"site": "https://..."} (homepage origin, retail shop, not wholesale) or {"site": null}.' }] }) });
  if (!r.ok) return ''; const j = await r.json(); const t = (j.content || []).filter((x) => x.type === 'text').map((x) => x.text).join(''); const m = t.match(/\{[\s\S]*\}/); try { return new URL(JSON.parse(m[0]).site).origin; } catch (e) { return ''; }
}

async function shopify(site) {
  const [meta, pj] = await Promise.all([J(site + '/meta.json', 5000), J(site + '/products.json?limit=250', 9000)]);
  if (!pj || !Array.isArray(pj.j.products)) return null;
  const cur = (meta && (meta.j.currency || (meta.j.shop && meta.j.shop.currency))) || '';
  const products = pj.j.products.map((p) => {
    const vs = (p.variants || []).map((v) => ({ label: v.title === 'Default Title' ? '' : v.title, grams: grams(v.title) || (v.grams ? Math.round(v.grams) : null), price: parseFloat(v.price), available: v.available !== false, variantId: v.id }));
    const seen = new Set(); const sizes = vs.filter((v) => { const k = (v.label || '').split(' / ')[0]; if (seen.has(k)) return false; seen.add(k); return true; }).map((v) => Object.assign({}, v, { label: (v.label || '').split(' / ')[0] })).sort((a, b) => a.price - b.price);
    const prices = vs.map((v) => v.price).filter((x) => x >= 0);
    const img = (p.images && p.images[0] && p.images[0].src) || '';
    return { id: String(p.id), title: ent(p.title), url: site + '/products/' + p.handle, price: prices.length ? Math.min(...prices) : null, priceMax: prices.length ? Math.max(...prices) : null, currency: cur, image: img, thumb: img ? img + (img.includes('?') ? '&' : '?') + 'width=480' : '', images: (p.images || []).slice(0, 5).map((i) => i.src), cats: [p.product_type].concat(Array.isArray(p.tags) ? p.tags : String(p.tags || '').split(/,\s*/)).filter(Boolean).slice(0, 10), sizes, available: vs.some((v) => v.available), updated: p.published_at || p.updated_at || '', desc: txt(p.body_html).slice(0, 700), slug: p.handle };
  }).filter((p) => p.title);
  return { platform: 'shopify', currency: cur, products };
}

function wooMoney(pr, v) { const u = Number(pr.currency_minor_unit || 0); const n = parseFloat(v); return isNaN(n) ? null : n / Math.pow(10, u); }
async function woo(site) {
  const first = await J(site + '/wp-json/wc/store/v1/products?per_page=100', 10000); if (!first || !Array.isArray(first.j)) return null;
  let all = first.j; const pages = parseInt(first.h.get('x-wp-totalpages') || '1', 10);
  if (pages > 1) { const more = await Promise.all([2, 3].filter((n) => n <= pages).map((n) => J(site + '/wp-json/wc/store/v1/products?per_page=100&page=' + n, 10000))); more.forEach((m) => { if (m && Array.isArray(m.j)) all = all.concat(m.j); }); }
  let cur = '';
  const products = all.map((p) => {
    const pr = p.prices || {}; cur = cur || pr.currency_code || '';
    const lo = pr.price_range ? wooMoney(pr, pr.price_range.min_amount) : wooMoney(pr, pr.price); const hi = pr.price_range ? wooMoney(pr, pr.price_range.max_amount) : lo;
    const sa = (p.attributes || []).find((a) => SIZE_ATTR.test(a.name || '')); const sizes = sa ? (sa.terms || []).map((t) => ({ label: ent(t.name), grams: grams(t.name), price: null })).sort((a, b) => (a.grams || 0) - (b.grams || 0)) : [];
    if (sizes.length && lo != null) sizes[0].price = lo; if (sizes.length > 1 && hi != null) sizes[sizes.length - 1].price = hi;
    const im = (p.images || [])[0] || {};
    let slug = p.slug || ''; try { slug = decodeURIComponent(slug); } catch (e) { /* keep */ }
    return { id: String(p.id), title: ent(p.name), url: p.permalink, price: lo, priceMax: hi, currency: pr.currency_code || '', image: im.src || '', thumb: im.thumbnail || im.src || '', images: (p.images || []).slice(0, 5).map((i) => i.src), cats: (p.categories || []).map((c) => ent(c.name)), sizes, variable: p.type === 'variable', available: p.is_in_stock !== false && p.is_purchasable !== false, updated: '', desc: txt(p.short_description || p.description).slice(0, 700), slug };
  }).filter((p) => p.title);
  return { platform: 'woocommerce', currency: cur, products };
}

async function wooDetails(site, ids) {
  const out = {};
  await Promise.all(ids.map(async (id) => {
    const p = await J(site + '/wp-json/wc/store/v1/products/' + encodeURIComponent(id), 8000); if (!p) return; const pj = p.j;
    const vars = (pj.variations || []).slice(0, 24); const sizeName = ((pj.attributes || []).find((a) => SIZE_ATTR.test(a.name || '')) || {}).name;
    const byLabel = {};
    await Promise.all(vars.map(async (v) => {
      const at = (v.attributes || []).find((a) => SIZE_ATTR.test(a.name || '') || (sizeName && a.name === sizeName)); if (!at) return;
      let label = ent(at.value || ''); try { label = decodeURIComponent(label); } catch (e) { /* keep */ }
      if (byLabel[label]) return; byLabel[label] = { label, grams: grams(label), price: null, available: true, variantId: v.id };
      const d = await J(site + '/wp-json/wc/store/v1/products/' + v.id, 8000); if (d && d.j.prices) { byLabel[label].price = wooMoney(d.j.prices, d.j.prices.price); byLabel[label].available = d.j.is_in_stock !== false; }
    }));
    // map slug-style labels back to the readable term names
    const terms = (((pj.attributes || []).find((a) => SIZE_ATTR.test(a.name || '')) || {}).terms || []);
    const sizes = Object.values(byLabel).map((s) => { const t = terms.find((x) => { let sl = x.slug || ''; try { sl = decodeURIComponent(sl); } catch (e) { /* keep */ } return sl === s.label || ent(x.name) === s.label; }); if (t) { s.label = ent(t.name); s.grams = grams(t.name) || s.grams; } else { s.label = s.label.replace(/-/g, ' '); s.grams = s.grams || grams(s.label.replace(/קג$/, 'ק"ג')); } return s; }).sort((a, b) => (a.grams || 0) - (b.grams || 0));
    out[id] = { sizes };
  }));
  return out;
}

async function aiMatch(body) {
  if (!KEY) return {};
  const beans = (body.beans || []).slice(0, 30).map((b) => ({ id: String(b.id), name: String(b.name || '').slice(0, 100), origin: String(b.origin || '').slice(0, 40) }));
  const prods = (body.products || []).slice(0, 250).map((p) => ({ id: String(p.id), title: String(p.title || '').slice(0, 120) }));
  if (!beans.length || !prods.length) return {};
  const prompt = 'Coffee roaster: ' + String(body.roaster || '').slice(0, 80) + '.\nBags the user owns (names as printed on the bag, may be English while the shop is Hebrew or vice versa):\n' + JSON.stringify(beans) + '\n\nProducts in the roaster\'s web shop:\n' + JSON.stringify(prods) + '\n\nFor each bag, pick the shop product that is the SAME coffee (same blend number or same farm/lot; "Blend #3" = "תערובת מס\' 03"; ignore bundles, gift cards, capsules, drip bags, equipment). Use null if no product is clearly the same coffee. Reply with ONLY JSON {"<bag id>": "<product id>" | null}.';
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: MODEL, max_tokens: 800, messages: [{ role: 'user', content: prompt }] }) });
  if (!r.ok) return {}; const j = await r.json(); const t = (j.content || []).filter((x) => x.type === 'text').map((x) => x.text).join(''); const a = t.indexOf('{'), b = t.lastIndexOf('}');
  let o = {}; try { o = JSON.parse(t.slice(a, b + 1)); } catch (e) { return {}; }
  const ids = new Set(prods.map((p) => p.id)); const out = {}; beans.forEach((b) => { const v = o[b.id]; out[b.id] = v != null && ids.has(String(v)) ? String(v) : null; }); return out;
}

module.exports = async (req, res) => {
  const send = (c, o, cache) => { res.statusCode = c; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', cache ? 'public, s-maxage=1800, stale-while-revalidate=3600' : 'no-store'); res.end(JSON.stringify(o)); };
  try {
    if (req.method === 'POST') {
      const parts = []; let n = 0; for await (const d of req) { n += d.length; if (n > 60000) return send(413, { error: 'big' }); parts.push(d); }
      let body; try { body = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch (e) { return send(400, { error: 'bad' }); }
      return send(200, { matches: await aiMatch(body) });
    }
    const q = new URL(req.url, 'http://x').searchParams; const roaster = (q.get('roaster') || '').slice(0, 80);
    let site = '', raw = (q.get('site') || '').trim(); try { if (raw) site = new URL(/^https?:/.test(raw) ? raw : 'https://' + raw).origin; } catch (e) { site = ''; }
    site = clean(site);
    const ids = (q.get('ids') || '').split(',').map((s) => s.trim()).filter((s) => /^\d{1,12}$/.test(s)).slice(0, 8);
    if (ids.length && site) return send(200, { details: await wooDetails(site, ids) }, true);
    if (!site) site = await findSite(roaster);
    if (!site) return send(200, { site: '', products: [], note: 'site' });
    const cat = (await shopify(site)) || (await woo(site));
    if (!cat) return send(200, { site, platform: 'other', currency: '', products: [], shopify: false }, true);
    send(200, Object.assign({ site, shopify: cat.platform === 'shopify' }, cat), true);
  } catch (e) { send(502, { error: 'fail' }); }
};
