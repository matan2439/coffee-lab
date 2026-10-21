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
    '3) recent specialty-coffee news worth knowing (harvests, prices, new releases from their roasters, notable research or gear).\n' +
    'Only include items you found in search results, each with its real URL. Prefer items dated within the last 2 months or upcoming. 8 to 14 items.\n' +
    'Reply with ONLY JSON {"items":[{"kind":"workshop"|"event"|"news"|"release","title": Hebrew title,"summary": 1-2 Hebrew sentences why it is relevant to them,"date":"YYYY-MM-DD" or null (event/publish date),"where": city or online or null,"url":"https://...","source": site name}]}';
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: MODEL, max_tokens: 3500, tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }], messages: [{ role: 'user', content: prompt }] }) });
  if (!r.ok) return [];
  const j = await r.json(); const t = (j.content || []).filter((x) => x.type === 'text').map((x) => x.text).join('\n');
  const seen = new Set(); (j.content || []).forEach((b) => { if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) b.content.forEach((x) => { if (x && x.url) seen.add(x.url.split('#')[0]); }); });
  const a = t.indexOf('{'), b = t.lastIndexOf('}'); let o = {}; try { o = JSON.parse(t.slice(a, b + 1)); } catch (e) { return []; }
  return (Array.isArray(o.items) ? o.items : []).filter((x) => x && x.title && /^https?:\/\//.test(x.url || '')).map((x) => ({ kind: /^(workshop|event|news|release)$/.test(x.kind) ? x.kind : 'news', title: String(x.title).slice(0, 160), summary: String(x.summary || '').slice(0, 400), date: /^\d{4}-\d{2}-\d{2}$/.test(x.date || '') ? x.date : null, where: x.where ? String(x.where).slice(0, 60) : null, url: x.url, source: String(x.source || '').slice(0, 60), verified: seen.has(String(x.url).split('#')[0]) })).slice(0, 16);
}

module.exports = async (req, res) => {
  const send = (c, o, cache) => { res.statusCode = c; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', cache ? 'public, s-maxage=21600, stale-while-revalidate=43200' : 'no-store'); res.end(JSON.stringify(o)); };
  try {
    const q = {}; const sp = new URL(req.url, 'http://x').searchParams; ['roasters', 'origins', 'methods', 'loc'].forEach((k) => { q[k] = (sp.get(k) || '').slice(0, 300); });
    const sites = (sp.get('sites') || '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(s)).slice(0, 8).map((h) => 'https://' + h);
    const [posts, items] = await Promise.all([Promise.all(sites.map((s) => blog(s).catch(() => []))).then((a) => [].concat(...a)), sp.get('ai') === '0' ? Promise.resolve([]) : digest(q).catch(() => [])]);
    send(200, { at: new Date().toISOString(), posts: posts.filter((p) => p.title && p.url), items }, true);
  } catch (e) { send(502, { error: 'fail' }); }
};
