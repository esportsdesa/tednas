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
let pendaftaran = 0, daftarTerakhir = null;
let formVersi = 1; // migrasi 16: tim form v2 wajib WA pemain + twibbon
const TOKEN = "cd".repeat(20), perbaikan = [];
// tednas_perbaiki_lihat tiruan: TED-00001 dengan dua catatan AI (pemain 2 ID ML, pemain 3 nama); setelah disimpan = dicek ulang.
const dataPerbaiki = () => ({ kode: "TED-00001", nama_tim: "Garuda Mangliawan", nama_kapten: "A Pemain 1", desa: "Mangliawan", kabupaten: "KAB. MALANG",
  provinsi: "JAWA TIMUR", status: "menunggu", perbaiki_pada: perbaikan.length ? "2026-11-17T05:00:00Z" : null,
  pemain: [1, 2, 3, 4, 5].map((u) => ({ urutan: u, nama: `A Pemain ${u}`, dokumen_jenis: "KTP", ada_izin: u === 5 })),
  ai: { akhir: "cek", pada: "2026-11-17T04:00:00Z", segar: !perbaikan.length, tim: [], ganda: [],
    pemain: [{ u: 2, butir: [{ b: "profil_ml", t: "ID akun Mobile Legends tidak terlihat." }] },
      { u: 3, butir: [{ b: "identitas", t: 'Nama di dokumen "A PEMAIN TIGA" tidak sama dengan nama terdaftar "A Pemain 3".' }] }] } });
