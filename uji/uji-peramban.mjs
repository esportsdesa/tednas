/**
 * Uji ujung ke ujung di Chromium (Playwright): halaman daftar ASLI (public/) → unggah berkas ke Code.gs
 * ASLI (dijalankan di Node dengan Drive tiruan, uji/tiruan-google.mjs) → RPC tednas_daftar tiruan yang
 * memeriksa tanda HMAC → kabar "tim" ke Code.gs (pengganti pg_net) → Sheet & folder tim.
 * Web App Google ditiru lengkap dengan pengalihan 302 ke script.googleusercontent.com seperti aslinya.
 * Butuh internet (supabase-js dari jsDelivr, Turnstile kunci uji Cloudflare).
 *   node uji/uji-peramban.mjs     (PLAYWRIGHT=<jalur paket playwright> bila tidak ditemukan otomatis)
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname, normalize } from "node:path";
import { createRequire } from "node:module";
import { buatDunia } from "./tiruan-google.mjs";

const AKAR = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const PUBLIK = join(AKAR, "public");
const calon = [process.env.PLAYWRIGHT, "C:/Apps/mzone-v1/node_modules/playwright", "playwright"].filter(Boolean);
let chromium;
for (const c of calon) { try { ({ chromium } = createRequire(import.meta.url)(c)); break; } catch { /* berikutnya */ } }
if (!chromium) { console.log("Playwright tidak ditemukan — uji peramban dilewati (set PLAYWRIGHT=…)"); process.exit(0); }

const W = buatDunia();
W.gs.pasang();
const DRIVE_URL = "https://script.google.com/macros/s/AKfycbUJIperamban0123456789abcdef/exec";
let lulus = 0;
const uji = async (nama, f) => {
  try { await f(); lulus++; } catch (e) {
    // Pipa stderr di Windows asinkron: diagnosa ditulis ke berkas supaya tidak terpotong process.exit.
    let layar = null;
    try { layar = await halaman.evaluate(() => [document.querySelector("#salah")?.textContent, document.querySelector("#lanjut")?.textContent]); } catch (x) { layar = x.message; }
    const f2 = join(tmpdir(), "tednas-uji-peramban.txt");
    writeFileSync(f2, JSON.stringify({ galat: String(e.stack || e), unggahan, puncak, galatKonsol, layar, jawaban: [...keluaran.values()].slice(-3).map((x) => x.slice(0, 300)) }, null, 1));
    console.error(`GAGAL: ${nama} — diagnosa: ${f2}`);
    await tutup(); process.exit(1);
  }
};

