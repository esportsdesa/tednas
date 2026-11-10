// Kueri ringan harian (lewat cron Vercel) supaya proyek Supabase gratis tidak dijeda
// karena 7 hari tanpa aktivitas. Kunci publik ini sama dengan yang ada di public/js/config.js.
const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {
  const cfg = fs.readFileSync(path.join(process.cwd(), 'public/js/config.js'), 'utf8');
  const url = (cfg.match(/SUPABASE_URL:\s*'([^']+)'/) || [])[1];
  const key = (cfg.match(/SUPABASE_ANON_KEY:\s*'([^']+)'/) || [])[1];
  if (!url || !key || url.startsWith('GANTI')) return res.status(200).json({ ok: true, lewati: 'belum dikonfigurasi' });
  const r = await fetch(`${url}/rest/v1/tednas_pengaturan?select=id&limit=1`, { headers: { apikey: key } });
  res.status(r.ok ? 200 : 502).json({ ok: r.ok, status: r.status });
};
