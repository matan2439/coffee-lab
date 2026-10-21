// Zero-dependency static server for Railway. HTTPS is terminated by Railway, so camera access works.
const http = require('http'), fs = require('fs'), path = require('path'), zlib = require('zlib');
const ROOT = __dirname, PORT = process.env.PORT || 3000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const PROMPT = fs.readFileSync(path.join(__dirname, 'scan-prompt.txt'), 'utf8');
const KEY = process.env.ANTHROPIC_API_KEY, MODEL = process.env.SCAN_MODEL || 'claude-sonnet-5-5', API = process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com/v1/messages';
const hits = []; // simple rate limit: 20 scans / minute
function scan(req, res) {
  const json = (c, o) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (req.method === 'GET') return json(200, { ok: !!KEY });
  if (!KEY) return json(503, { error: 'ANTHROPIC_API_KEY not set' });
  const now = Date.now(); while (hits.length && now - hits[0] > 60000) hits.shift(); if (hits.length >= 20) return json(429, { error: 'rate' }); hits.push(now);
  const parts = []; let n = 0;
  req.on('data', (d) => { n += d.length; if (n > 8e6) { req.destroy(); } else parts.push(d); });
  req.on('end', async () => {
    try {
      const body = { model: MODEL, max_tokens: 1000, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: Buffer.concat(parts).toString('base64') } }, { type: 'text', text: PROMPT }] }] };
      const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) });
      const j = await r.json(); if (!r.ok) return json(r.status === 429 ? 429 : 502, { error: 'upstream' });
      const t = (j.content || []).map((x) => x.text || '').join(''); const m = t.match(/\{[\s\S]*\}/);
      json(200, m ? JSON.parse(m[0]) : {});
    } catch (e) { json(502, { error: 'fail' }); }
  });
}
http.createServer((req, res) => {
  if (req.url.split('?')[0] === '/api/scan') return scan(req, res);
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const f = path.normalize(path.join(ROOT, p));
  if (!f.startsWith(ROOT) || /^\/(server\.js|package\.json|scan-prompt\.txt|README\.md)$/.test(p)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, buf) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
    const ext = path.extname(f), h = { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': ext === '.html' || p === '/sw.js' ? 'no-cache' : 'public, max-age=86400', 'permissions-policy': 'camera=(self)' };
    if (/\b(html|js|css|svg|webmanifest|json)\b/.test(ext.slice(1)) && /gzip/.test(req.headers['accept-encoding'] || '')) { buf = zlib.gzipSync(buf); h['content-encoding'] = 'gzip'; }
    res.writeHead(200, h); res.end(buf);
  });
}).listen(PORT, () => console.log('coffee-lab on ' + PORT));