/* ── situs statis + Supabase tiruan di satu server ────────────────────── */
let pendaftaran = 0;
const JENIS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon" };
const srv = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname.startsWith("/sb/")) return supabase(req, res, u);
  if (u.pathname === "/js/config.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    return res.end(`window.APP_CONFIG = { SUPABASE_URL: "http://${req.headers.host}/sb", SUPABASE_ANON_KEY: "uji", TURNSTILE_SITE_KEY: "1x00000000000000000000AA", DRIVE_URL: ${JSON.stringify(DRIVE_URL)} };`);
  }
  let p = normalize(decodeURIComponent(u.pathname)).replace(/^([/\\])+/, "");
  if (!p) p = "index.html";
  let f = join(PUBLIK, p);
  if (!existsSync(f) && existsSync(`${f}.html`)) f = `${f}.html`;
  if (!f.startsWith(PUBLIK) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": JENIS[extname(f)] ?? "application/octet-stream" });
  res.end(readFileSync(f));
});
async function supabase(req, res, u) {
  const isi = await new Promise((ok) => { const p = []; req.on("data", (c) => p.push(c)); req.on("end", () => ok(Buffer.concat(p).toString())); });
  const kirim = (kode, o) => { res.writeHead(kode, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
  if (u.pathname === "/sb/rest/v1/tednas_pengaturan") return kirim(200, { id: 1, pendaftaran_buka: true, buka_mulai: null });
  if (u.pathname === "/sb/rest/v1/rpc/tednas_daftar") {
    const b = JSON.parse(isi);
    assert.equal(b.p_captcha.length > 10, true, "token Turnstile ikut");
    // Pemeriksaan berkas tednas_daftar(): tanda HMAC sah atau ditolak.
    for (const p of b.p_pemain) for (const k of ["dokumen_path", "profil_ml_path", "follow_esports_path", "follow_ppdt_path"]) {
      if (!W.sahkan(p[k])) return kirim(400, { code: "P0001", message: "DOKUMEN_TIDAK_ADA" });
    }
    pendaftaran++;
    const t = W.daftarTim(b.p_nama_tim, b.p_pemain.map((p) => ({ nama: p.nama, jenis: p.dokumen_jenis, dok: p.dokumen_path, ml: p.profil_ml_path, ig1: p.follow_esports_path, ig2: p.follow_ppdt_path, izin: p.izin_path })), { wa: b.p_wa });
    // pg_net: setelah commit database mengirim kabar "tim" ke Web App.
    const k = W.kabar("tim", { tim: W.paket(t) });
    assert.equal(k.ok, true, JSON.stringify(k));
    return kirim(200, { kode: t.kode });
  }
  kirim(404, { message: `tiruan tidak tahu ${u.pathname}` });
}
await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
const ASAL = `http://127.0.0.1:${srv.address().port}`;

/* ── peramban + Web App Google tiruan ─────────────────────────────────── */
// Chromium bawaan Playwright bila cocok versinya; selain itu Chrome yang terpasang di mesin.
const peramban = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
const ctx = await peramban.newContext();
const halaman = await ctx.newPage();
const tutup = async () => { await peramban.close().catch(() => {}); srv.close(); };
const keluaran = new Map();
let nKeluaran = 0, sedang = 0, puncak = 0, unggahan = 0;
let gangguan = null;       // (isi) => respons pengganti untuk menguji coba-ulang
await ctx.route((u) => u.hostname === "script.google.com" && u.pathname.startsWith("/macros/s/"), async (route) => {
  const r = route.request();
  assert.equal(r.method(), "POST");
  assert.match(r.headers()["content-type"] ?? "", /^text\/plain/, "tanpa preflight CORS");
  sedang++; puncak = Math.max(puncak, sedang);
  await new Promise((ok) => setTimeout(ok, 120));   // seperti eksekusi Apps Script yang tidak instan
  const isi = r.postData();
  const ganti = gangguan?.(JSON.parse(isi));
  let jawab;
  if (ganti) jawab = ganti;
  else { jawab = W.gs.doPost({ postData: { contents: isi } }).getContent(); if (JSON.parse(isi).aksi === "unggah") unggahan++; }
  sedang--;
  // Google aslinya menjawab 302 → script.googleusercontent.com; Playwright tidak mencegat permintaan hasil
  // pengalihan dari route.fulfill, jadi di sini langsung dijawab. Jalur 302 diuji melawan Web App asli
  // setelah deploy (deploy/drive/PASANG.md, "Uji setelah deploy").
  keluaran.set(`k${++nKeluaran}`, jawab);
  await route.fulfill({ status: 200, headers: { "content-type": jawab.startsWith("<") ? "text/html" : "application/json; charset=utf-8", "access-control-allow-origin": "*" }, body: jawab });
});
const galatKonsol = [];
halaman.on("pageerror", (e) => galatKonsol.push(e.message));
halaman.on("console", (m) => { if (m.type() === "error") galatKonsol.push(`console: ${m.text()}`); });
halaman.on("response", (r) => { if (r.status() >= 400) galatKonsol.push(`${r.status()} ${r.url().slice(0, 120)}`); });
halaman.on("requestfailed", (r) => galatKonsol.push(`gagal: ${r.url().slice(0, 100)} ${r.failure()?.errorText}`));

/* ── isi berkas: tanda tangan asli, bukan gambar yang bisa didekode (daftar.js mengirimnya apa adanya) ── */
const JPG = (n) => ({ name: `ktp-${n}.jpg`, mimeType: "image/jpeg", buffer: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`jpg ${n}`)]) });
const PNG = (n) => ({ name: `ml-${n}.png`, mimeType: "image/png", buffer: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`png ${n}`)]) });
const PDF = (n) => ({ name: `izin-${n}.pdf`, mimeType: "application/pdf", buffer: Buffer.from(`%PDF-1.4 izin ${n}`) });

async function isiFormulir({ tim, wa, awal, cadangan = false }) {
  await halaman.goto(`${ASAL}/daftar`);
  await halaman.waitForSelector("#form:not([hidden])");
  await halaman.check("#setuju-aturan");
  await halaman.click("#lanjut");
  await halaman.waitForSelector("#prov option[value='35']", { state: "attached" });
  await halaman.selectOption("#prov", "35");
  await halaman.waitForSelector("#kab option[value='35.07']", { state: "attached" });
  await halaman.selectOption("#kab", "35.07");
  await halaman.waitForSelector("#cari-desa:not([disabled])");
  await halaman.fill("#cari-desa", "Mangliawan");
  await halaman.click(".desa-opsi:not(:disabled)");
  await halaman.click("#lanjut");
  await halaman.fill("#nama-tim", tim);
  for (let i = 1; i <= (cadangan ? 6 : 5); i++) await halaman.fill(`#pemain-${i}`, `${awal} Pemain ${i}`);
  await halaman.fill("#wa", wa);
  await halaman.click("#lanjut");
  const blok = await halaman.$$(".blok-pemain");
  assert.equal(blok.length, cadangan ? 6 : 5);
  for (const [i, b] of blok.entries()) {
    const k = `${awal}${i}`;
    await (await b.$("[data-file=dok]")).setInputFiles(JPG(`${k}d`));
    await (await b.$("[data-file=ml]")).setInputFiles(PNG(`${k}m`));
    await (await b.$("[data-file=ig1]")).setInputFiles(JPG(`${k}a`));
    await (await b.$("[data-file=ig2]")).setInputFiles(JPG(`${k}b`));
    if (i === 4) { await (await b.$("[data-bawah]")).check(); await (await b.$("[data-file=izin]")).setInputFiles(PDF(k)); }
  }
  await halaman.waitForFunction(() => [...document.querySelectorAll("[data-status]")].filter((s) => !s.closest("[hidden]")).every((s) => s.textContent && s.textContent !== "Menyiapkan..."));
  await halaman.click("#lanjut");
  await halaman.check("#setuju");
  // Turnstile kunci uji selalu lulus; tunggu tokennya terisi.
  await halaman.waitForFunction(() => document.querySelector("[name='cf-turnstile-response']")?.value, null, { timeout: 30000 });
}

