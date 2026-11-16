#!/usr/bin/env node
/**
 * AGEN AI PEMERIKSA BERKAS TEDNas (permintaan 16 Nov 2026). Jalan terus di server dapur (systemd --user).
 *
 * Tiap putaran:
 *  1. Ambil tim yang perlu diperiksa dari Supabase (tednas_ai_antre, berkunci ai_rahasia).
 *  2. Ambil berkasnya dari Web App Google Drive utama (aksi "berkas" + kunci_ai). PDF → gambar (pdftoppm).
 *  3. Minta model penglihatan MEMBACA tiap berkas (nilai.mjs).
 *  4. Nilai dengan aturan peraturan (nilai.mjs), simpan (tednas_ai_simpan). Database langsung mengubah status
 *     tim yang lolos menjadi Terverifikasi; yang "cek" tetap Menunggu untuk admin.
 *
 * Model (TEDNAS_MESIN):
 *  - "pool" (bawaan, permintaan user 16 Nov): Qwen3.6-35B-A3B di pool GPU gabungan Gambir. Alamat kepala dibaca
 *    dari berkas broker (/home/jot/rpc-broker/pool-head.txt + pool-model.txt); selama ada antrean agen menyalakan
 *    want-heavy + last-request supaya broker merakit/menahan pool (cara yang sama dengan Kawan Bicara). Pool
 *    harus dinyalakan dengan mmproj (/props modalities.vision); tanpa itu dianggap belum siap. Pool belum siap
 *    = agen menunggu.
 *  - "pool+armada": seperti di atas, tetapi selagi pool belum siap pakai qwen3.5:9b di armada worker.
 *  - "armada": hanya qwen3.5:9b, LANGSUNG ke worker yang sehat & hangat menurut /lb/keadaan, tidak lewat LB (LB
 *    jatuh ke Ollama dapur bila worker habis, dan beban gambar di dapur bisa menghabiskan RAM server).
 * Data pribadi (nama, NIK) tidak ditulis ke log. NIK disimpan sebagai HMAC (untuk mencari yang ganda) +
 * versi tersamar.
 *
 *   node agen-ai/agen.mjs              jalan terus
 *   node agen-ai/agen.mjs --sekali     habiskan antrean lalu berhenti
 *   node agen-ai/agen.mjs --coba <gambar> <identitas|profil_ml|follow_esports|follow_ppdt|izin> [nama]
 *                                      uji satu gambar lokal (tanpa Supabase/Drive)
 * Lingkungan (berkas env, lihat agen-ai/README.md): TEDNAS_SUPABASE_URL, TEDNAS_SUPABASE_KUNCI_PUBLIK,
 *   TEDNAS_DRIVE_URL, TEDNAS_AI_KUNCI, TEDNAS_MESIN (pool), TEDNAS_POOL_DIR (/home/jot/rpc-broker),
 *   TEDNAS_POOL_MODEL (35B), TEDNAS_POOL_PARALEL (2), TEDNAS_LB_URL (http://127.0.0.1:11435),
 *   TEDNAS_MODEL (qwen3.5:9b), TEDNAS_PARALEL (3, untuk armada).
 */
import { createHash, createHmac } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import * as N from "./nilai.mjs";

const E = process.env;
export const CFG = {
  sb: (E.TEDNAS_SUPABASE_URL || "").replace(/\/$/, ""),
  sbKunci: E.TEDNAS_SUPABASE_KUNCI_PUBLIK || "",
  drive: E.TEDNAS_DRIVE_URL || "",
  kunci: E.TEDNAS_AI_KUNCI || "",
  mesin: ["gabungan", "pool", "pool+armada", "armada"].includes(E.TEDNAS_MESIN) ? E.TEDNAS_MESIN : "gabungan",
  poolDir: E.TEDNAS_POOL_DIR || "/home/jot/rpc-broker",
  poolModel: (E.TEDNAS_POOL_MODEL || "35B").split(",").map((s) => s.trim()).filter(Boolean),
  poolParalel: Math.max(1, Math.min(4, Number(E.TEDNAS_POOL_PARALEL) || 2)),
  lb: (E.TEDNAS_LB_URL || "http://127.0.0.1:11435").replace(/\/$/, ""),
  model: E.TEDNAS_MODEL || "qwen3.5:9b",
  paralel: Math.max(1, Math.min(6, Number(E.TEDNAS_PARALEL) || 3)),
};
const NAMA_POOL = { "35B": "Qwen3.6-35B-A3B", "30B": "Qwen3-Coder-30B", "80B": "Qwen3-Next-80B" };
const terpakai = new Set(); // model yang benar-benar menjawab untuk tim yang sedang diperiksa
const MODEL_LABEL = () => `${[...terpakai].join(" + ") || "-"} · agen v${N.VERSI_AGEN}`;
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
const KONTEKS_HABIS = /exceeds? the (available )?context|context size|context length/i;
const GAMBAR_BESAR = "Gambar terlalu besar untuk dibaca model: cek manual.";
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

