// Coffee newsletter: blog posts from the user's roasters + a web-searched digest of news, workshops and events.
// GET ?sites=host1,host2&roasters=..&origins=..&methods=..&loc=Israel   (cached at the edge for 6h)
const KEY = process.env.ANTHROPIC_API_KEY || process.env.coffee_lab_anthropic_key, MODEL = process.env.SCAN_MODEL || 'claude-sonnet-5-5';
const UA = { 'user-agent': 'Mozilla/5.0 (compatible; CoffeeLabBot/1.0)' };
const ent = (s) => String(s || '').replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16))).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const txt = (h) => ent(String(h || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
async function get(u, ms, asText) { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms || 6000); try { const r = await fetch(u, { signal: c.signal, headers: UA, redirect: 'follow' }); if (!r.ok) return null; return asText ? await r.text() : await r.json(); } catch (e) { return null; } finally { clearTimeout(t); } }

async function blog(site) {
  const wp = await get(site + '/wp-json/wp/v2/posts?per_page=4&_embed=wp:featuredmedia', 6000);
  if (Array.isArray(wp)) return wp.map((p) => { const m = p._embedded && p._embedded['wp:featuredmedia'] && p._embedded['wp:featuredmedia'][0]; return { kind: 'blog', title: txt(p.title && p.title.rendered), summary: txt(p.excerpt && p.excerpt.rendered).slice(0, 260), url: p.link, date: String(p.date || '').slice(0, 10), image: (m && (m.media_details && m.media_details.sizes && (m.media_details.sizes.medium_large || m.media_details.sizes.medium || {}).source_url)) || (m && m.source_url) || '', source: site.replace(/^https?:\/\/(www\.)?/, '') }; });
  for (const h of ['news', 'journal', 'blog']) {
    const x = await get(site + '/blogs/' + h + '.atom', 5000, true); if (!x || !/<entry/.test(x)) continue;
    return (x.match(/<entry>[\s\S]*?<\/entry>/g) || []).slice(0, 4).map((e) => { const g = (re) => (e.match(re) || [])[1] || ''; const content = ent(g(/<content[^>]*>([\s\S]*?)<\/content>/)); return { kind: 'blog', title: txt(g(/<title[^>]*>([\s\S]*?)<\/title>/)), summary: txt(g(/<summary[^>]*>([\s\S]*?)<\/summary>/) || content).slice(0, 260), url: g(/<link[^>]+href="([^"]+)"/), date: g(/<published>([^<]+)</).slice(0, 10), image: (content.match(/<img[^>]+src="([^"]+)"/) || [])[1] || '', source: site.replace(/^https?:\/\/(www\.)?/, '') }; });
  }
  return [];
}

