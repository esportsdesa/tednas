/**
 * Uji halaman admin ASLI (public/admin.html) di Chromium: kolom & rincian "Cek AI", ringkasan status otomatis,
 * tanda "· AI", ganda yang daftar belakangan, saringan, periksa ulang, admin tetap bisa membatalkan status, dan
 * halaman tetap jalan bila tabel tednas_ai belum ada (migrasi 10
 * belum dijalankan). Supabase (auth + PostgREST) ditiru server lokal. Butuh internet (supabase-js dari jsDelivr).
 *   node uji/uji-admin-ai.mjs     (PLAYWRIGHT=<jalur paket playwright> bila tidak ditemukan otomatis)
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";

const AKAR = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const PUBLIK = join(AKAR, "public");
const calon = [process.env.PLAYWRIGHT, "C:/Apps/mzone-v1/node_modules/playwright", "playwright"].filter(Boolean);
let chromium;
for (const c of calon) { try { ({ chromium } = createRequire(import.meta.url)(c)); break; } catch { /* berikutnya */ } }
if (!chromium) { console.log("Playwright tidak ditemukan — uji admin dilewati (set PLAYWRIGHT=…)"); process.exit(0); }

const ADMIN = "00000000-0000-0000-0000-00000000a001";
const pemain = (kode, n = 5) => Array.from({ length: n }, (_, i) => ({ id: `${kode}-p${i + 1}`, urutan: i + 1, nama: `Pemain ${kode.slice(-1)}${i + 1}`, dokumen_jenis: "KTP",
  dokumen_path: `gdrive/${kode}d${i}xxxxxxx.jpg`, profil_ml_path: `gdrive/${kode}m${i}xxxxxxx.png`, follow_esports_path: `gdrive/${kode}e${i}xxxxxxx.jpg`, follow_ppdt_path: `gdrive/${kode}p${i}xxxxxxx.jpg`, izin_path: null }));
const tim = (n, ai, status = "menunggu", status_oleh = null) => ({ id: `00000000-0000-0000-0000-00000000000${n}`, kode: `TED-0000${n}`, nama_tim: `Tim Desa ${n}`, nama_kapten: `Kapten ${n}`, wa_kapten: `62812345678${n}`,
  prov_kode: "35", provinsi: "JAWA TIMUR", kab_kode: "35.07", kabupaten: "Kabupaten Malang", kecamatan: "Pakis", desa_kode: `35.07.18.200${n}`, desa: `Desa ${n}`,
  status, status_oleh, created_at: `2026-11-1${n}T03:00:00Z`, pemain: pemain(`T${n}`), ai });
const ok = (t) => ({ b: "identitas", s: "ok", t });
const AI_LOLOS = { tim_id: "x", akhir: "lolos", hasil: "lolos", ringkas: "Semua sesuai (21 pemeriksaan).", model: "Qwen3.6-35B-A3B (pool GPU) · agen v2", pada: "2026-11-16T02:00:00Z", ganda: [],
  rincian: { tim: [], pemain: [1, 2, 3, 4, 5].map((u) => ({ u, nama: `Pemain 1${u}`, butir: [ok("KTP sesuai, umur 20."), ok("x"), ok("y"), ok("z")], data: { dok: "KTP", nik: "3507********000" + u, lahir: "2006-05-05", umur: 20, alamat: "MANGLIAWAN, PAKIS, KABUPATEN MALANG", ml: "48291375" + u + " (12045)" } })) } };
const AI_CEK = { ...AI_LOLOS, akhir: "cek", hasil: "lolos", ringkas: "1 catatan",
  ganda: [{ u: 2, jenis: "nik", kode: "TED-00001", u_lain: 1, dulu: true }, { u: 4, jenis: "ml", kode: "TED-00003", u_lain: 2, dulu: false }],
  rincian: { tim: [],
    pemain: [1, 2, 3, 4, 5].map((u) => ({ u, nama: `Pemain 2${u}`, butir: u === 3 ? [ok("KTP sesuai, umur 19."), { b: "follow_ppdt", s: "cek", t: "Bukti follow menunjukkan @ditjen_ppdt BELUM diikuti (tombol \"Ikuti\")." }, { b: "identitas", s: "info", t: "Domisili di Kota Malang, tim di Kabupaten Malang (masih satu provinsi)." }] : [ok("a"), ok("b")], data: { dok: "KTP", nik: "3507********0003", lahir: "2007-01-01", umur: 20, alamat: "SUMBERPASIR, PAKIS, KABUPATEN MALANG" } })) } };

let dunia = "ai"; // "ai" | "tanpa-ai"
const catat = { tim: [], ubah: [], hapus: [] };
const DATA = () => [tim(3, null), tim(2, AI_CEK), tim(1, AI_LOLOS, "terverifikasi", "ai")];