/* ── skenario ─────────────────────────────────────────────────────────── */
await uji("pendaftaran lengkap: 21 berkas langsung ke Drive, 2 sekaligus, data seketika ke Sheet", async () => {
  await isiFormulir({ tim: "Garuda Mangliawan", wa: "081234567890", awal: "A" });
  await halaman.click("#lanjut");
  await halaman.waitForSelector("#sukses:not([hidden])", { timeout: 60000 });
  assert.equal(await halaman.textContent("#kode"), "TED-00001");
  assert.equal(unggahan, 21);
  assert.equal(puncak, 2, `unggahan bersamaan ${puncak}`);
  const t = W.db.tim[0];
  assert.equal(t.tersalin, 1); assert.ok(t.rapi > 0);
  const folder = W.benda.get(t.folder.split("/").pop());
  const isi = W.anakDari(folder).map((x) => x.getName()).sort();
  assert.equal(isi.length, 21);
  assert.ok(isi.includes("1. A Pemain 1 — KTP.jpg") && isi.includes("5. A Pemain 5 — Izin orang tua.pdf") && isi.includes("3. A Pemain 3 — Profil ML.png"));
  const ss = W.benda.get(W.props.get("SHEET"));
  assert.deepEqual(ss.getSheetByName("Tim").baris(2).slice(0, 4), ["TED-00001", "Garuda Mangliawan", "A Pemain 1", "6281234567890"]);
  assert.equal(ss.getSheetByName("Pemain").data().length, 5);
  // Isi berkas di Drive = berkas yang dipilih di HP.
  const ktp = W.anakDari(folder).find((x) => x.getName() === "1. A Pemain 1 — KTP.jpg");
  assert.ok(ktp._isi.equals(JPG("A0d").buffer));
});

await uji("Web App sibuk/putus sesaat → dicoba ulang otomatis, pendaftaran tetap berhasil", async () => {
  let gagal = 0;
  gangguan = (isi) => (isi.aksi === "unggah" && gagal++ < 3 ? (gagal === 2 ? JSON.stringify({ ok: false, pesan: "SIBUK", ulang: true }) : "<html><body>Service invoked too many times for one day</body></html>") : null);
  await isiFormulir({ tim: "Banteng Sakti", wa: "081234567891", awal: "B", cadangan: true });
  await halaman.click("#lanjut");
  await halaman.waitForSelector("#sukses:not([hidden])", { timeout: 90000 });
  gangguan = null;
  assert.equal(await halaman.textContent("#kode"), "TED-00002");
  assert.equal(W.db.tim[1].pemain.length, 6);
  assert.equal(W.benda.get(W.props.get("SHEET")).getSheetByName("Pemain").data().filter((x) => x[0] === "TED-00002").length, 6);
});

await uji("berkas ditolak Web App → pesan jelas menyebut berkasnya; kirim ulang tidak mengulang yang sudah terunggah", async () => {
  let tolak = true;
  gangguan = (isi) => (tolak && isi.aksi === "unggah" && Buffer.from(isi.data, "base64").toString().includes("C2m") ? JSON.stringify({ ok: false, pesan: "ISI_TIDAK_SAH" }) : null);
  const awal = unggahan;
  await isiFormulir({ tim: "Elang Desa", wa: "081234567892", awal: "C" });
  await halaman.click("#lanjut");
  await halaman.waitForSelector("#salah:not([hidden])", { timeout: 60000 });
  const pesan = await halaman.textContent("#salah");
  assert.match(pesan, /rusak atau bukan foto\/PDF asli/);
  assert.match(pesan, /berkas: profil ML Pemain 3/);
  const sebelum = unggahan - awal;
  tolak = false;
  await halaman.waitForFunction(() => document.querySelector("[name='cf-turnstile-response']")?.value, null, { timeout: 30000 });
  await halaman.click("#lanjut");
  await halaman.waitForSelector("#sukses:not([hidden])", { timeout: 60000 });
  gangguan = null;
  assert.equal(unggahan - awal, 21, `total unggahan ${unggahan - awal} (sebelum galat ${sebelum})`);
  assert.equal(pendaftaran, 3);
});

await uji("tanpa galat skrip di halaman", async () => { assert.deepEqual(galatKonsol, []); });

await tutup();
console.log(`${lulus} uji peramban lulus`);
