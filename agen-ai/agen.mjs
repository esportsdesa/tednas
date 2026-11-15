#!/usr/bin/env node
/**
 * AGEN AI PEMERIKSA BERKAS TEDNas (permintaan 16 Nov 2026). Jalan terus di server dapur (systemd --user).
 *
 * Tiap putaran:
 *  1. Ambil tim yang perlu diperiksa dari Supabase (tednas_ai_antre, berkunci ai_rahasia).
 *  2. Ambil berkasnya dari Web App Google Drive utama (aksi "berkas" + kunci_ai). PDF → gambar (pdftoppm).
 *  3. Minta model penglihatan lokal (qwen3.5:9b di armada worker JOT) MEMBACA tiap berkas (nilai.mjs).
 *  4. Nilai dengan aturan peraturan (nilai.mjs), simpan (tednas_ai_simpan). Status tim TIDAK diubah: admin yang
 *     menekan Verifikasi.
 *
 * Model dipanggil LANGSUNG ke worker yang sehat & hangat menurut /lb/keadaan, tidak lewat LB. LB jatuh ke
 * Ollama dapur bila worker habis, dan beban gambar di dapur bisa menghabiskan RAM server. Tanpa worker, agen
 * menunggu.
 * Data pribadi (nama, NIK) tidak ditulis ke log. NIK disimpan sebagai HMAC (untuk mencari yang ganda) +
 * versi tersamar.
 *
 *   node agen-ai/agen.mjs              jalan terus
 *   node agen-ai/agen.mjs --sekali     habiskan antrean lalu berhenti
 *   node agen-ai/agen.mjs --coba <gambar> <identitas|profil_ml|follow_esports|follow_ppdt|izin> [nama]
 *                                      uji satu gambar lokal (tanpa Supabase/Drive)
 * Lingkungan (berkas env, lihat agen-ai/README.md): TEDNAS_SUPABASE_URL, TEDNAS_SUPABASE_KUNCI_PUBLIK,
 *   TEDNAS_DRIVE_URL, TEDNAS_AI_KUNCI, TEDNAS_LB_URL (bawaan http://127.0.0.1:11435), TEDNAS_MODEL (qwen3.5:9b),
 *   TEDNAS_PARALEL (3).
 */
import { createHash, createHmac } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import * as N from "./nilai.mjs";

const E = process.env;
const CFG = {
  sb: (E.TEDNAS_SUPABASE_URL || "").replace(/\/$/, ""),
  sbKunci: E.TEDNAS_SUPABASE_KUNCI_PUBLIK || "",
  drive: E.TEDNAS_DRIVE_URL || "",
  kunci: E.TEDNAS_AI_KUNCI || "",
  lb: (E.TEDNAS_LB_URL || "http://127.0.0.1:11435").replace(/\/$/, ""),
  model: E.TEDNAS_MODEL || "qwen3.5:9b",
  paralel: Math.max(1, Math.min(6, Number(E.TEDNAS_PARALEL) || 3)),
};
const MODEL_LABEL = () => `${CFG.model} · agen v${N.VERSI_AGEN}`;
const TUNDA = Number(E.TEDNAS_TUNDA_KALI ?? 1); // uji: 0 = tanpa jeda coba-ulang
const tidur = (ms) => new Promise((ok) => setTimeout(ok, ms * TUNDA));
const log = (...a) => console.log(new Date().toISOString().slice(0, 19).replace("T", " "), ...a);

/* ── Supabase ─────────────────────────────────────────────────────────── */
export async function rpc(nama, isi, f = fetch) {
  const r = await f(`${CFG.sb}/rest/v1/rpc/${nama}`, {
    method: "POST", headers: { apikey: CFG.sbKunci, "content-type": "application/json" },
    body: JSON.stringify(isi), signal: AbortSignal.timeout(60000),
  });
  const t = await r.text();
  if (!r.ok) { let p = t; try { p = JSON.parse(t).message || t; } catch { /* apa adanya */ } throw new Error(`Supabase ${r.status} ${nama}: ${String(p).slice(0, 200)}`); }
  return t ? JSON.parse(t) : null;
}