async function tanyaArmada({ prompt, format }, gambar, f) {
  const w = await pilihWorker(f);
  dipakai.set(w.host, (dipakai.get(w.host) || 0) + 1);
  try {
    const r = await f(`http://${w.host}:11434/api/chat`, {
      method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(180000),
      body: JSON.stringify({ model: CFG.model, stream: false, think: false, keep_alive: "60m", format, options: { temperature: 0 },
        messages: [{ role: "user", content: prompt, ...(gambar?.length ? { images: gambar.map((g) => g.toString("base64")) } : {}) }] }),
    });
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(j.error ? (typeof j.error === "string" ? j.error : JSON.stringify(j.error)) : `HTTP ${r.status}`);
    const h = JSON.parse(j.message.content);
    terpakai.add(CFG.model);
    return h;
  } catch (e) {
    // Gambar melebihi konteks model (4096 token di worker, 17 Nov TED-00015): bukan salah worker, jangan diistirahatkan.
    const konteks = KONTEKS_HABIS.test(e.message);
    if (!konteks) rehat.set(w.host, Date.now() + 5 * 60000);
    throw Object.assign(new Error(`${w.nama}: ${e.message}`), { konteks });
  } finally { dipakai.set(w.host, (dipakai.get(w.host) || 1) - 1); }
}

/* ── Pool GPU gabungan (broker /home/jot/rpc-broker) ──────────────────── */
let pool = { url: "", tag: "", siap: false, slot: 1, pada: 0, alasan: "" };
let poolRehat = 0; // pool baru saja gagal menjawab: jangan dipakai sampai waktu ini
const bacaPool = (n) => { try { return readFileSync(join(CFG.poolDir, n), "utf8").trim(); } catch { return ""; } };

/** Pool siap = kepala tercatat broker, model yang diizinkan, /health ok, dan bisa membaca gambar (mmproj). */
export async function cekPool(f = fetch, paksa = false) {
  if (!paksa && Date.now() - pool.pada < 15000 * TUNDA) return pool;
  const kepala = bacaPool("pool-head.txt"), tag = bacaPool("pool-model.txt");
  let url = "", siap = false, slot = pool.slot, alasan = "pool belum dirakit";
  if (/^100\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(kepala) && CFG.poolModel.includes(tag) && Date.now() >= poolRehat) {
    url = `http://${kepala}:8080`;
    alasan = "pool sedang memuat model";
    try {
      const h = await f(`${url}/health`, { signal: AbortSignal.timeout(6000) });
      if (h.ok && (await h.json()).status === "ok") {
        const pr = await (await f(`${url}/props`, { signal: AbortSignal.timeout(6000) })).json();
        slot = Math.max(1, Math.min(4, Number(pr?.total_slots) || 1));
        siap = pr?.modalities?.vision === true;
        if (!siap) alasan = "pool jalan tanpa mmproj (tidak bisa membaca gambar)";
      }
    } catch { /* belum siap */ }
  } else if (kepala && !CFG.poolModel.includes(tag)) alasan = `pool sedang memuat model lain (${tag || "?"})`;
  else if (Date.now() < poolRehat) alasan = "pool baru saja gagal menjawab";
  pool = { url, tag, siap, slot, pada: Date.now(), alasan: siap ? "" : alasan };
  return pool;
}