const JENIS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon" };
const srv = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname.startsWith("/sb/")) return supabase(req, res, u);
  // Vercel Web Analytics (bba47b2) hanya ada di Vercel; di server uji cukup skrip kosong.
  if (u.pathname === "/_vercel/insights/script.js") { res.writeHead(200, { "content-type": "text/javascript" }); return res.end(""); }
  if (u.pathname === "/js/config.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    return res.end(`window.APP_CONFIG = { SUPABASE_URL: "http://${req.headers.host}/sb", SUPABASE_ANON_KEY: "uji", TURNSTILE_SITE_KEY: "1x00000000000000000000AA", DRIVE_URL: ${JSON.stringify(DRIVE_URL)}, WA_GRUP: ${JSON.stringify(WA_GRUP)} };`);
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
    // Migrasi 16: WA pemain 2–6 + bukti twibbon bertanda Web App.
    if (b.p_pemain.slice(1).some((p) => !/^628\d{7,12}$/.test(p.wa || ""))) return kirim(400, { code: "P0001", message: "WA_PEMAIN_TIDAK_VALID" });
    if (!b.p_twibbon || !W.sahkan(b.p_twibbon)) return kirim(400, { code: "P0001", message: "TWIBBON_TIDAK_ADA" });
    pendaftaran++;
    daftarTerakhir = b;
    const t = W.daftarTim(b.p_nama_tim, b.p_pemain.map((p) => ({ nama: p.nama, jenis: p.dokumen_jenis, dok: p.dokumen_path, ml: p.profil_ml_path, ig1: p.follow_esports_path, ig2: p.follow_ppdt_path, izin: p.izin_path })), { wa: b.p_wa });
    // pg_net: setelah commit database mengirim kabar "tim" ke Web App.
    const k = W.kabar("tim", { tim: W.paket(t) });
    assert.equal(k.ok, true, JSON.stringify(k));
    if (b.p_pengajak !== undefined && b.p_pengajak !== "TED-00054") return kirim(400, { code: "P0001", message: "PENGAJAK_TIDAK_ADA" });
    return kirim(200, { kode: t.kode, komunitas: b.p_komunitas ?? null, pengajak: b.p_pengajak ?? null });
  }
  // Migrasi 19: kode tim pengajak dicek ke data publik tim.
  if (u.pathname === "/sb/rest/v1/tednas_tim_publik") {
    return kirim(200, u.searchParams.get("kode") === "eq.TED-00054"
      ? [{ kode: "TED-00054", nama_tim: "DESA CIRINTEN", desa: "Cirinten", kabupaten: "Kabupaten Lebak", status: "terverifikasi" }] : []);
  }
  if (u.pathname === "/sb/rest/v1/rpc/tednas_komunitas_info") {
    const b = JSON.parse(isi);
    return kirim(200, b.p_id === 7 ? { id: 7, nama: "Esports Malang Raya", kota: "Kota Malang", provinsi: "JAWA TIMUR" } : null);
  }
  // Migrasi 15: ubah semua data tim (halaman memakai ini lebih dulu).
  if (u.pathname === "/sb/rest/v1/rpc/tednas_ubah_lihat") {
    const b = JSON.parse(isi);
    if (b.p_kode !== "TED-00001" || b.p_token !== TOKEN) return kirim(400, { code: "P0001", message: "TAUTAN_TIDAK_SAH" });
    const d = dataPerbaiki();
    return kirim(200, { ...d, kecamatan: "Pakis", wa_kapten: "6281234567801", prov_kode: "35", kab_kode: "35.07", desa_kode: "35.07.18.2010",
      form_versi: formVersi, ada_twibbon: formVersi >= 2 ? false : false,
      pemain: d.pemain.map((p) => ({ ...p, wa: p.urutan === 1 ? "6281234567801" : formVersi >= 2 ? `62812000000${p.urutan}` : null })) });
  }
  if (u.pathname === "/sb/rest/v1/rpc/tednas_ubah_tim") {
    const b = JSON.parse(isi);
    if (b.p_kode !== "TED-00001" || b.p_token !== TOKEN) return kirim(400, { code: "P0001", message: "TAUTAN_TIDAK_SAH" });
    if (b.p_tim && b.p_tim.wa && b.p_tim.wa.replace(/\D/g, "").endsWith("7802")) return kirim(400, { code: "P0001", message: "WA_SUDAH_ADA" });
    if (b.p_tim && b.p_tim.twibbon_path && !W.sahkan(b.p_tim.twibbon_path)) return kirim(400, { code: "P0001", message: "TWIBBON_TIDAK_ADA" });
    for (const p of b.p_pemain) for (const k of ["dokumen_path", "profil_ml_path", "follow_esports_path", "follow_ppdt_path", "izin_path"]) {
      if (p[k] && !W.sahkan(p[k])) return kirim(400, { code: "P0001", message: "PROFIL_ML_TIDAK_ADA" });
    }
    perbaikan.push(b);
    return kirim(200, { ok: true, diubah: 2 });
  }
  if (u.pathname === "/sb/rest/v1/rpc/tednas_perbaiki_lihat") {
    const b = JSON.parse(isi);
    if (b.p_kode !== "TED-00001" || b.p_token !== TOKEN) return kirim(400, { code: "P0001", message: "TAUTAN_TIDAK_SAH" });
    return kirim(200, dataPerbaiki());
  }
  if (u.pathname === "/sb/rest/v1/rpc/tednas_perbaiki_simpan") {
    const b = JSON.parse(isi);
    if (b.p_kode !== "TED-00001" || b.p_token !== TOKEN) return kirim(400, { code: "P0001", message: "TAUTAN_TIDAK_SAH" });
    for (const p of b.p_pemain) for (const k of ["dokumen_path", "profil_ml_path", "follow_esports_path", "follow_ppdt_path", "izin_path"]) {
      if (p[k] && !W.sahkan(p[k])) return kirim(400, { code: "P0001", message: "PROFIL_ML_TIDAK_ADA" });
    }
    perbaikan.push(b);
    return kirim(200, { ok: true, diubah: 2 });
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

async function isiFormulir({ tim, wa, awal, cadangan = false, jalur = "/daftar" }) {
  await halaman.goto(`${ASAL}${jalur}`);
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
  // Migrasi 16: WA tiap pemain wajib (pemain 1 = nomor kapten).
  await halaman.click("#lanjut");
  assert.match(await halaman.textContent("#salah"), /Nomor WhatsApp pemain 2 belum diisi/);
  for (let i = 2; i <= (cadangan ? 6 : 5); i++) await halaman.fill(`#wa-pemain-${i}`, `0813 0000 ${String(i).padStart(4, "0")}`);
  await halaman.click("#lanjut");
  const blok = await halaman.$$("#pemain-berkas .blok-pemain");
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
  // Bukti twibbon tim wajib (1 per tim).
  await halaman.click("#lanjut");
  assert.match(await halaman.textContent("#salah"), /Screenshot post twibbon tim belum diunggah/);
  await halaman.setInputFiles("#tw-file", PNG(`${awal}tw`));
  await halaman.waitForSelector("#tw-status .berkas-ok");
  await halaman.click("#lanjut");
  await halaman.check("#setuju");
  // Turnstile kunci uji selalu lulus; tunggu tokennya terisi.
  await halaman.waitForFunction(() => document.querySelector("[name='cf-turnstile-response']")?.value, null, { timeout: 30000 });
}

// Link grup WhatsApp diambil dari config.js asli: uji ikut memastikan link-nya terisi.
const WA_GRUP = /WA_GRUP: '([^']+)'/.exec(readFileSync(join(PUBLIK, "js/config.js"), "utf8"))[1];