async function digest(q) {
  if (!KEY) return [];
  const today = new Date().toISOString().slice(0, 10);
  const prompt = 'Today is ' + today + '. You write a short personal newsletter for a home specialty-coffee enthusiast who lives in ' + (q.loc || 'Israel') + '.\n' +
    'Their roasters: ' + (q.roasters || 'unknown') + '. Origins they drink: ' + (q.origins || 'various') + '. Brew methods: ' + (q.methods || 'filter, espresso') + '.\n' +
    'Use web search (Hebrew and English queries) to find REAL, current items:\n' +
    '1) upcoming coffee workshops, courses, cuppings and tastings in ' + (q.loc || 'Israel') + ' (barista courses, latte art, home brewing, roastery workshops), including from their roasters;\n' +
    '2) upcoming coffee events and festivals in ' + (q.loc || 'Israel') + ', plus major international ones (World Coffee Championships etc.);\n' +
    '3) new releases or news from their roasters.\n' +
    'Only include items you found in search results. Each url MUST be the specific page of that item (the article, the workshop page, the event page), never a homepage, a category or a /news listing page, and never the same url twice. Prefer items dated within the last 2 months or upcoming. 6 to 12 items.\n' +
    'Reply with ONLY JSON {"items":[{"kind":"workshop"|"event"|"news"|"release","title": Hebrew title,"summary": 1-2 Hebrew sentences why it is relevant to them,"date":"YYYY-MM-DD" or null (event/publish date),"where": city name or null,"url":"https://...","source": site name}]}';
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: MODEL, max_tokens: 3500, tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }], messages: [{ role: 'user', content: prompt }] }) });
  if (!r.ok) return [];
  const j = await r.json(); const t = (j.content || []).filter((x) => x.type === 'text').map((x) => x.text).join('\n');
  const seen = new Set(); (j.content || []).forEach((b) => { if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) b.content.forEach((x) => { if (x && x.url) seen.add(x.url.split('#')[0]); }); });
  const a = t.indexOf('{'), b = t.lastIndexOf('}'); let o = {}; try { o = JSON.parse(t.slice(a, b + 1)); } catch (e) { return []; }
  const used = new Set();
  return (Array.isArray(o.items) ? o.items : []).filter((x) => { if (!x || !x.title || !/^https?:\/\//.test(x.url || '')) return false; let u; try { u = new URL(x.url); } catch (e) { return false; } const path = u.pathname.replace(/\/+$/, ''); if (!path || /^\/(news|blog|blogs|events?|workshops?|courses?|he|en|articles?|category\/[^/]+)$/i.test(path)) return false; const k = u.host + path; if (used.has(k)) return false; used.add(k); return true; }).map((x) => ({ kind: /^(workshop|event|news|release)$/.test(x.kind) ? x.kind : 'news', title: String(x.title).slice(0, 160), summary: String(x.summary || '').slice(0, 400), date: /^\d{4}-\d{2}-\d{2}$/.test(x.date || '') ? x.date : null, where: x.where && !/^(online|אונליין|מקוון|null)$/i.test(String(x.where).trim()) ? String(x.where).slice(0, 60) : null, url: x.url, source: String(x.source || '').slice(0, 60), verified: seen.has(String(x.url).split('#')[0]) })).slice(0, 16);
}

const FEEDS = [['https://perfectdailygrind.com/feed/', 'Perfect Daily Grind'], ['https://sprudge.com/feed', 'Sprudge'], ['https://dailycoffeenews.com/feed/', 'Daily Coffee News']];
async function rss() {
  const out = [];
  await Promise.all(FEEDS.map(async ([u, src]) => {
    const x = await get(u, 6000, true); if (!x) return;
    (x.match(/<item[\s\S]*?<\/item>/g) || []).slice(0, 5).forEach((it) => {
      const g = (re) => { const m = it.match(re); return m ? m[1].replace(/^<!\[CDATA\[|\]\]>$/g, '') : ''; };
      const link = g(/<link>([^<]+)<\/link>/).trim(); const title = txt(g(/<title>([\s\S]*?)<\/title>/)); if (!link || !title) return;
      const desc = txt(g(/<description>([\s\S]*?)<\/description>/)).replace(/The post .*? appeared first on .*$/, '').slice(0, 300);
      const img = (it.match(/<media:content[^>]+url="([^"]+)"/) || it.match(/<enclosure[^>]+url="([^"]+)"/) || ent(g(/<content:encoded>([\s\S]*?)<\/content:encoded>/)).match(/<img[^>]+src="([^"]+)"/) || [])[1] || '';
      const d = new Date(g(/<pubDate>([^<]+)<\/pubDate>/)); out.push({ kind: 'news', title, summary: desc, url: link, date: isNaN(d) ? null : d.toISOString().slice(0, 10), image: img, source: src, en: true });
    });
  }));
  return out.sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 12);
}
async function toHebrew(items) {
  if (!KEY || !items.length) return items;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: MODEL, max_tokens: 2500, messages: [{ role: 'user', content: 'Translate these specialty-coffee news headlines to natural Hebrew and write one short Hebrew sentence summary for each from its description. Keep names of people, farms and brands in English. Reply with ONLY a JSON array of {"i":index,"title":"...","summary":"..."}.\n' + JSON.stringify(items.map((x, i) => ({ i, title: x.title, description: x.summary }))) }] }) });
    if (!r.ok) return items; const j = await r.json(); const t = (j.content || []).filter((x) => x.type === 'text').map((x) => x.text).join(''); const a = t.indexOf('['), b = t.lastIndexOf(']'); const arr = JSON.parse(t.slice(a, b + 1));
    arr.forEach((x) => { const it = items[x.i]; if (it && x.title) { it.title = String(x.title).slice(0, 180); it.summary = String(x.summary || '').slice(0, 300); it.en = false; } });
  } catch (e) { /* keep English */ }
  return items;
}
async function ogImages(items, ms) {
  const job = Promise.all(items.filter((x) => !x.image).slice(0, 14).map(async (x) => { const h = await get(x.url, ms, true); if (!h) return; const m = h.slice(0, 200000).match(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]*>/i); const c = m && (m[0].match(/content=["']([^"']+)["']/i) || [])[1]; if (c) { try { x.image = new URL(ent(c), x.url).href; } catch (e) { /* skip */ } } }));
  await Promise.race([job, new Promise((r) => setTimeout(r, ms + 500))]); return items;
}
module.exports = async (req, res) => {
  const send = (c, o, cache) => { res.statusCode = c; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', cache ? 'public, s-maxage=21600, stale-while-revalidate=43200' : 'no-store'); res.end(JSON.stringify(o)); };
  try {
    const q = {}; const sp = new URL(req.url, 'http://x').searchParams; ['roasters', 'origins', 'methods', 'loc'].forEach((k) => { q[k] = (sp.get(k) || '').slice(0, 300); });
    const sites = (sp.get('sites') || '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(s)).slice(0, 8).map((h) => 'https://' + h);
    const t0 = Date.now();
    const [posts, items, world] = await Promise.all([Promise.all(sites.map((s) => blog(s).catch(() => []))).then((a) => [].concat(...a)), sp.get('ai') === '0' ? Promise.resolve([]) : digest(q).catch(() => []), rss().then(toHebrew).catch(() => [])]);
    const left = 52000 - (Date.now() - t0); if (left > 2500) await ogImages(items, Math.min(4000, left - 1500));
    send(200, { at: new Date().toISOString(), posts: posts.filter((p) => p.title && p.url), items: items.concat(world) }, true);
  } catch (e) { send(502, { error: 'fail' }); }
};
