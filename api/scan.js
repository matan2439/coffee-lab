const PROMPT = "This photo shows a bag of specialty coffee. Read ONLY what is visibly printed on the bag (any language). Reply with only one JSON object with these keys: {\"name\": coffee/lot name as printed, \"roaster\": roaster/brand name, \"originCountry\": country of origin in HEBREW (e.g. אתיופיה, קולומביה), \"region\": region/farm area, \"producer\": farm/producer/washing station, \"variety\": varieties as printed, \"process\": one of [\"שטופה (Washed)\",\"נטורל (Natural)\",\"האני (Honey)\",\"אנאירובי\",\"תסיסה מבוקרת / ניסיונית\",\"שטופה-למחצה\"] or null, \"elevation\": number in meters (midpoint if a range) or null, \"roastLevel\": one of [\"light\",\"light-med\",\"medium\",\"med-dark\",\"dark\"] or null, \"roastDate\": \"YYYY-MM-DD\" or null, \"weight\": net weight in grams as a number or null, \"notes\": tasting notes as printed, comma separated, \"uncertain\": array of key names you had to guess or could not read clearly}. Use null for anything not visible on the bag. Do not invent information that is not printed.";
const KEY = process.env.ANTHROPIC_API_KEY, MODEL = process.env.SCAN_MODEL || 'claude-sonnet-5-5';
module.exports = async (req, res) => {
const send = (c, o) => { res.statusCode = c; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
if (req.method === 'GET') return send(200, { ok: !!KEY });
if (!KEY) return send(503, { error: 'no key' });
const parts = []; let n = 0;
for await (const d of req) { n += d.length; if (n > 4e6) return send(413, { error: 'big' }); parts.push(d); }
try {
const body = { model: MODEL, max_tokens: 1000, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: Buffer.concat(parts).toString('base64') } }, { type: 'text', text: PROMPT }] }] };
const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) });
const j = await r.json(); if (!r.ok) return send(r.status === 429 ? 429 : 502, { error: 'upstream' });
const t = (j.content || []).map((x) => x.text || '').join(''); const m = t.match(/\{[\s\S]*\}/);
send(200, m ? JSON.parse(m[0]) : {});
} catch (e) { send(502, { error: 'fail' }); }
};
module.exports.config = { api: { bodyParser: false } };
