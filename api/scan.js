const PROMPT = "This photo shows a bag of specialty coffee. Read ONLY what is visibly printed on the bag (any language, Hebrew included; the label may be small, curved or partly glossy, so read carefully). Reply with only one JSON object with these keys: {\"name\": coffee/lot name as printed, \"roaster\": roaster/brand name, \"originCountry\": country of origin in HEBREW (e.g. אתיופיה, קולומביה), \"region\": region/farm area, \"producer\": farm/producer/washing station, \"variety\": varieties as printed, \"process\": one of [\"שטופה (Washed)\",\"נטורל (Natural)\",\"האני (Honey)\",\"אנאירובי\",\"תסיסה מבוקרת / ניסיונית\",\"שטופה-למחצה\"] or null, \"elevation\": number in meters (midpoint if a range) or null, \"roastLevel\": one of [\"light\",\"light-med\",\"medium\",\"med-dark\",\"dark\"] or null, \"roastDate\": \"YYYY-MM-DD\" or null, \"weight\": net weight in grams as a number or null, \"notes\": tasting notes as printed, comma separated, \"uncertain\": array of key names you had to guess or could not read clearly}. If the bag is a blend, put the blend name in name and the origins in originCountry/region as printed. Use null for anything not visible on the bag. Do not invent information that is not printed.";
const KEY = process.env.ANTHROPIC_API_KEY || process.env.coffee_lab_anthropic_key;
// try the configured model first, then fall back if a model is unavailable or overloaded
const MODELS = [...new Set([process.env.SCAN_MODEL, 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'].filter(Boolean))];
const sniff = (b) => (b[0] === 0x89 && b[1] === 0x50 ? 'image/png' : b[0] === 0x52 && b[8] === 0x57 ? 'image/webp' : b[0] === 0x47 && b[1] === 0x49 ? 'image/gif' : 'image/jpeg');
const parse = (t) => { const a = t.indexOf('{'), b = t.lastIndexOf('}'); if (a < 0 || b <= a) return null; try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { try { return JSON.parse(t.slice(a, b + 1).replace(/,\s*([}\]])/g, '$1').replace(/([^\\])\\(?!["\\/bfnrtu])/g, '$1')); } catch (e2) { return null; } } };
module.exports = async (req, res) => {
  const send = (c, o) => { res.statusCode = c; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(o)); };
  if (req.method === 'GET') return send(200, { ok: !!KEY });
  if (!KEY) return send(503, { error: 'no key' });
  const parts = []; let n = 0;
  for await (const d of req) { n += d.length; if (n > 4.5e6) return send(413, { error: 'big' }); parts.push(d); }
  const buf = Buffer.concat(parts); if (buf.length < 100) return send(400, { error: 'empty' });
  const img = { type: 'image', source: { type: 'base64', media_type: sniff(buf), data: buf.toString('base64') } };
  let last = null;
  for (const model of MODELS) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model, max_tokens: 1200, messages: [{ role: 'user', content: [img, { type: 'text', text: PROMPT }] }] }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { last = { status: r.status, type: j.error && j.error.type, msg: String((j.error && j.error.message) || '').slice(0, 200), model }; console.log('scan upstream', JSON.stringify(last));
        if (r.status === 401 || r.status === 403 || (r.status === 400 && /credit|billing/i.test(last.msg))) break; // key or billing problem: other models will fail the same way
        continue; }
      const t = (j.content || []).map((x) => x.text || '').join('');
      const o = parse(t); return send(200, Object.assign(o || {}, { _model: model }));
    } catch (e) { last = { status: 0, msg: String(e && e.message).slice(0, 200), model }; console.log('scan fail', last.msg); }
  }
  const code = last && last.status === 429 ? 429 : last && (last.status === 401 || last.status === 403) ? 401 : last && /credit|billing/i.test(last.msg || '') ? 402 : 502;
  send(code, { error: code === 401 ? 'key' : code === 402 ? 'billing' : code === 429 ? 'rate' : 'upstream', detail: last });
};
module.exports.config = { api: { bodyParser: false } };