const JENIS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".pdf": "application/pdf" };
const srv = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const isi = await new Promise((ok) => { const p = []; req.on("data", (c) => p.push(c)); req.on("end", () => ok(Buffer.concat(p).toString())); });
  const kirim = (kode, o, kepala = {}) => { res.writeHead(kode, { "content-type": "application/json", "access-control-allow-origin": "*", ...kepala }); res.end(o === undefined ? "" : JSON.stringify(o)); };
  if (req.method === "OPTIONS") { res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*", "access-control-expose-headers": "content-range" }); return res.end(); }
  if (u.pathname === "/js/config.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    return res.end(`window.APP_CONFIG = { SUPABASE_URL: "http://${req.headers.host}/sb", SUPABASE_ANON_KEY: "uji", TURNSTILE_SITE_KEY: "x", DRIVE_URL: "https://script.google.com/macros/s/AKfycbADMINuji0123456789abcdefgh/exec" };`);
  }
  if (u.pathname.startsWith("/sb/")) {
    const p = u.pathname.slice(3), q = decodeURIComponent(u.search);
    if (p === "/auth/v1/token") {
      const kepalaJwt = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url"), muat = Buffer.from(JSON.stringify({ sub: ADMIN, exp: Math.floor(Date.now() / 1000) + 3600, role: "authenticated" })).toString("base64url");
      return kirim(200, { access_token: `${kepalaJwt}.${muat}.tanda`, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "r", user: { id: ADMIN, email: "admin@tednas.id", aud: "authenticated", role: "authenticated" } });
    }
    if (p === "/rest/v1/tednas_admin") return kirim(200, [{ user_id: ADMIN }]);
    if (p === "/rest/v1/rpc/tednas_statistik") return kirim(200, { total: 3, terverifikasi: 0, kabupaten: 1, provinsi: 1, per_provinsi: [] });
    if (p === "/rest/v1/rpc/tednas_ai_statistik") return kirim(200, { otomatis: 1, cek: 1, galat: 0, antre: 1 });
    if (p === "/rest/v1/tednas_tim" && req.method === "PATCH") { catat.ubah.push({ q, isi: JSON.parse(isi) }); return kirim(204); }
    if (p === "/rest/v1/tednas_ai" && req.method === "DELETE") { catat.hapus.push(q); return kirim(204); }
    if (p === "/rest/v1/tednas_tim") {
      catat.tim.push(q);
      if (q.includes("tednas_ai")) {
        if (dunia === "tanpa-ai") return kirim(400, { code: "PGRST200", message: "Could not find a relationship between 'tednas_tim' and 'tednas_ai' in the schema cache" });
        let d = DATA();
        if (q.includes("ai.akhir=eq.lolos")) d = d.filter((t) => t.ai && t.ai.akhir === "lolos");
        return kirim(200, d, { "content-range": `0-${d.length - 1}/${d.length}` });
      }
      const d = DATA().map(({ ai, ...t }) => t);
      return kirim(200, d, { "content-range": `0-${d.length - 1}/${d.length}` });
    }
    return kirim(404, { message: `tiruan tidak tahu ${p}` });
  }
  let f = normalize(decodeURIComponent(u.pathname)).replace(/^([/\\])+/, "");
  f = join(PUBLIK, f || "index.html");
  if (!f.startsWith(PUBLIK) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": JENIS[extname(f)] || "application/octet-stream" });
  res.end(readFileSync(f));
});
await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
const ASAL = `http://127.0.0.1:${srv.address().port}`;

const peramban = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
let lulus = 0, halaman, galatKonsol = [];
const tutup = async () => { await peramban.close().catch(() => {}); srv.close(); };
const uji = async (nama, f) => {
  try { await f(); lulus++; } catch (e) {
    const g = join(tmpdir(), "tednas-uji-admin.png"); await halaman?.screenshot({ path: g, fullPage: true }).catch(() => {});
    console.error(`GAGAL: ${nama} (tangkapan layar: ${g})\n`, e); await tutup(); process.exit(1);
  }
};
async function buka() {
  const ctx = await peramban.newContext({ viewport: { width: 1280, height: 900 } });
  halaman = await ctx.newPage();
  halaman.on("pageerror", (e) => galatKonsol.push(e.message));
  halaman.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) galatKonsol.push(m.text()); });
  await halaman.goto(`${ASAL}/admin.html`);
  await halaman.fill("#u", "admin"); await halaman.fill("#p", "rahasia");
  await halaman.click("#masuk button");
  await halaman.waitForSelector("#panel:not([hidden])");
  await halaman.waitForFunction(() => document.querySelectorAll("#t-baris tr").length === 3 && !document.querySelector("#t-baris").textContent.includes("Memuat"));
}