/* ── skenario ─────────────────────────────────────────────────────────── */
await uji("pendaftaran lengkap: 21 berkas langsung ke Drive, 2 sekaligus, data seketika ke Sheet", async () => {
  await isiFormulir({ tim: "Garuda Mangliawan", wa: "081234567890", awal: "A" });
  await halaman.click("#lanjut");
  await halaman.waitForSelector("#sukses:not([hidden])", { timeout: 60000 });
  assert.equal(await halaman.textContent("#kode"), "TED-00001");
  assert.ok(await halaman.isVisible("#wa-grup-link"), "tombol grup WhatsApp tampil setelah daftar");
  assert.match(await halaman.getAttribute("#wa-grup-link", "href"), /^https:\/\/chat\.whatsapp\.com\/\w+/);
  assert.equal(unggahan, 22, "21 berkas pemain + 1 bukti twibbon");
  assert.equal(puncak, 2, `unggahan bersamaan ${puncak}`);
  assert.ok(W.sahkan(daftarTerakhir.p_twibbon), "twibbon bertanda Web App");
  assert.deepEqual(daftarTerakhir.p_pemain.map((p) => p.wa), [null, "6281300000002", "6281300000003", "6281300000004", "6281300000005"], "WA pemain 2–5 (628…); pemain 1 = kapten");
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
  assert.equal(unggahan - awal, 22, `total unggahan ${unggahan - awal} (sebelum galat ${sebelum}); 21 berkas + 1 twibbon`);
  assert.equal(pendaftaran, 3);
});

