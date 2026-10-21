const net = require('net');
module.exports = async (req, res) => {
  const fail = (c) => { res.statusCode = c; res.end(); };
  let u; try { u = new URL(new URL(req.url, 'http://x').searchParams.get('u') || ''); } catch (e) { return fail(400); }
  const h = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || net.isIP(h) || h === 'localhost' || !h.includes('.') || /\.(local|internal|localhost)$/.test(h)) return fail(400);
  const c = new AbortController(); const t = setTimeout(() => c.abort(), 8000);
  try {
    const r = await fetch(u.href, { signal: c.signal, redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (compatible; CoffeeLabBot/1.0)', accept: 'image/*' } });
    const ct = r.headers.get('content-type') || '';
    if (!r.ok || !/^image\/(jpe?g|png|webp|gif|avif)/i.test(ct)) return fail(404);
    const b = Buffer.from(await r.arrayBuffer()); if (b.length > 4000000) return fail(413);
    res.statusCode = 200; res.setHeader('content-type', ct.split(';')[0]); res.setHeader('cache-control', 'public, s-maxage=86400, max-age=86400'); res.end(b);
  } catch (e) { fail(502); } finally { clearTimeout(t); }
};