await uji("kolom Cek AI + ringkasan status otomatis + tanda '· AI', tanpa tombol verifikasi sekaligus", async () => {
  await buka();
  await halaman.waitForSelector("#t-ai-bar:not([hidden])");
  assert.equal(await halaman.isVisible("#t-kol-ai"), true);
  const sel = await halaman.$$eval("#t-baris tr", (r) => r.map((x) => x.children[6].textContent.trim()));
  assert.deepEqual(sel, ["Antre", "Perlu dicek · 2", "✓ Lolos AI"], "ganda yang daftar belakangan tidak dihitung");
  const status = await halaman.$$eval("#t-baris tr", (r) => r.map((x) => x.children[5].textContent.trim()));
  assert.deepEqual(status, ["Menunggu", "Menunggu", "Terverifikasi · AI"]);
  assert.match(await halaman.textContent("#t-ai-teks"), /1 tim diverifikasi otomatis, 1 menunggu dicek admin · 1 tim dalam antrean agen\..*tidak pernah ditimpa AI/);
  assert.equal(await halaman.$$eval("#t-ai-verif, #d-ai-verif", (x) => x.length), 0);
  assert.equal(await halaman.isVisible("#t-ai"), true);
});

await uji("rincian AI per pemain: catatan cek, info, ganda NIK, data tersamar", async () => {
  await halaman.click("button.lencana-ai.ai-cek");
  await halaman.waitForSelector("#d-pemain[open]");
  const kotak = await halaman.textContent("#d-pemain-ai");
  assert.match(kotak, /Perlu dicek: 2 catatan AI/);
  assert.match(kotak, /otomatis Terverifikasi; catatan "perlu dicek" diputuskan admin/);
  const isi = await halaman.textContent("#d-pemain-isi");
  assert.match(isi, /NIK sama dengan TED-00001 pemain 1, yang mendaftar lebih dulu\. 1 orang hanya boleh di 1 tim\./);
  assert.match(isi, /ID Mobile Legends sama dengan TED-00003 pemain 2, yang mendaftar belakangan \(tim itu yang ditandai\)/);
  assert.equal(await halaman.$$eval("#d-pemain-isi li.ai-info", (l) => l.filter((x) => /mendaftar belakangan/.test(x.textContent)).length), 1, "ganda belakangan = info");
  assert.match(isi, /@ditjen_ppdt BELUM diikuti/);
  assert.match(isi, /masih satu provinsi/);
  assert.match(isi, /NIK 3507\*\*\*\*\*\*\*\*0003/);
  assert.match(isi, /2 pemeriksaan sesuai/);
  assert.equal(await halaman.isVisible("#d-pemain-ulang"), true);
  await halaman.screenshot({ path: join(tmpdir(), "tednas-admin-ai-dialog.png") });
});

await uji("periksa ulang = hapus hasil AI tim itu", async () => {
  await halaman.click("#d-pemain-ulang");
  await halaman.waitForFunction(() => !document.querySelector("#d-pemain").open);
  assert.equal(catat.hapus.length, 1);
  assert.match(catat.hapus[0], /tim_id=eq\.00000000-0000-0000-0000-000000000002/);
});

await uji("admin tetap bisa membatalkan status yang diubah AI", async () => {
  await halaman.click("[data-ver='00000000-0000-0000-0000-000000000001']");
  await halaman.waitForFunction(() => true);
  for (let i = 0; i < 50 && !catat.ubah.length; i++) await new Promise((ok) => setTimeout(ok, 50));
  assert.equal(catat.ubah.length, 1);
  assert.match(catat.ubah[0].q, /id=eq\.00000000-0000-0000-0000-000000000001/);
  assert.deepEqual(catat.ubah[0].isi, { status: "menunggu" });
});

await uji("saringan Lolos AI memakai join inner + akhir=lolos", async () => {
  await halaman.selectOption("#t-ai", "lolos");
  await halaman.waitForFunction(() => document.querySelectorAll("#t-baris tr").length === 1);
  assert.ok(catat.tim.some((q) => q.includes("ai:tednas_ai!inner(*)") && q.includes("ai.akhir=eq.lolos")), catat.tim.slice(-2).join("\n"));
});

await uji("tabel tednas_ai belum ada (migrasi 10 belum jalan): halaman tetap jalan tanpa kolom AI", async () => {
  dunia = "tanpa-ai";
  await halaman.context().close();
  await buka();
  assert.equal(await halaman.isVisible("#t-kol-ai"), false);
  assert.equal(await halaman.isVisible("#t-ai-bar"), false);
  assert.equal(await halaman.isVisible("#t-ai"), false);
  assert.equal(await halaman.$$eval("#t-baris tr:first-child td", (t) => t.length), 7);
  await halaman.click("[data-pemain]");
  await halaman.waitForSelector("#d-pemain[open]");
  assert.equal((await halaman.textContent("#d-pemain-ai")).trim(), "");
  assert.equal(await halaman.isVisible("#d-pemain-ulang"), false);
});

await uji("tanpa galat skrip di halaman", async () => { assert.deepEqual(galatKonsol, []); });
await tutup();
console.log(`${lulus} uji halaman admin (Cek AI) lulus`);