await uji("perbaikan oleh kapten: tautan dari WA → catatan per pemain → ganti berkas & nama → tersimpan, AI cek ulang", async () => {
  // Tautan rusak / token salah: pesan jelas (halaman terpisah supaya 400-nya tidak tercatat sebagai galat halaman utama).
  const lain = await ctx.newPage();
  await lain.goto(`${ASAL}/perbaiki.html`);
  await lain.waitForSelector("#pb-galat:not([hidden])");
  assert.match(await lain.textContent("#pb-galat"), /tidak lengkap/);
  await lain.goto(`${ASAL}/perbaiki.html#TED-00001.${"0".repeat(40)}`);
  await lain.reload();
  await lain.waitForSelector("#pb-galat:not([hidden])");
  assert.match(await lain.textContent("#pb-galat"), /Tautan ini tidak berlaku/);
  await lain.close();

  const awal = unggahan;
  await halaman.goto(`${ASAL}/perbaiki.html#TED-00001.${TOKEN}`);
  await halaman.waitForSelector("#pb:not([hidden])");
  assert.equal(await halaman.textContent("#pb-nama"), "Garuda Mangliawan");
  assert.match(await halaman.textContent("#pb-kabar"), /Ada 2 catatan/);
  assert.match(await halaman.textContent("[data-u='2'] .pb-saran"), /belum menampilkan ID akun/);
  assert.equal(await halaman.$$eval("[data-u='2'] .jatuhan.perlu input", (x) => x.map((i) => i.dataset.file).join()), "ml", "isian yang perlu diganti disorot");
  assert.equal(await halaman.$$eval("[data-u='3'] label.isian.perlu [data-nama]", (x) => x.length), 1);
  assert.equal(await halaman.$eval("[data-u='1'] details", (d) => d.open), false, "pemain tanpa catatan dilipat");
  await halaman.click("#pb-simpan");
  assert.match(await halaman.textContent("#salah"), /Belum ada yang diubah/);
  await (await halaman.$("[data-u='2'] [data-file=ml]")).setInputFiles(PNG("perbaikan-ml"));
  await halaman.waitForSelector("[data-u='2'] [data-status=ml] .berkas-ok");
  await halaman.fill("[data-u='3'] [data-nama]", "A Pemain Tiga");
  assert.equal(await halaman.textContent("#pb-ringkas"), "1 berkas baru, 2 pemain diubah");
  await halaman.click("#pb-simpan");
  await halaman.waitForFunction(() => /Perubahan tersimpan/.test(document.querySelector("#pb-kabar").textContent));
  assert.equal(unggahan - awal, 1, "hanya berkas yang diganti yang diunggah");
  assert.equal(perbaikan.length, 1);
  const [p2, p3] = perbaikan[0].p_pemain;
  assert.equal(p2.urutan, 2); assert.ok(W.sahkan(p2.profil_ml_path), "path bertanda Web App"); assert.deepEqual(Object.keys(p2).sort(), ["profil_ml_path", "urutan"]);
  assert.deepEqual(p3, { urutan: 3, nama: "A Pemain Tiga" });
  assert.match(await halaman.textContent("#pb-kabar"), /dicek ulang otomatis/);
  assert.equal(perbaikan[0].p_tim, null, "data tim tidak berubah = p_tim kosong");
  assert.match(await halaman.getAttribute("#wa-grup-link", "href"), /^https:\/\/chat\.whatsapp\.com\//);
});

await uji("ubah data tim (migrasi 15): nama tim, WA kapten, ganti desa, tambah cadangan; WA bentrok dijelaskan", async () => {
  await halaman.goto(`${ASAL}/perbaiki.html#TED-00001.${TOKEN}`);
  await halaman.reload();
  await halaman.waitForSelector("#pb-data-tim details");
  await halaman.click("#pb-data-tim summary");
  assert.equal(await halaman.inputValue("#pb-wa"), "081234567801", "nomor WA tampil dalam format 08");
  await halaman.fill("#pb-nama-tim", "Garuda Mangliawan Baru");
  await halaman.fill("#pb-wa", "0812-3456-7802");
  // ganti desa: provinsi → kabupaten → cari → pilih
  await halaman.click("#pb-ganti-desa");
  await halaman.waitForFunction(() => document.querySelectorAll("#pb-prov option").length > 30);
  await halaman.selectOption("#pb-prov", "35");
  await halaman.waitForFunction(() => !document.querySelector("#pb-kab").disabled);
  await halaman.selectOption("#pb-kab", "35.07");
  await halaman.waitForFunction(() => !document.querySelector("#pb-cari-desa").disabled);
  await halaman.fill("#pb-cari-desa", "asrikaton");
  await halaman.click("#pb-daftar-desa [data-k='35.07.18.2013']");
  assert.match(await halaman.textContent("#pb-desa-kini"), /Desa Asrikaton \(baru\).*Kec\. Pakis/s);
  // tambah cadangan: semua berkas wajib
  await halaman.click("#pb-tambah-cadangan");
  await halaman.waitForSelector("[data-baru] [data-nama]");
  assert.equal(await halaman.inputValue("#pb-nama-tim"), "Garuda Mangliawan Baru", "isian tim tidak hilang saat blok cadangan muncul");
  await halaman.fill("[data-baru] [data-nama]", "Cadangan Baru");
  await (await halaman.$("[data-baru] [data-file=dok]")).setInputFiles(PNG("cad-dok"));
  await halaman.waitForSelector("[data-baru] [data-status=dok] .berkas-ok");
  await halaman.click("#pb-simpan");
  await halaman.waitForFunction(() => /belum lengkap: Profil Mobile Legends, Follow @esportsdesa\.official, Follow @ditjen_ppdt/.test(document.querySelector("#salah").textContent));
  for (const k of ["ml", "ig1", "ig2"]) { await (await halaman.$(`[data-baru] [data-file=${k}]`)).setInputFiles(PNG(`cad-${k}`)); await halaman.waitForSelector(`[data-baru] [data-status=${k}] .berkas-ok`); }
  assert.match(await halaman.textContent("#pb-ringkas"), /data tim, 4 berkas baru, 1 pemain diubah/);
  // WA milik tim lain → pesan jelas, tidak tersimpan
  const n = perbaikan.length;
  await halaman.click("#pb-simpan");
  await halaman.waitForFunction(() => /sudah dipakai kapten tim lain/.test(document.querySelector("#salah").textContent));
  assert.equal(perbaikan.length, n);
  // 400 dari penolakan WA yang disengaja bukan galat halaman.
  for (let i = galatKonsol.length - 1; i >= 0; i--) if (/tednas_ubah_tim|status of 400/.test(galatKonsol[i])) galatKonsol.splice(i, 1);
  await halaman.fill("#pb-wa", "0812 9999 0001");
  await halaman.click("#pb-simpan");
  await halaman.waitForFunction(() => /Perubahan tersimpan/.test(document.querySelector("#pb-kabar").textContent));
  const b = perbaikan.at(-1);
  assert.deepEqual(b.p_tim, { nama_tim: "Garuda Mangliawan Baru", wa: "0812 9999 0001", prov_kode: "35", provinsi: "Jawa Timur", kab_kode: "35.07", kabupaten: "Kabupaten Malang", kecamatan: "Pakis", desa_kode: "35.07.18.2013", desa: "Asrikaton" });
  const cad = b.p_pemain.find((x) => x.baru);
  assert.equal(cad.urutan, 6); assert.equal(cad.nama, "Cadangan Baru");
  assert.ok(["dokumen_path", "profil_ml_path", "follow_esports_path", "follow_ppdt_path"].every((k) => W.sahkan(cad[k])), "berkas cadangan bertanda Web App");
});

await uji("ubah data tim form v2 (migrasi 16): WA pemain wajib & bisa diganti, bukti twibbon diunggah dari halaman ubah", async () => {
  formVersi = 2;
  try {
    await halaman.goto(`${ASAL}/perbaiki.html#TED-00001.${TOKEN}`);
    await halaman.reload();
    await halaman.waitForSelector(".pb-twibbon [data-tw]");
    assert.match(await halaman.textContent(".pb-twibbon"), /Belum ada\..*Wajib 1 per tim/s);
    const blok2 = "[data-u='2']:not([data-baru])";
    await halaman.$eval(`${blok2} details`, (d) => { d.open = true; });
    assert.equal(await halaman.inputValue(`${blok2} [data-wa]`), "08120000002", "WA pemain tampil dalam format 08");
    assert.equal(await halaman.$$eval("[data-u='1'] [data-wa]", (x) => x.length), 0, "pemain 1 memakai nomor kapten");
    await halaman.fill(`${blok2} [data-wa]`, "");
    await halaman.click("#pb-simpan");
    await halaman.waitForFunction(() => /Nomor WhatsApp pemain 2 wajib diisi/.test(document.querySelector("#salah").textContent));
    await halaman.fill(`${blok2} [data-wa]`, "0857-1111-2222");
    await halaman.setInputFiles(".pb-twibbon [data-tw]", PNG("tw-ubah"));
    await halaman.waitForSelector("#pb-tw-status .berkas-ok");
    assert.match(await halaman.textContent("#pb-ringkas"), /data tim, 1 pemain diubah/);
    await halaman.click("#pb-simpan");
    await halaman.waitForFunction(() => /Perubahan tersimpan/.test(document.querySelector("#pb-kabar").textContent));
    const b = perbaikan.at(-1);
    assert.ok(W.sahkan(b.p_tim.twibbon_path), "twibbon bertanda Web App");
    assert.deepEqual(b.p_pemain, [{ urutan: 2, wa: "6285711112222" }]);
  } finally { formVersi = 1; }
});

await uji("tautan komunitas ToT: daftar?k=7 → spanduk komunitas → tercatat di pendaftaran; tetap diingat; tanpa halaman/menu ToT di situs", async () => {
  assert.equal(daftarTerakhir.p_komunitas, undefined, "pendaftaran biasa tanpa komunitas");
  await isiFormulir({ tim: "Rajawali Komunitas", wa: "081234567893", awal: "D", jalur: "/daftar?k=7" });
  assert.equal(await halaman.isVisible("#komunitas-pita"), true);
  assert.match(await halaman.textContent("#komunitas-pita"), /lewat komunitas Esports Malang Raya \(Kota Malang\)/);
  assert.match(await halaman.textContent("#ulasan"), /KomunitasEsports Malang Raya/);
  await halaman.click("#lanjut");
  await halaman.waitForSelector("#sukses:not([hidden])", { timeout: 60000 });
  assert.equal(daftarTerakhir.p_komunitas, 7);
  assert.match(await halaman.textContent("#sukses-komunitas"), /Tercatat untuk komunitas Esports Malang Raya/);
  assert.equal(await halaman.isVisible("#komunitas-pita"), false);

  // Dibuka lagi tanpa ?k (mis. besoknya): komunitas masih diingat browser. Tidak ada tombol untuk melepasnya (user).
  await halaman.goto(`${ASAL}/daftar`);
  await halaman.waitForSelector("#komunitas-pita:not([hidden])");
  assert.equal(await halaman.$$eval("#komunitas-pita button, #komunitas-pita a", (x) => x.length), 0);
  // ToT hanya di MZone: tidak ada menu/halaman komunitas di esportsdesa.id.
  assert.equal(await halaman.$$eval("header.nav a", (a) => a.filter((x) => /komunitas/i.test(x.textContent + x.href)).length), 0);

  // Kode tak dikenal / nonaktif: tanpa spanduk, dan tidak disimpan (database memasukkan timnya ke MZone Tour).
  await halaman.goto(`${ASAL}/daftar?k=99`);
  await halaman.waitForSelector("#form:not([hidden])");
  await halaman.waitForTimeout(300);
  assert.equal(await halaman.isVisible("#komunitas-pita"), false);
  assert.equal(await halaman.evaluate(() => localStorage.getItem("tednas_ref_komunitas")), null);
});

await uji("kode tim pengajak (migrasi 19): daftar?r=ted-54 terisi & dicek → tercatat; sukses menampilkan tautan ajak; kode salah menahan langkah", async () => {
  assert.equal(daftarTerakhir.p_pengajak, undefined, "pendaftaran tanpa kode pengajak tidak mengirim p_pengajak");
  await isiFormulir({ tim: "Garuda Ajakan", wa: "081234567894", awal: "E", jalur: "/daftar?r=ted-54" });
  assert.match(await halaman.textContent("#ulasan"), /Diajak timTED-00054 · DESA CIRINTEN/);
  await halaman.click("#lanjut");
  await halaman.waitForSelector("#sukses:not([hidden])", { timeout: 60000 });
  assert.equal(daftarTerakhir.p_pengajak, "TED-00054");
  const kode = (await halaman.textContent("#kode")).trim();
  assert.equal(await halaman.textContent("#ajak-tautan"), `Kode timmu: ${kode} · https://esportsdesa.id/r/${kode}`);
  assert.ok((await halaman.getAttribute("#ajak-wa", "href")).includes(encodeURIComponent(`https://esportsdesa.id/r/${kode}`)));
  assert.equal(await halaman.evaluate(() => localStorage.getItem("tednas_ref_tim")), null, "kode pengajak dilupakan sesudah terdaftar");

  // Kode salah dari tautan: tampil "tidak ditemukan", langkah 2 tertahan sampai diperbaiki atau dikosongkan.
  await halaman.goto(`${ASAL}/daftar?r=TED-99999`);
  await halaman.waitForSelector("#form:not([hidden])");
  await halaman.check("#setuju-aturan"); await halaman.click("#lanjut");
  await halaman.waitForSelector("#prov option[value='35']", { state: "attached" }); await halaman.selectOption("#prov", "35");
  await halaman.waitForSelector("#kab option[value='35.07']", { state: "attached" }); await halaman.selectOption("#kab", "35.07");
  await halaman.waitForSelector("#cari-desa:not([disabled])"); await halaman.fill("#cari-desa", "Mangliawan"); await halaman.click(".desa-opsi:not(:disabled)");
  await halaman.click("#lanjut");
  assert.equal(await halaman.inputValue("#pengajak"), "TED-99999");
  await halaman.waitForFunction(() => /tidak ditemukan/.test(document.querySelector("#pengajak-info").textContent));
  await halaman.fill("#nama-tim", "Tim Salah Kode");
  for (let i = 1; i <= 5; i++) await halaman.fill(`#pemain-${i}`, `F Pemain ${i}`);
  await halaman.fill("#wa", "081234567895");
  for (let i = 2; i <= 5; i++) await halaman.fill(`#wa-pemain-${i}`, `0813 1111 ${String(i).padStart(4, "0")}`);
  await halaman.click("#lanjut");
  assert.match(await halaman.textContent("#salah"), /Kode tim yang mengajak belum benar/);
  await halaman.fill("#pengajak", "ted 54");
  await halaman.waitForFunction(() => /✓ TED-00054 · DESA CIRINTEN, Desa Cirinten, Kabupaten Lebak/.test(document.querySelector("#pengajak-info").textContent));
  await halaman.fill("#pengajak", "");
  await halaman.waitForTimeout(450);
  await halaman.click("#lanjut");
  await halaman.waitForSelector("#pemain-berkas .blok-pemain");
});

await uji("tanpa galat skrip di halaman", async () => { assert.deepEqual(galatKonsol, []); });

await tutup();
console.log(`${lulus} uji peramban lulus`);