/* ── Web App Drive: satu berkas ───────────────────────────────────────── */
// BERKAS_TIDAK_ADA / PATH_TIDAK_SAH / BUKAN_BERKAS_TEDNAS = tetap (dicatat di hasil). Lainnya = coba lagi nanti.
const GALAT_TETAP = { BERKAS_TIDAK_ADA: "Berkas tidak ditemukan di Drive.", PATH_TIDAK_SAH: "Alamat berkas tidak sah.", BUKAN_BERKAS_TEDNAS: "Berkas di luar folder TEDNas." };
export async function ambilBerkas(path, f = fetch) {
  if (!String(path).startsWith("gdrive/")) return { tetap: "Berkas masih di penyimpanan lama (Supabase): cek manual." };
  let alasan = "";
  for (let i = 0; i < 6; i++) {
    if (i) await tidur(Math.min(30000, 3000 * i));
    try {
      const r = await f(CFG.drive, { method: "POST", headers: { "content-type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ aksi: "berkas", path, kunci_ai: CFG.kunci }), signal: AbortSignal.timeout(120000) });
      const teks = await r.text();
      let j; try { j = JSON.parse(teks); } catch { alasan = `Web App HTTP ${r.status} bukan JSON`; continue; }
      if (j.ok) return { mime: j.mime, data: Buffer.from(j.data, "base64") };
      if (GALAT_TETAP[j.pesan]) return { tetap: GALAT_TETAP[j.pesan] };
      if (j.pesan === "BUKAN_ADMIN") throw Object.assign(new Error("Web App menolak kunci AI (KUNCI_AI di Code.gs utama belum diisi / Web App belum di-deploy ulang)"), { fatal: true });
      alasan = j.pesan || "galat";
    } catch (e) { if (e.fatal) throw e; alasan = e.message; }
  }
  throw new Error(`Web App gagal: ${alasan}`);
}

/** PDF → JPEG halaman 1–2 (pdftoppm, poppler-utils). Berkas sementara langsung dihapus. */
export function pdfKeGambar(buf) {
  const dir = mkdtempSync(join(tmpdir(), "tednas-ai-"));
  try {
    writeFileSync(join(dir, "a.pdf"), buf);
    return new Promise((ok, gagal) => {
      execFile("pdftoppm", ["-jpeg", "-r", "100", "-f", "1", "-l", "2", join(dir, "a.pdf"), join(dir, "h")], { timeout: 60000 }, (err) => {
        try {
          if (err) return gagal(new Error("PDF tidak bisa dibuka: " + err.message.slice(0, 100)));
          ok(readdirSync(dir).filter((n) => n.endsWith(".jpg")).sort().map((n) => readFileSync(join(dir, n))));
        } finally { rmSync(dir, { recursive: true, force: true }); }
      });
    });
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e; }
}

/* ── Worker AI ────────────────────────────────────────────────────────── */
const rehat = new Map(); // host → waktu boleh dipakai lagi
const dipakai = new Map(); // host → jumlah permintaan agen yang sedang jalan

export async function daftarWorker(f = fetch) {
  const r = await f(`${CFG.lb}/lb/keadaan`, { signal: AbortSignal.timeout(10000) });
  const k = await r.json();
  const kini = Date.now();
  return (k.worker || []).filter((w) => w.sehat && w.hangat && !/^127\.|^localhost/.test(w.host) && (rehat.get(w.host) || 0) < kini);
}

async function pilihWorker(f) {
  for (let i = 0; ; i++) {
    const w = (await daftarWorker(f).catch(() => [])).sort((a, b) => (dipakai.get(a.host) || 0) - (dipakai.get(b.host) || 0) || a.muatan - b.muatan || Math.random() - 0.5)[0];
    if (w) return w;
    if (i % 10 === 0) log("menunggu worker AI yang sehat & hangat…");
    await tidur(30000);
  }
}

/** Satu pertanyaan + gambar → objek JSON sesuai skema. Pindah worker bila gagal. */
export async function tanyaModel({ prompt, format }, gambar, f = fetch) {
  let alasan = "";
  for (let i = 0; i < 4; i++) {
    const w = await pilihWorker(f);
    dipakai.set(w.host, (dipakai.get(w.host) || 0) + 1);
    try {
      const r = await f(`http://${w.host}:11434/api/chat`, {
        method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(180000),
        body: JSON.stringify({ model: CFG.model, stream: false, think: false, keep_alive: "60m", format, options: { temperature: 0 },
          messages: [{ role: "user", content: prompt, ...(gambar?.length ? { images: gambar.map((g) => g.toString("base64")) } : {}) }] }),
      });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
      return JSON.parse(j.message.content);
    } catch (e) {
      alasan = `${w.nama}: ${e.message}`;
      rehat.set(w.host, Date.now() + 5 * 60000);
    } finally { dipakai.set(w.host, (dipakai.get(w.host) || 1) - 1); }
  }
  throw new Error(`model gagal 4 kali (${alasan})`);
}

/* ── Satu tim ─────────────────────────────────────────────────────────── */
const KOLOM = ["dokumen_path", "profil_ml_path", "follow_esports_path", "follow_ppdt_path", "izin_path"];
const KUNCI_BACA = { dokumen_path: "identitas", profil_ml_path: "profil_ml", follow_esports_path: "follow_esports_path", follow_ppdt_path: "follow_ppdt_path", izin_path: "izin" };

function pertanyaan(kolom, p) {
  if (kolom === "dokumen_path") return N.tanyaIdentitas(p.dokumen_jenis, p.nama);
  if (kolom === "profil_ml_path") return N.tanyaProfilMl(p.nama);
  if (kolom === "izin_path") return N.tanyaIzin(p.nama);
  return N.tanyaFollow(N.AKUN_IG[kolom]);
}

/** Antrean sederhana: jalankan tugas dengan paling banyak n sekaligus. */
async function berbarengan(tugas, n) {
  const hasil = new Array(tugas.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, tugas.length) }, async () => { while (i < tugas.length) { const k = i++; hasil[k] = await tugas[k](); } }));
  return hasil;
}

