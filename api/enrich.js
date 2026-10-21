const KEY = process.env.ANTHROPIC_API_KEY || process.env.coffee_lab_anthropic_key, MODEL = process.env.SCAN_MODEL || 'claude-sonnet-5-5';
const PROMPT = (k) => 'You are helping fill a specialty-coffee bean profile. From the label of a coffee bag we already know (JSON): ' + JSON.stringify(k) + '\n\nUse web search to find the roaster\'s official product page (or a trusted retailer page) for this exact coffee, then return the details that are NOT yet known. Only use facts stated on pages about this exact coffee; never guess. Reply with ONLY one JSON object, keys (omit or null when not found): {"name","roaster","originCountry": country in HEBREW, "region","producer": farm/washing station,"variety","process": one of ["שטופה (Washed)","נטורל (Natural)","האני (Honey)","אנאירובי","תסיסה מבוקרת / ניסיונית","שטופה-למחצה"],"elevation": meters number (midpoint),"roastLevel": one of ["light","light-med","medium","med-dark","dark"],"notes": tasting notes comma separated,"info": one or two Hebrew sentences with other useful facts (harvest, lot, certifications, brewing suggestion by roaster),"sourceUrl": the page you used}.';
module.exports = async (req, res) => {
const send = (c, o) => { res.statusCode = c; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
if (req.method !== 'POST') return send(200, { ok: !!KEY });
if (!KEY) return send(503, { error: 'no key' });
const parts = []; let n = 0;
for await (const d of req) { n += d.length; if (n > 20000) return send(413, { error: 'big' }); parts.push(d); }
let known; try { known = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch (e) { return send(400, { error: 'bad' }); }
try {
const body = { model: MODEL, max_tokens: 1500, tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }], messages: [{ role: 'user', content: PROMPT(known) }] };
const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) });
const j = await r.json(); if (!r.ok) return send(502, { error: 'upstream' });
const t = (j.content || []).filter((x) => x.type === 'text').map((x) => x.text || '').join('\n');
const a = t.indexOf('{'), b = t.lastIndexOf('}');
send(200, a >= 0 && b > a ? JSON.parse(t.slice(a, b + 1)) : {});
} catch (e) { send(502, { error: 'fail' }); }
};