let laporTerakhir = 0;
/** Minta broker merakit / menahan pool (want-heavy + last-request), seperti Kawan Bicara. */
export function mintaPool() {
  if (!existsSync(CFG.poolDir)) return;
  // Pool sedang memuat model yang tidak kita pakai (mis. 30B coder untuk pemanggil lain): jangan ikut menahannya.
  if (bacaPool("pool-head.txt") && !CFG.poolModel.includes(bacaPool("pool-model.txt"))) return;
  try {
    if (!existsSync(join(CFG.poolDir, "want-heavy"))) writeFileSync(join(CFG.poolDir, "want-heavy"), "");
    if (Date.now() - laporTerakhir >= 30000 * TUNDA) {
      laporTerakhir = Date.now();
      writeFileSync(join(CFG.poolDir, "last-request"), Math.floor(Date.now() / 1000) + "\n");
    }
  } catch (e) { log("lapor broker gagal:", e.message); }
}

const mimeGambar = (b) => (b[0] === 0x89 && b[1] === 0x50 ? "image/png" : b.subarray(0, 4).toString() === "RIFF" ? "image/webp"
  : b.subarray(0, 3).toString() === "GIF" ? "image/gif" : "image/jpeg");

async function tanyaPool({ prompt, format }, gambar, f) {
  const isi = gambar?.length
    ? [{ type: "text", text: prompt }, ...gambar.map((g) => ({ type: "image_url", image_url: { url: `data:${mimeGambar(g)};base64,${g.toString("base64")}` } }))]
    : prompt;
  const r = await f(`${pool.url}/v1/chat/completions`, {
    method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(300000),
    body: JSON.stringify({ messages: [{ role: "user", content: isi }], temperature: 0, max_tokens: 600,
      response_format: { type: "json_schema", json_schema: { name: "hasil", schema: format } },
      chat_template_kwargs: { enable_thinking: false } }),
  });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { throw new Error(`pool HTTP ${r.status} bukan JSON`); }
  if (!r.ok) {
    const pesan = String(j?.error?.message || `HTTP ${r.status}`).slice(0, 160);
    // Gambar yang tak bisa dibuka model (mis. format aneh) = tetap: dicatat untuk admin, bukan dicoba ulang.
    if (r.status === 400 && /image|bitmap|media|decode/i.test(pesan)) throw Object.assign(new Error("Gambar tidak bisa dibuka model (format tidak didukung): cek manual."), { tetap: true });
    if (KONTEKS_HABIS.test(pesan)) throw Object.assign(new Error(GAMBAR_BESAR), { tetap: true });
    throw new Error(pesan);
  }
  const h = JSON.parse(j.choices[0].message.content);
  terpakai.add(`${NAMA_POOL[pool.tag] || pool.tag} (pool GPU)`);
  return h;
}

const statusBroker = () => bacaPool("status.txt").replace(/^\S+ \S+ \| /, "").slice(0, 120);

/** Satu pertanyaan + gambar → objek JSON sesuai skema.
 *  opsi.mesin: "pool" (menunggu pool), "pool+armada", atau "armada"; bawaan TEDNAS_MESIN (gabungan → armada).
 *  opsi.tunggu = false: pool belum siap / gagal → langsung lempar galat { poolTidakSiap } (dipakai mode gabungan). */
