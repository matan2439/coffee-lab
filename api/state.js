const crypto = require('crypto');
const DB = process.env.coffee_lab_db_url || process.env.DATABASE_URL;
const sql = async (query, params) => {
  const host = new URL(DB).host;
  const r = await fetch('https://' + host + '/sql', { method: 'POST', headers: { 'content-type': 'application/json', 'Neon-Connection-String': DB }, body: JSON.stringify({ query, params }) });
  if (!r.ok) throw new Error('db ' + r.status);
  return (await r.json()).rows || [];
};
module.exports = async (req, res) => {
  const send = (c, o) => { res.statusCode = c; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(o)); };
  if (!DB) return send(503, { error: 'no db' });
  const code = String(req.headers['x-sync'] || ''); if (code.length < 8 || code.length > 80) return send(400, { error: 'code' });
  const id = crypto.createHash('sha256').update('cl1:' + code).digest('hex');
  try {
    if (req.method === 'GET') {
      const rows = await sql('select data, updated_at from coffee_lab_state where id = $1', [id]);
      return send(200, rows.length ? { updatedAt: rows[0].updated_at, data: rows[0].data } : { empty: true });
    }
    if (req.method === 'PUT') {
      const parts = []; let n = 0; for await (const d of req) { n += d.length; if (n > 4e6) return send(413, { error: 'big' }); parts.push(d); }
      const b = JSON.parse(Buffer.concat(parts).toString('utf8'));
      if (typeof b.data !== 'string' || typeof b.updatedAt !== 'string') return send(400, { error: 'bad' });
      await sql('insert into coffee_lab_state (id, data, updated_at) values ($1, $2, $3) on conflict (id) do update set data = excluded.data, updated_at = excluded.updated_at, saved_at = now()', [id, b.data, b.updatedAt]);
      return send(200, { ok: true });
    }
    send(405, { error: 'method' });
  } catch (e) { send(502, { error: 'fail' }); }
};
module.exports.config = { api: { bodyParser: false } };