export async function periksaTim(t, alat = {}) {
  const f = alat.fetch || fetch, pdf = alat.pdfKeGambar || pdfKeGambar;
  const mulai = Date.now();
  const baca = {}, sha = {};
  let sementara = null; // galat yang layak dicoba lagi (Web App / model)

  const tugas = [];
  for (const p of t.pemain || []) {
    baca[p.urutan] = {}; sha[p.urutan] = {};
    for (const kolom of KOLOM) {
      if (!p[kolom]) continue;
      tugas.push(async () => {
        const kunci = KUNCI_BACA[kolom];
        try {
          const b = await ambilBerkas(p[kolom], f);
          if (b.tetap) { baca[p.urutan][kunci] = { galat: b.tetap }; return; }
          sha[p.urutan][kolom] = createHash("sha256").update(b.data).digest("hex").slice(0, 32);
          // Surat izin hanya dibaca bila pemain di bawah 17 tahun — diputuskan setelah identitas terbaca (di bawah).
          if (kolom === "izin_path") { baca[p.urutan]._izin = b; return; }
          const gambar = b.mime === "application/pdf" ? await pdf(b.data) : [b.data];
          baca[p.urutan][kunci] = await tanyaModel(pertanyaan(kolom, p), gambar, f);
        } catch (e) {
          if (e.fatal) throw e;
          if (/^PDF tidak bisa dibuka/.test(e.message)) baca[p.urutan][kunci] = { galat: e.message };
          else sementara = e.message;
        }
      });
    }
  }
  await berbarengan(tugas, CFG.paralel);

  // Surat izin: baca hanya untuk yang umurnya < 17 (hemat model).
  const izin = [];
  for (const p of t.pemain || []) {
    const b = baca[p.urutan]._izin; delete baca[p.urutan]._izin;
    if (!b) continue;
    const umur = N.umurPada(N.lahirIdentitas(baca[p.urutan].identitas));
    if (umur === null || umur >= N.UMUR_IZIN) continue;
    izin.push(async () => {
      try {
        const gambar = b.mime === "application/pdf" ? await pdf(b.data) : [b.data];
        baca[p.urutan].izin = await tanyaModel(pertanyaan("izin_path", p), gambar, f);
      } catch (e) { if (/^PDF tidak bisa dibuka/.test(e.message)) baca[p.urutan].izin = { galat: e.message }; else sementara = e.message; }
    });
  }
  await berbarengan(izin, CFG.paralel);

  let namaTim = null;
  try { namaTim = await tanyaModel(N.tanyaNamaTim(t.nama_tim), null, f); } catch (e) { sementara = e.message; }

  const durasi = Date.now() - mulai;
  if (sementara) return { hasil: "galat", ringkas: `Belum selesai diperiksa, dicoba lagi otomatis: ${sementara}`.slice(0, 500), rincian: {}, identitas: [], durasi };
  const n = N.nilaiTim(t, baca, namaTim, sha);
  const identitas = n.identitas.map((x) => ({ ...x, nik: x.nik ? createHmac("sha256", CFG.kunci).update("nik:" + x.nik).digest("hex").slice(0, 32) : "" }));
  return { ...n, identitas, durasi };
}