export async function tanyaModel(q, gambar, f = fetch, opsi = {}) {
  const mesin = opsi.mesin || (CFG.mesin === "gabungan" ? "armada" : CFG.mesin), boleh = opsi.tunggu !== false;
  let alasan = "", tunggu = 0;
  for (let gagal = 0; gagal < 4;) {
    if (mesin !== "armada") {
      mintaPool();
      const p = await cekPool(f);
      if (!p.siap && !boleh) throw Object.assign(new Error(`pool GPU belum siap: ${p.alasan}`), { poolTidakSiap: true });
      if (p.siap) {
        try { return await tanyaPool(q, gambar, f); }
        catch (e) {
          if (e.tetap) throw e;
          alasan = `pool: ${e.message}`; gagal++;
          log(`pool gagal menjawab (${gagal}/4): ${e.message}`);
          poolRehat = Date.now() + 60000 * TUNDA; pool.pada = 0;
          if (!boleh) throw Object.assign(new Error(alasan), { poolTidakSiap: true });
          continue;
        }
      }
      if (mesin === "pool") {
        if (tunggu++ % 20 === 0) log(`menunggu pool GPU: ${p.alasan}${statusBroker() ? ` · broker: ${statusBroker()}` : ""}`);
        await tidur(30000);
        continue;
      }
    }
    try { return await tanyaArmada(q, gambar, f); }
    catch (e) {
      // Konteks 9b habis: worker lain sama saja, jadi jangan diulang. Mode gabungan membaca berkas ini dengan 35B
      // (konteks pool 8192 per slot); mode armada mencatatnya untuk admin.
      if (e.konteks) throw Object.assign(new Error(GAMBAR_BESAR), { tetap: true, besar: true });
      alasan = e.message; gagal++;
    }
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

/* Versi yang disimpan di tednas_ai.versi (tanpa ubah database):
 *  VERSI_LENGKAP = pemeriksaan tuntas; VERSI_TUNDA = mode gabungan, ada berkas yang ditolak 9b tetapi pool GPU belum
 *  siap untuk membacanya ulang. Antrean diminta dengan VERSI_TUNDA selagi pool belum siap (tim tunda tidak diambil),
 *  dan dengan VERSI_LENGKAP begitu pool siap (tim tunda ikut diambil lagi, lalu dituntaskan). */
export const VERSI_LENGKAP = N.VERSI_AGEN * 10 + 1, VERSI_TUNDA = N.VERSI_AGEN * 10;
const KOLOM_BUTIR = { identitas: "dokumen_path", profil_ml: "profil_ml_path", follow_esports: "follow_esports_path", follow_ppdt: "follow_ppdt_path", izin: "izin_path" };

/** Berkas yang ditolak di tahap 9b dan layak dibaca ulang model besar: catatan "cek" atas BACAAN model, termasuk
 *  gambar yang terlalu besar untuk konteks 9b (bukan berkas hilang, tidak diunggah, atau berkas kembar). */
export function berkasUlang(t, n, baca, berkas) {
  const ulang = [];
  for (const p of n.rincian.pemain) {
    const kolom = new Set(p.butir.filter((b) => b.s === "cek" && !/^Berkas yang sama persis/.test(b.t)).map((b) => KOLOM_BUTIR[b.b]).filter(Boolean));
    for (const k of kolom) {
      const isi = baca[p.u]?.[KUNCI_BACA[k]];
      if (isi && (!isi.galat || isi.besar) && berkas[p.u]?.[k]) ulang.push({ u: p.u, kolom: k });
    }
  }
  return ulang;
}

export async function periksaTim(t, alat = {}) {
  const f = alat.fetch || fetch, pdf = alat.pdfKeGambar || pdfKeGambar;
  const mulai = Date.now();
  const baca = {}, sha = {}, berkas = {}; // berkas[u][kolom] = gambar (dipakai lagi di tahap 35B, hanya di memori)
  let sementara = null; // galat yang layak dicoba lagi (Web App / model)
  terpakai.clear();
  const gabungan = CFG.mesin === "gabungan", mesinA = gabungan ? "armada" : CFG.mesin;
  if (mesinA !== "armada") await cekPool(f);
  const paralel = (m) => (m === "armada" || (m === "pool+armada" && !pool.siap) ? CFG.paralel : Math.min(CFG.poolParalel, pool.slot));
  const tetap = (e) => /^PDF tidak bisa dibuka/.test(e.message) || e.tetap;
  const pemain = Object.fromEntries((t.pemain || []).map((p) => [p.urutan, p]));
  const umur = (u) => N.umurPada(N.lahirIdentitas(baca[u].identitas));

  // 1. Ambil semua berkas (Web App Drive).
  const ambil = [];
  for (const p of t.pemain || []) {
    baca[p.urutan] = {}; sha[p.urutan] = {}; berkas[p.urutan] = {};
    for (const kolom of KOLOM) {
      if (!p[kolom]) continue;
      ambil.push(async () => {
        try {
          const b = await ambilBerkas(p[kolom], f);
          if (b.tetap) { baca[p.urutan][KUNCI_BACA[kolom]] = { galat: b.tetap }; return; }
          sha[p.urutan][kolom] = createHash("sha256").update(b.data).digest("hex").slice(0, 32);
          berkas[p.urutan][kolom] = b; // PDF baru diubah ke gambar saat memang dibaca model (izin pemain dewasa tidak)
        } catch (e) {
          if (e.fatal) throw e;
          if (tetap(e)) baca[p.urutan][KUNCI_BACA[kolom]] = { galat: e.message }; else sementara = e.message;
        }
      });
    }
  }
  await berbarengan(ambil, 3);

  // Baca satu berkas dengan mesin m. Galat tetap (PDF rusak, gambar tak terbuka) dicatat; galat lain dilempar.
  const gambarDari = async (b) => (b.gambar ??= b.mime === "application/pdf" ? await pdf(b.data) : [b.data]);
  const bacaSatu = async (u, kolom, m) => {
    try { baca[u][KUNCI_BACA[kolom]] = await tanyaModel(pertanyaan(kolom, pemain[u]), await gambarDari(berkas[u][kolom]), f, { mesin: m, tunggu: !(gabungan && m === "pool") }); }
    catch (e) {
      if (e.fatal || e.poolTidakSiap) throw e;
      if (tetap(e)) baca[u][KUNCI_BACA[kolom]] = { galat: e.message, ...(e.besar ? { besar: true } : {}) }; else throw e;
    }
  };
  const jalankan = async (daftar, m) => {
    await berbarengan(daftar.map(({ u, kolom }) => async () => {
      try { await bacaSatu(u, kolom, m); } catch (e) { if (e.fatal || e.poolTidakSiap) throw e; sementara = e.message; }
    }), paralel(m));
  };

  // 2. Tahap A: semua berkas (surat izin hanya untuk pemain < 17 tahun, setelah identitas terbaca).
  const tahapA = Object.entries(berkas).flatMap(([u, b]) => Object.keys(b).filter((k) => k !== "izin_path").map((kolom) => ({ u: +u, kolom })));
  await jalankan(tahapA, mesinA);
  const perluIzin = () => Object.keys(berkas).map(Number).filter((u) => berkas[u].izin_path && !baca[u].izin && (umur(u) ?? 99) < N.UMUR_IZIN).map((u) => ({ u, kolom: "izin_path" }));
  await jalankan(perluIzin(), mesinA);
  let namaTim = null;
  try { namaTim = await tanyaModel(N.tanyaNamaTim(t.nama_tim), null, f, { mesin: mesinA }); } catch (e) { sementara = e.message; }

  const hasilAkhir = (n, versi, tambahan = {}) => {
    const identitas = n.identitas.map((x) => ({ ...x, nik: x.nik ? createHmac("sha256", CFG.kunci).update("nik:" + x.nik).digest("hex").slice(0, 32) : "" }));
    return { ...n, identitas, durasi: Date.now() - mulai, versi, ...tambahan };
  };
  if (sementara) return { hasil: "galat", ringkas: `Belum selesai diperiksa, dicoba lagi otomatis: ${sementara}`.slice(0, 500), rincian: {}, identitas: [], durasi: Date.now() - mulai, versi: VERSI_LENGKAP };
  let n = N.nilaiTim(t, baca, namaTim, sha);
  if (!gabungan) return hasilAkhir(n, VERSI_LENGKAP);

  // 3. Tahap B (gabungan): berkas yang ditolak 9b dibaca ulang Qwen3.6-35B di pool GPU; jawaban 35B yang dipakai.
  const ulang = berkasUlang(t, n, baca, berkas), ulangNama = !!(namaTim && namaTim.pantas === false);
  if (!ulang.length && !ulangNama) return hasilAkhir(n, VERSI_LENGKAP, { tahapB: 0 });
  const tunda = (alasan) => {
    log(`${t.kode}: ${ulang.length + (ulangNama ? 1 : 0)} berkas menunggu cek ulang model besar (${alasan})`);
    return hasilAkhir(n, VERSI_TUNDA, { tahapB: 0, ringkas: `Menunggu cek ulang model besar untuk ${ulang.length + (ulangNama ? 1 : 0)} berkas. ${n.ringkas}`.slice(0, 500),
      rincian: { ...n.rincian, tunggu: ulang.length + (ulangNama ? 1 : 0) } });
  };
  mintaPool();
  if (!(await cekPool(f)).siap) return tunda(pool.alasan || "pool GPU belum siap");
  try {
    await jalankan(ulang, "pool");
    // Umur bisa berubah setelah identitas dibaca ulang: surat izin yang kini wajib dibaca 35B juga.
    await jalankan(perluIzin(), "pool");
    if (ulangNama) namaTim = await tanyaModel(N.tanyaNamaTim(t.nama_tim), null, f, { mesin: "pool", tunggu: false });
  } catch (e) {
    if (e.fatal) throw e;
    return tunda(e.message);
  }
  if (sementara) return { hasil: "galat", ringkas: `Belum selesai diperiksa, dicoba lagi otomatis: ${sementara}`.slice(0, 500), rincian: {}, identitas: [], durasi: Date.now() - mulai, versi: VERSI_LENGKAP };
  n = N.nilaiTim(t, baca, namaTim, sha);
  return hasilAkhir(n, VERSI_LENGKAP, { tahapB: ulang.length + (ulangNama ? 1 : 0) });
}

async function simpan(t, h, f = fetch) {
  return rpc("tednas_ai_simpan", { p_kunci: CFG.kunci, p_tim: t.id, p_sidik: t.sidik, p_versi: h.versi ?? VERSI_LENGKAP, p_hasil: h.hasil,
    p_ringkas: h.ringkas, p_rincian: h.rincian, p_identitas: h.identitas, p_model: MODEL_LABEL(), p_durasi: h.durasi }, f);
}

/* ── Putaran ──────────────────────────────────────────────────────────── */
export async function putaran(alat = {}) {
  const f = alat.fetch || fetch;
  // Gabungan: selagi pool belum siap, tim yang menunggu cek ulang 35B tidak diambil (VERSI_TUNDA).
  const siap = CFG.mesin !== "gabungan" || (await cekPool(f)).siap;
  const a = await rpc("tednas_ai_antre", { p_kunci: CFG.kunci, p_versi: siap ? VERSI_LENGKAP : VERSI_TUNDA, p_batas: 1 }, f);
  if (!a.tim.length) {
    // Ada tim yang menunggu model besar → minta broker merakit pool.
    if (!siap && (await rpc("tednas_ai_antre", { p_kunci: CFG.kunci, p_versi: VERSI_LENGKAP, p_batas: 1 }, f)).sisa) mintaPool();
    return 0;
  }
  const t = a.tim[0];
  let h;
  try { h = await periksaTim(t, alat); }
  catch (e) {
    if (e.fatal) throw e;
    h = { hasil: "galat", ringkas: `Agen galat, dicoba lagi otomatis: ${e.message}`.slice(0, 500), rincian: {}, identitas: [], durasi: null };
  }
  const s = await simpan(t, h, f);
  const jalur = h.versi === VERSI_TUNDA ? " · menunggu 35B" : h.tahapB ? ` · ${h.tahapB} berkas dibaca ulang 35B` : "";
  log(`${t.kode}: ${h.hasil}${s && s.ok ? ` → ${s.akhir}${s.status ? ` (status: ${s.status})` : ""}` : ` (tidak disimpan: ${s && s.pesan})`}${jalur} · ${Math.round((h.durasi || 0) / 1000)} dtk · sisa ${Math.max(0, a.sisa - 1)}`);
  return a.sisa;
}

function cekKonfig() {
  const kurang = Object.entries({ TEDNAS_SUPABASE_URL: CFG.sb, TEDNAS_SUPABASE_KUNCI_PUBLIK: CFG.sbKunci, TEDNAS_DRIVE_URL: CFG.drive, TEDNAS_AI_KUNCI: CFG.kunci }).filter(([, v]) => !v).map(([k]) => k);
  if (kurang.length) { console.error("Lingkungan kurang: " + kurang.join(", ")); process.exit(2); }
  if (!/^[0-9a-f]{64}$/.test(CFG.kunci)) { console.error("TEDNAS_AI_KUNCI harus 64 hex"); process.exit(2); }
}

async function jalan(sekali) {
  cekKonfig();
  log(`agen AI TEDNas v${N.VERSI_AGEN} mulai · mesin ${CFG.mesin}${CFG.mesin !== "armada" ? ` (pool ${CFG.poolModel.join("/")}, paralel ${CFG.poolParalel})` : ""}${CFG.mesin !== "pool" ? ` · armada ${CFG.model} paralel ${CFG.paralel}` : ""}`);
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
