const KEY = process.env.ANTHROPIC_API_KEY || process.env.coffee_lab_anthropic_key, MODEL = process.env.SCAN_MODEL || 'claude-sonnet-5-5';
const SCHEMA = '{"name","roaster","originCountry": country in HEBREW,"region","producer": farm / washing station / cooperative,"variety","process": one of ["שטופה (Washed)","נטורל (Natural)","האני (Honey)","אנאירובי","תסיסה מבוקרת / ניסיונית","שטופה-למחצה"],"elevation": meters number (midpoint),"roastLevel": one of ["light","light-med","medium","med-dark","dark"],"notes": tasting notes comma separated,"info": one or two Hebrew sentences with other useful facts (harvest, lot, certifications, roaster brewing advice),"sourceUrl": the product page URL you used}';
const BAD = /(^|\.)(google|bing|duckduckgo|yahoo|facebook|instagram|pinterest|reddit|youtube|tiktok|twitter|x|amazon|ebay|aliexpress)\./i;
const call = async (body) => { const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(Object.assign({ model: MODEL }, body)) }); if (!r.ok) throw new Error('upstream ' + r.status); return r.json(); };
const textOf = (j) => (j.content || []).filter((x) => x.type === 'text').map((x) => x.text || '').join('\n');
const jsonOf = (t) => { const a = t.indexOf('{'), b = t.lastIndexOf('}'); if (a < 0 || b <= a) return {}; try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { return {}; } };
const toks = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9֐-׿ ]/g, ' ').split(/\s+/).filter((w) => w.length >= 4);
const strip = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>|<svg[\s\S]*?<\/svg>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
async function getPage(u) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), 7000);
  try {
    const r = await fetch(u, { signal: c.signal, redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (compatible; CoffeeLabBot/1.0)', accept: 'text/html,*/*' } });
    if (!r.ok || !/html|text/.test(r.headers.get('content-type') || '')) return null;
    const h = (await r.text()).slice(0, 700000);
    const ld = (h.match(/<script[^>]+ld\+json[^>]*>[\s\S]*?<\/script>/gi) || []).map((x) => x.replace(/<[^>]+>/g, ' ')).filter((x) => /"Product"/.test(x)).join(' ').slice(0, 2500) + ' ' + (h.match(/<meta[^>]+(?:property="og:description"|name="description")[^>]*>/gi) || []).map((x) => (x.match(/content="([^"]*)"/i) || [])[1] || '').join(' ');
    const title = ((h.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').trim();
    const text = (title + ' ' + ld + ' ' + strip(h.replace(/<(header|nav|footer|aside|form|dialog)[\s\S]*?<\/\1>/gi, ' '))).slice(0, 12000);
    return text.length > 200 ? { url: u, title, text } : null;
  } catch (e) { return null; } finally { clearTimeout(t); }
}
module.exports = async (req, res) => {
  const send = (c, o) => { res.statusCode = c; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
  if (req.method !== 'POST') return send(200, { ok: !!KEY });
  if (!KEY) return send(503, { error: 'no key' });
  const parts = []; let n = 0;
  for await (const d of req) { n += d.length; if (n > 20000) return send(413, { error: 'big' }); parts.push(d); }
  let known; try { known = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch (e) { return send(400, { error: 'bad' }); }
  try {
    const p1 = 'The label of a coffee bag showed (JSON): ' + JSON.stringify(known) + '\n\nWeb search for the roaster\'s own product page for this exact coffee (try "<roaster> <name>", then the roaster site, then the farm/washing station). Reply with ONLY one JSON object ' + SCHEMA + ' with null for anything you could not confirm; use null for process and roastLevel unless a source states them for this coffee. Never invent.';
    const j1 = await call({ max_tokens: 2000, tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }], messages: [{ role: 'user', content: p1 }] });
    const first = jsonOf(textOf(j1));
    const cand = []; (j1.content || []).forEach((b) => { if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) b.content.forEach((x) => { if (x && x.url) cand.push({ url: x.url, title: x.title || '' }); }); });
    if (first.sourceUrl) cand.push({ url: first.sourceUrl, title: '' });
    const rt = toks(known.roaster), nt = toks(known.name);
    const score = (c) => { let h = ''; try { h = new URL(c.url).hostname; } catch (e) { return -99; } if (BAD.test(h + '.')) return -50; const hay = (c.url + ' ' + c.title).toLowerCase(); let s = 0; rt.forEach((w) => { if (h.toLowerCase().includes(w)) s += 4; else if (hay.includes(w)) s += 1; }); nt.forEach((w) => { if (hay.includes(w)) s += 2; }); if (/\/(products?|shop|coffee|collections)\//.test(c.url)) s += 2; return s; };
    const hosts = []; cand.forEach((c) => { try { const u = new URL(c.url); if (!BAD.test(u.hostname + '.') && rt.some((w) => u.hostname.toLowerCase().includes(w)) && !hosts.includes(u.origin)) hosts.push(u.origin); } catch (e) { /* skip */ } });
    const q = encodeURIComponent([known.name, known.producer].filter(Boolean).join(' ').slice(0, 80));
    await Promise.all(hosts.slice(0, 2).map(async (o) => { const c = new AbortController(); const t = setTimeout(() => c.abort(), 6000); try { const r = await fetch(o + '/search/suggest.json?q=' + q + '&resources[type]=product&resources[limit]=5', { signal: c.signal, headers: { 'user-agent': 'Mozilla/5.0 (compatible; CoffeeLabBot/1.0)' } }); if (!r.ok) return; const j = await r.json(); (((j.resources || {}).results || {}).products || []).forEach((p) => { if (p.url) cand.push({ url: o + p.url.split('?')[0], title: p.title || '' }); }); } catch (e) { /* not shopify */ } finally { clearTimeout(t); } }));
    const seen = new Set(); const top = cand.filter((c) => { if (seen.has(c.url)) return false; seen.add(c.url); return true; }).map((c) => ({ c, s: score(c) })).filter((x) => x.s > -10).sort((a, b) => b.s - a.s).slice(0, 3).map((x) => x.c.url);
    const pages = (await Promise.all(top.map(getPage))).filter(Boolean);
    let out = first;
    if (pages.length) {
      const p2 = 'The label of a coffee bag showed (JSON): ' + JSON.stringify(known) + '\n\nBelow are web pages. Find the one that is the product page for THIS exact coffee (same roaster, same coffee name/lot) and extract details from it only. The label name may be partial (for example a label saying Finca Tamana matches the page Finca Tamana Variedad Colombia by the same roaster): choose the best matching page and extract from it. Return {} only if no page is plausibly this coffee. Reply with ONLY one JSON object ' + SCHEMA + ', null when the page does not state it. sourceUrl must be one of the page URLs below.\n\n' + pages.map((p, i) => '### PAGE ' + (i + 1) + ' ' + p.url + '\nTitle: ' + p.title + '\n' + p.text).join('\n\n');
      const j2 = await call({ max_tokens: 1500, messages: [{ role: 'user', content: p2 }] });
      const dbgKeep = out; const raw2 = textOf(j2); const second = jsonOf(raw2); if (known._debug) dbgKeep.dbg = { top, raw2: raw2.slice(0, 700), pages: pages.map((p) => ({ url: p.url, len: p.text.length, head: p.text.slice(0, 250) })) };
      out = Object.assign({}, first, { dbg: dbgKeep.dbg }); Object.keys(second).forEach((k) => { if (second[k] != null && second[k] !== '') out[k] = second[k]; });
      const nz = (x) => String(x || '').split(/[?#]/)[0].replace(/\/+$/, '').toLowerCase(); const hit = pages.find((p) => nz(p.url) === nz(second.sourceUrl)) || (Object.keys(second).some((k) => k !== 'sourceUrl' && second[k] != null) && pages.length === 1 ? pages[0] : null); out.sourceUrl = hit ? hit.url : null;
    } else out.sourceUrl = null;
    out.pagesRead = pages.length;
    send(200, out);
  } catch (e) { send(502, { error: 'fail' }); }
};
