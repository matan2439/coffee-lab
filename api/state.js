const crypto = require('crypto');
const DB = process.env.coffee_lab_db_url || process.env.DATABASE_URL;
const sql = async (query, params) => {
  const host = new URL(DB).host;
  const r = await fetch('https://' + host + '/sql', { method: 'POST', headers: { 'content-type': 'application/json', 'Neon-Connection-String': DB }, body: JSON.stringify({ query, params }) });
  if (!r.ok) throw new Error('db ' + r.status);
  return (await r.json()).rows || [];
};
// a personal code maps to one row; extra codes (e.g. for a new phone) can point at the same row
async function resolve(id) { try { const r = await sql('select target from coffee_lab_alias where alias = $1', [id]); return r.length ? r[0].target : id; } catch (e) { return id; } }
module.exports = async (req, res) => {
  const send = (c, o) => { res.statusCode = c; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(o)); };
  if (!DB) return send(503, { error: 'no db' });
  const code = String(req.headers['x-sync'] || ''); if (code.length < 8 || code.length > 80) return send(400, { error: 'code' });
  const id = await resolve(crypto.createHash('sha256').update('cl1:' + code).digest('hex'));
  const owner = crypto.createHash('sha256').update('own:' + id).digest('hex').slice(0, 32); // shared by every device of this person (for timer notifications)
  try {
    if (req.method === 'GET') {
      const since = String(req.headers['x-since'] || '');
      if (since) { const m = await sql('select updated_at from coffee_lab_state where id = $1', [id]); if (!m.length) return send(200, { empty: true, owner }); if (m[0].updated_at === since) return send(200, { same: true, updatedAt: since, owner }); }
      const rows = await sql('select data, updated_at from coffee_lab_state where id = $1', [id]);
      return send(200, rows.length ? { updatedAt: rows[0].updated_at, data: rows[0].data, owner } : { empty: true, owner });
    }
    if (req.method === 'PUT') {
      const parts = []; let n = 0; for await (const d of req) { n += d.length; if (n > 4e6) return send(413, { error: 'big' }); parts.push(d); }
      const b = JSON.parse(Buffer.concat(parts).toString('utf8'));
      if (typeof b.data !== 'string' || typeof b.updatedAt !== 'string') return send(400, { error: 'bad' });
      if (typeof b.base === 'string') {
        // optimistic check: someone else (another phone) saved since this device last synced -> let the client merge
        const cur = await sql('select data, updated_at from coffee_lab_state where id = $1', [id]);
        if (cur.length && cur[0].updated_at !== b.base && cur[0].updated_at !== b.updatedAt) return send(409, { conflict: true, updatedAt: cur[0].updated_at, data: cur[0].data });
      }
      // hourly safety snapshot of the previous version
      try { await sql("insert into coffee_lab_state_hist (id, data, updated_at) select id, data, updated_at from coffee_lab_state s where s.id = $1 and not exists (select 1 from coffee_lab_state_hist h where h.id = $1 and h.saved_at > now() - interval '1 hour')", [id]); if (Math.random() < 0.05) await sql("delete from coffee_lab_state_hist where saved_at < now() - interval '21 days'", []); } catch (e) { /* optional */ }
      await sql('insert into coffee_lab_state (id, data, updated_at) values ($1, $2, $3) on conflict (id) do update set data = excluded.data, updated_at = excluded.updated_at, saved_at = now()', [id, b.data, b.updatedAt]);
      return send(200, { ok: true, updatedAt: b.updatedAt, owner });
    }
    send(405, { error: 'method' });
  } catch (e) { send(502, { error: 'fail' }); }
};
module.exports.config = { api: { bodyParser: false } };