async function simpan(t, h, f = fetch) {
  return rpc("tednas_ai_simpan", { p_kunci: CFG.kunci, p_tim: t.id, p_sidik: t.sidik, p_versi: N.VERSI_AGEN, p_hasil: h.hasil,
    p_ringkas: h.ringkas, p_rincian: h.rincian, p_identitas: h.identitas, p_model: MODEL_LABEL(), p_durasi: h.durasi }, f);
}

/* ── Putaran ──────────────────────────────────────────────────────────── */
export async function putaran(alat = {}) {
  const f = alat.fetch || fetch;
  const a = await rpc("tednas_ai_antre", { p_kunci: CFG.kunci, p_versi: N.VERSI_AGEN, p_batas: 1 }, f);
  if (!a.tim.length) return 0;
  const t = a.tim[0];
  let h;
  try { h = await periksaTim(t, alat); }
  catch (e) {
    if (e.fatal) throw e;
    h = { hasil: "galat", ringkas: `Agen galat, dicoba lagi otomatis: ${e.message}`.slice(0, 500), rincian: {}, identitas: [], durasi: null };
  }
  const s = await simpan(t, h, f);
  log(`${t.kode}: ${h.hasil}${s && s.ok ? ` → ${s.akhir}` : ` (tidak disimpan: ${s && s.pesan})`} · ${Math.round((h.durasi || 0) / 1000)} dtk · sisa ${Math.max(0, a.sisa - 1)}`);
  return a.sisa;
}

function cekKonfig() {
  const kurang = Object.entries({ TEDNAS_SUPABASE_URL: CFG.sb, TEDNAS_SUPABASE_KUNCI_PUBLIK: CFG.sbKunci, TEDNAS_DRIVE_URL: CFG.drive, TEDNAS_AI_KUNCI: CFG.kunci }).filter(([, v]) => !v).map(([k]) => k);
  if (kurang.length) { console.error("Lingkungan kurang: " + kurang.join(", ")); process.exit(2); }
  if (!/^[0-9a-f]{64}$/.test(CFG.kunci)) { console.error("TEDNAS_AI_KUNCI harus 64 hex"); process.exit(2); }
}

async function jalan(sekali) {
  cekKonfig();
  log(`agen AI TEDNas v${N.VERSI_AGEN} mulai · model ${CFG.model} · paralel ${CFG.paralel}`);
  let segar = 0, berhenti = false;
  process.on("SIGTERM", () => { berhenti = true; log("berhenti (SIGTERM) setelah tim yang sedang diperiksa"); });
  while (!berhenti) {
    try {
      if (Date.now() - segar > 10 * 60000) { await rpc("tednas_ai_segarkan", { p_kunci: CFG.kunci }); segar = Date.now(); }
      const sisa = await putaran();
      if (!sisa) { if (sekali) break; await tidur(60000); }
    } catch (e) {
      log("GALAT:", e.message);
      if (e.fatal) { if (sekali) process.exit(1); await tidur(10 * 60000); } else await tidur(60000);
    }
  }
}

async function coba(berkas, jenis, nama = "Pemain Uji") {
  const p = { nama, dokumen_jenis: "KTP" };
  const kolom = { identitas: "dokumen_path", profil_ml: "profil_ml_path", follow_esports: "follow_esports_path", follow_ppdt: "follow_ppdt_path", izin: "izin_path" }[jenis];
  if (!kolom) throw new Error("jenis: identitas|profil_ml|follow_esports|follow_ppdt|izin");
  const buf = readFileSync(berkas);
  const gambar = berkas.toLowerCase().endsWith(".pdf") ? await pdfKeGambar(buf) : [buf];
  const t0 = Date.now();
  console.log(JSON.stringify(await tanyaModel(pertanyaan(kolom, p), gambar), null, 1), `${Date.now() - t0} ms`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("agen.mjs")) {
  const [a, b, c, d] = process.argv.slice(2);
  if (a === "--coba") await coba(b, c, d);
  else await jalan(a === "--sekali");
}
