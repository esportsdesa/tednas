/**
 * Uji agen AI pemeriksa berkas (agen-ai/): aturan penilaian (nilai.mjs) dan alur agen (agen.mjs) melawan
 * Supabase, Web App Drive, pool GPU (broker + llama-server), LB, dan worker TIRUAN. Tidak memanggil model sungguhan.
 * Kontrak SQL-nya (tednas_ai_antre/simpan, status otomatis) diuji uji-sql.mjs; uji model sungguhan: agen.mjs --coba.
 *   node uji/uji-ai.mjs
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const KUNCI_AI = "d4".repeat(32);
const BROKER = mkdtempSync(join(tmpdir(), "tednas-broker-"));
process.on("exit", () => rmSync(BROKER, { recursive: true, force: true }));
Object.assign(process.env, {
  TEDNAS_SUPABASE_URL: "https://sb.tiruan", TEDNAS_SUPABASE_KUNCI_PUBLIK: "sb_publishable_uji",
  TEDNAS_DRIVE_URL: "https://script.google.com/macros/s/AKfycbAIuji0123456789abcdefghijk/exec",
  TEDNAS_AI_KUNCI: KUNCI_AI, TEDNAS_LB_URL: "http://127.0.0.1:11435", TEDNAS_PARALEL: "3", TEDNAS_TUNDA_KALI: "0",
  TEDNAS_MESIN: "armada", TEDNAS_POOL_DIR: BROKER, // uji pool di bagian akhir mengganti A.CFG.mesin
});
const N = await import("../agen-ai/nilai.mjs");
const A = await import("../agen-ai/agen.mjs");

let lulus = 0;
const uji = async (nama, f) => { try { await f(); lulus++; } catch (e) { console.error(`GAGAL: ${nama}\n`, e); process.exit(1); } };

/* ── aturan ───────────────────────────────────────────────────────────── */
await uji("nama terdaftar vs nama di dokumen", () => {
  const ya = [["Budi Santoso", "BUDI SANTOSO"], ["Budi", "BUDI SANTOSO"], ["Muhammad Rizky", "MUH RIZKI"], ["M. Fajar", "MUHAMMAD FAJAR"],
    ["Rizky Ramadhan", "RISKY RAMADAN"], ["Adi", "ADI PRATAMA"], ["Moch Ilham Akbar", "MOCHAMMAD ILHAM AKBAR"], ["Dewi Sartika", "dewi  sartika"]];
  const tidak = [["Siti Aminah", "BUDI SANTOSO"], ["Adi", "ADITYA PRATAMA"], ["Budi Santoso", "BUDI"], ["Andi", ""], ["Rudi Hartono", "BUDI HARTONO WIJAYA"]];
  for (const [a, b] of ya) assert.equal(N.namaCocok(a, b), true, `${a} ~ ${b}`);
  for (const [a, b] of tidak.slice(0, 2)) assert.equal(N.namaCocok(a, b), false, `${a} ≠ ${b}`);
  assert.equal(N.namaCocok("Budi Santoso", "BUDI"), true, "nama dokumen lebih pendek = bagian nama terdaftar");
  assert.equal(N.namaCocok("Andi", ""), false);
  assert.equal(N.namaCocok("Rudi Hartono", "BUDI HARTONO WIJAYA"), false, "Rudi ≠ Budi (kata 4 huruf harus persis)");
  // inisial (hasil nyata pertama, 16 Nov)
  assert.equal(N.namaCocok("Muhammad Alif A.", "MUHAMMAD ALIF AZIZI"), true, "inisial di nama terdaftar");
  assert.equal(N.namaCocok("Muhammad Misbachul Umam", "MUHAMMAD MISBACHUL U."), true, "inisial di dokumen");
  assert.equal(N.namaCocok("Nizam Fatih Abarra A.", "MUHAMMAD MISBACHUL U."), false);
  assert.equal(N.namaCocok("A. B.", "ANDI BUDI"), false, "inisial saja tidak cukup");
  assert.equal(N.namaCocok("Arya Rajasa D.", "SURYA NARENDRA S. B."), false);
});

await uji("umur per 15 Jan 2027, tanggal lahir dari NIK", () => {
  assert.equal(N.umurPada("2008-06-05"), 18);
  assert.equal(N.umurPada("2012-01-15"), 15); assert.equal(N.umurPada("2012-01-16"), 14);
  assert.equal(N.umurPada("1996-01-16"), 30); assert.equal(N.umurPada("1996-01-15"), 31);
  assert.equal(N.umurPada("2010-02-30"), null); assert.equal(N.umurPada("05-06-2008"), null);
  assert.equal(N.lahirDariNik("3507184506080003"), "2008-06-05", "perempuan: tanggal + 40");
  assert.equal(N.lahirDariNik("3507181201990001"), "1999-01-12");
  assert.equal(N.lahirDariNik("3507 1812 0199 0001"), "1999-01-12");
  assert.equal(N.lahirDariNik("12345"), null);
  assert.equal(N.samarkanNik("3507184506080003"), "3507********0003");
});

await uji("wilayah: provinsi domisili dari kabupaten/kota (514) atau tulisan provinsi", () => {
  const d = (kab, prov) => N.domisili({ kabupaten_kota: kab, provinsi: prov });
  assert.deepEqual(d("KABUPATEN MALANG", "JAWA TIMUR"), { prov: "35", kab: "35.07", pemekaran: false });
  assert.deepEqual(d("KOTA MALANG", ""), { prov: "35", kab: "35.73", pemekaran: false }, "kota juga dikenal");
  assert.deepEqual(d("MALANG", ""), { prov: "35", kab: null, pemekaran: false }, "Kab/Kota Malang: provinsi pasti, kabupaten tidak");
  assert.deepEqual(d("KAB. MERAUKE", "PAPUA"), { prov: "93", kab: "93.01", pemekaran: true }, "KTP lama sebelum pemekaran");
  assert.equal(d("", "D.I. YOGYAKARTA").prov, "34"); assert.equal(d("", "NTB").prov, "52"); assert.equal(d("", "PROVINSI JAWA BRAT").prov, "32");
  assert.equal(d("BANJAR", "").prov, null, "Kota Banjar (Jabar) vs Kabupaten Banjar (Kalsel)");
  assert.equal(d("BANJAR", "KALIMANTAN SELATAN").kab, "63.03");
  assert.equal(d("KOTA BANJAR", "").prov, "32");
  assert.equal(d("JAKARTA SELATAN", "DKI JAKARTA").prov, "31");
  assert.equal(d("KABUPATEN MALANGG", "").kab, "35.07", "salah baca 1 huruf");
  assert.equal(d("", "").prov, null);
  assert.equal(N.kodeProvinsi("PAPUA BARAT DAYA"), "96"); assert.equal(N.kodeProvinsi("PAPUA BARAT"), "92"); assert.equal(N.kodeProvinsi("PAPUA"), "91");
});

/* ── tim tiruan ───────────────────────────────────────────────────────── */
const TIM = {
  kode: "TED-00777", id: "11111111-2222-3333-4444-555555555555", sidik: "a".repeat(32), nama_tim: "Mangliawan Esports",
  prov_kode: "35", provinsi: "Jawa Timur", kab_kode: "35.07", desa: "Mangliawan", kecamatan: "Pakis", kabupaten: "Kabupaten Malang", status: "menunggu",
  pemain: [1, 2, 3, 4, 5].map((u) => ({
    urutan: u, nama: ["Budi Santoso", "Siti Aminah", "Rizky Ramadhan", "Dewi Lestari", "Agus Salim"][u - 1], dokumen_jenis: "KTP",
    dokumen_path: `gdrive/IDENTITAS-${u}0000.jpg`, profil_ml_path: `gdrive/PROFILML-${u}0000.png`,
    follow_esports_path: `gdrive/FOLLOWESP-${u}000.jpg`, follow_ppdt_path: `gdrive/FOLLOWPPDT-${u}000.jpg`, izin_path: null,
  })),
};
const NIK = ["3507181201000001", "3507184506080003", "3507180303010002", "3507186607020004", "3507180909990005"];
const bacaBaik = (p, i) => ({
  identitas: { jenis_dokumen: "KTP", terbaca: true, nama: p.nama.toUpperCase(), nik: NIK[i], tanggal_lahir: N.lahirDariNik(NIK[i]), alamat_dari: "pemilik",
    desa_kelurahan: "MANGLIAWAN", kecamatan: "PAKIS", kabupaten_kota: "KABUPATEN MALANG", provinsi: "JAWA TIMUR", sekolah: "" },
  profil_ml: { profil_mlbb: true, nickname: `nick${i}`, id_akun: `48291375${i}`, server: "12045" },
  follow_esports_path: { instagram: true, akun_terlihat: true, username_profil: "esportsdesa.official", status: "mengikuti" },
  follow_ppdt_path: { instagram: true, akun_terlihat: true, username_profil: "ditjen_ppdt", status: "mengikuti" },
});
const salin = (x) => JSON.parse(JSON.stringify(x));

await uji("nilaiTim: semua sesuai → lolos", () => {
  const baca = Object.fromEntries(TIM.pemain.map((p, i) => [p.urutan, bacaBaik(p, i)]));
  // pemain 2 lahir 2008 → 18 th; tidak perlu izin
  const n = N.nilaiTim(TIM, baca, { pantas: true, alasan: "" }, {});
  assert.equal(n.hasil, "lolos", n.ringkas);
  assert.match(n.ringkas, /^Semua sesuai/);
  assert.equal(n.rincian.pemain[1].data.nik, "3507********0003");
  assert.equal(JSON.stringify(n.rincian).includes("3507184506080003"), false, "NIK asli tidak masuk rincian");
  assert.equal(n.identitas[0].nik, NIK[0], "NIK mentah hanya untuk di-HMAC agen");
  assert.equal(n.identitas[0].ml, "482913750(12045)");
});

await uji("nilaiTim: tiap pelanggaran jadi catatan 'cek' yang terbaca admin", () => {
  const t = salin(TIM);
  const baca = Object.fromEntries(t.pemain.map((p, i) => [p.urutan, bacaBaik(p, i)]));
  baca[1].identitas.tanggal_lahir = "2011-03-01"; baca[1].identitas.nik = "";            // 15 th, tanpa izin
  baca[2].follow_ppdt_path.status = "belum_mengikuti";
  Object.assign(baca[3].identitas, { kabupaten_kota: "KABUPATEN SLEMAN", provinsi: "DAERAH ISTIMEWA YOGYAKARTA" }); // beda provinsi
  baca[4].identitas.nama = "AGUS SALIMUDIN WIJAYA KUSUMA";                               // nama dokumen lain
  baca[5].identitas.tanggal_lahir = "1990-01-01"; baca[5].identitas.nik = "";            // 37 th
  baca[5].profil_ml = { profil_mlbb: false, nickname: "", id_akun: "", server: "" };
  const n = N.nilaiTim({ ...t, nama_tim: "Garuda Esports" }, baca, { pantas: true, alasan: "" },
    { 3: { follow_esports_path: "x1", follow_ppdt_path: "x1" } });
  assert.equal(n.hasil, "cek");
  assert.ok(n.ringkas.length <= 500 && n.ringkas.startsWith("7 catatan:"), n.ringkas.slice(0, 40));
  const semua = [...n.rincian.tim.filter((b) => b.s === "cek").map((b) => b.t),
    ...n.rincian.pemain.flatMap((p) => p.butir.filter((b) => b.s === "cek").map((b) => `P${p.u} ${p.nama}: ${b.t}`))].join(" · ");
  for (const pola of [/P1 Budi Santoso: Umur 15 tahun: surat izin/, /P2 Siti Aminah: .*@ditjen_ppdt BELUM diikuti/,
    /P4 Dewi Lestari: Nama di dokumen "AGUS SALIMUDIN WIJAYA KUSUMA" tidak sama dengan nama terdaftar "Dewi Lestari"/,
    /P3 Rizky Ramadhan: Domisili di Daerah Istimewa Yogyakarta, sedangkan tim mewakili Jawa Timur\. Pemain satu tim harus satu provinsi/, /P5 Agus Salim: Umur 37/, /P5 Agus Salim: Bukan tangkapan layar profil/,
    /P3 Rizky Ramadhan: Berkas yang sama persis diunggah untuk follow @esportsdesa.official dan follow @ditjen_ppdt/]) {
    assert.match(semua, pola);
  }
  assert.equal(N.namaCocok("Agus Salim", "AGUS SALIMUDIN WIJAYA KUSUMA"), true, "Salim ⊂ Salimudin (awalan) diterima");
});

await uji("nilaiTim: izin diperiksa bila < 17; berkas lama = cek; kartu pelajar tanpa alamat = cek", () => {
  const t = salin(TIM);
  t.pemain[0].izin_path = "gdrive/IZIN-10000000.pdf";
  t.pemain[1].dokumen_path = "dokumen/lama.jpg";
  const baca = Object.fromEntries(t.pemain.map((p, i) => [p.urutan, bacaBaik(p, i)]));
  baca[1].identitas.tanggal_lahir = "2011-03-01"; baca[1].identitas.nik = "";
  baca[1].izin = { surat_izin: true, nama_anak: "Budi Santoso", nama_ortu: "Slamet", ada_tanda_tangan: true };
  baca[2].identitas = { galat: "Berkas masih di penyimpanan lama (Supabase): cek manual." };
  Object.assign(baca[3].identitas, { jenis_dokumen: "Kartu Pelajar", alamat_dari: "tidak_ada", desa_kelurahan: "", kecamatan: "", kabupaten_kota: "", provinsi: "", nik: "", tanggal_lahir: "2009-07-07" });
  t.pemain[2].dokumen_jenis = "Kartu Pelajar";
  const n = N.nilaiTim(t, baca, null, {});
  const p = (u) => n.rincian.pemain.find((x) => x.u === u).butir;
  assert.ok(p(1).some((b) => b.b === "izin" && b.s === "ok"), "izin ok");
  assert.ok(p(2).some((b) => b.s === "cek" && /penyimpanan lama/.test(b.t)));
  assert.ok(p(3).some((b) => b.s === "cek" && /Kartu Pelajar tanpa alamat yang terbaca: provinsi domisili perlu dicek manual/.test(b.t)), JSON.stringify(p(3)));
  assert.equal(n.hasil, "cek");
  baca[1].izin.ada_tanda_tangan = false;
  assert.ok(N.nilaiTim(t, baca, null, {}).rincian.pemain[0].butir.some((b) => b.b === "izin" && /tanpa tanda tangan/.test(b.t)));
});

await uji("nilaiTim: identitas apa pun yang memuat alamat; satu provinsi cukup, beda kabupaten = info", () => {
  const baca = Object.fromEntries(TIM.pemain.map((p, i) => [p.urutan, bacaBaik(p, i)]));
  Object.assign(baca[1].identitas, { kabupaten_kota: "KOTA MALANG", desa_kelurahan: "LOWOKWARU" });               // kota, satu provinsi
  Object.assign(baca[2].identitas, { jenis_dokumen: "KIA", kabupaten_kota: "KABUPATEN PASURUAN" });               // KIA, kab lain
  Object.assign(baca[3].identitas, { jenis_dokumen: "Kartu Pelajar", alamat_dari: "sekolah", nik: "", kabupaten_kota: "KAB. BLITAR", provinsi: "" });
  Object.assign(baca[4].identitas, { jenis_dokumen: "lain", kabupaten_kota: "", provinsi: "JATIM" });               // identitas lain, provinsi saja
  const n = N.nilaiTim(TIM, baca, { pantas: true, alasan: "" }, {});
  assert.equal(n.hasil, "lolos", n.ringkas);
  const p = (u) => n.rincian.pemain.find((x) => x.u === u);
  assert.ok(p(1).butir.some((b) => b.s === "info" && /Domisili di Kota Malang, tim di Kabupaten Malang \(masih satu provinsi\)/.test(b.t)));
  assert.ok(p(2).butir.some((b) => b.s === "ok" && /^KIA sesuai/.test(b.t)));
  assert.ok(p(3).butir.some((b) => b.s === "info" && /alamat sekolah/.test(b.t)));
  assert.equal(p(4).data.dok, "Identitas lain"); assert.equal(p(4).data.prov, "Jawa Timur");
  const b2 = salin(baca); b2[5].identitas.jenis_dokumen = "bukan_identitas";
  assert.match(N.nilaiTim(TIM, b2, null, {}).ringkas, /P5 Agus Salim: Berkas identitas bukan dokumen identitas/);
  const b3 = salin(baca); b3[5].identitas.provinsi = "JAWA TENGAH"; b3[5].identitas.kabupaten_kota = "KAB. SEMARANG";
  assert.match(N.nilaiTim(TIM, b3, null, {}).ringkas, /P5 Agus Salim: Domisili di Jawa Tengah, sedangkan tim mewakili Jawa Timur/);
  assert.equal(N.nilaiTim({ ...TIM, nama_tim: "Garuda Squad" }, baca, { pantas: true, alasan: "" }, {}).hasil, "lolos", "nama tim bebas");
  assert.match(N.nilaiTim(TIM, baca, { pantas: false, alasan: "kata kasar" }, {}).ringkas, /Nama tim mungkin mengandung SARA/);
});

/* ── alur agen dengan dunia tiruan ─────────────────────────────────────── */
function dunia({ tim = TIM, ubah = () => {}, webApp = null, worker = null } = {}) {
  const catat = { simpan: [], webapp: [], model: [], url: [] };
  const baca = Object.fromEntries(tim.pemain.map((p, i) => [p.urutan, bacaBaik(p, i)]));
  ubah(baca);
  const isiBerkas = (path) => Buffer.from(`BERKAS|${path}`);
  const jawab = (o, status = 200) => new Response(typeof o === "string" ? o : JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
  let antre = [tim];
  const f = async (url, opt = {}) => {
    catat.url.push(url);
    const isi = opt.body ? JSON.parse(opt.body) : null;
    if (url === "https://sb.tiruan/rest/v1/rpc/tednas_ai_antre") {
      assert.equal(isi.p_kunci, KUNCI_AI); assert.equal(opt.headers.apikey, "sb_publishable_uji");
      return jawab({ tim: antre.slice(0, isi.p_batas), sisa: antre.length });
    }
    if (url === "https://sb.tiruan/rest/v1/rpc/tednas_ai_simpan") { catat.simpan.push(isi); antre = []; return jawab({ ok: true, akhir: isi.p_hasil, ganda: [], terkait: 0 }); }
    if (url === process.env.TEDNAS_DRIVE_URL) {
      catat.webapp.push(isi);
      if (webApp) { const r = webApp(isi, catat); if (r) return r; }
      return jawab({ ok: true, mime: isi.path.endsWith(".pdf") ? "application/pdf" : "image/jpeg", nama: "x", data: isiBerkas(isi.path).toString("base64") });
    }
    if (url === "http://127.0.0.1:11435/lb/keadaan") return jawab({ worker: [
      { nama: "w1", host: "100.64.0.1", sehat: true, hangat: true, muatan: 0 }, { nama: "w2", host: "100.64.0.2", sehat: true, hangat: true, muatan: 0 },
      { nama: "dingin", host: "100.64.0.3", sehat: true, hangat: false, muatan: 0 }, { nama: "lokal", host: "127.0.0.1", sehat: true, hangat: true, muatan: 0 }] });
    const m = /^http:\/\/(100\.64\.0\.\d):11434\/api\/chat$/.exec(url);
    if (m) {
      catat.model.push({ host: m[1], ...isi });
      if (worker) { const r = worker(m[1], isi); if (r) return r; }
      assert.equal(isi.think, false); assert.equal(isi.stream, false); assert.ok(isi.format && isi.format.properties, "format JSON schema");
      const g = isi.messages[0].images ? Buffer.from(isi.messages[0].images[0], "base64").toString() : "";
      let isiJawab;
      if (!g) isiJawab = { pantas: true, alasan: "" };
      else {
        const path = g.split("|")[1], p = tim.pemain.find((x) => Object.values(x).includes(path));
        const k = { dokumen_path: "identitas", profil_ml_path: "profil_ml", follow_esports_path: "follow_esports_path", follow_ppdt_path: "follow_ppdt_path", izin_path: "izin" }[Object.keys(p).find((x) => p[x] === path)];
        isiJawab = baca[p.urutan][k];
      }
      return jawab({ message: { content: JSON.stringify(isiJawab) } });
    }
    throw new Error("alamat tak terduga: " + url);
  };
  return { f, catat, pdfKeGambar: async (buf) => [Buffer.concat([buf])] };
}

await uji("agen: satu putaran → berkas lewat kunci AI, model langsung ke worker hangat, hasil lolos tersimpan, NIK di-HMAC", async () => {
  const W = dunia();
  const sisa = await A.putaran({ fetch: W.f, pdfKeGambar: W.pdfKeGambar });
  assert.equal(sisa, 1);
  assert.equal(W.catat.simpan.length, 1);
  const s = W.catat.simpan[0];
  assert.equal(s.p_hasil, "lolos", s.p_ringkas);
  assert.equal(s.p_tim, TIM.id); assert.equal(s.p_sidik, TIM.sidik); assert.equal(s.p_versi, N.VERSI_AGEN);
  assert.equal(W.catat.webapp.length, 20, "5 pemain × 4 berkas");
  assert.ok(W.catat.webapp.every((x) => x.aksi === "berkas" && x.kunci_ai === KUNCI_AI && !x.token));
  assert.equal(W.catat.model.length, 21, "20 berkas + 1 nama tim");
  assert.ok(W.catat.model.every((x) => x.host === "100.64.0.1" || x.host === "100.64.0.2"), "hanya worker hangat, bukan 127.0.0.1/dingin");
  assert.ok(!W.catat.url.some((u) => /11435\/api\//.test(u) || /127\.0\.0\.1:11434/.test(u)), "tidak pernah lewat LB / Ollama dapur");
  const kirim = JSON.stringify(s);
  for (const nik of NIK) assert.equal(kirim.includes(nik), false, "NIK asli tidak dikirim ke Supabase");
  assert.equal(s.p_identitas[0].nik, createHmac("sha256", KUNCI_AI).update("nik:" + NIK[0]).digest("hex").slice(0, 32));
  assert.equal(s.p_identitas[0].sha.length, 3, "sidik lintas tim hanya profil ML + 2 bukti follow, bukan foto identitas");
  assert.equal(s.p_model, `qwen3.5:9b · agen v${N.VERSI_AGEN}`);
  assert.equal(existsSync(join(BROKER, "want-heavy")), false, "mesin armada tidak meminta pool");
  assert.equal(await A.putaran({ fetch: W.f }), 0, "antrean kosong");
});

await uji("agen: surat izin hanya dibaca untuk pemain < 17; PDF lewat pdfKeGambar", async () => {
  const t = salin(TIM);
  t.pemain[0].izin_path = "gdrive/IZIN-1000000000.pdf"; t.pemain[2].izin_path = "gdrive/IZIN-3000000000.pdf";
  const W = dunia({ tim: t, ubah: (b) => {
    b[1].identitas.tanggal_lahir = "2011-03-01"; b[1].identitas.nik = "";
    b[1].izin = { surat_izin: true, nama_anak: "BUDI SANTOSO", nama_ortu: "SLAMET", ada_tanda_tangan: true };
  } });
  let pdf = 0;
  await A.putaran({ fetch: W.f, pdfKeGambar: async (buf) => { pdf++; return [buf]; } });
  const s = W.catat.simpan[0];
  assert.equal(s.p_hasil, "lolos", s.p_ringkas);
  assert.equal(pdf, 1, "izin pemain 3 (dewasa) tidak dibaca model");
  assert.equal(W.catat.webapp.length, 22, "kedua izin tetap diambil untuk sidik berkas");
  assert.ok(s.p_rincian.pemain[0].butir.some((b) => b.b === "izin" && b.s === "ok"));
});

await uji("agen: worker gagal → pindah worker; Web App sibuk → dicoba ulang", async () => {
  let gagalW1 = 0, sibuk = 0;
  const W = dunia({
    worker: (host) => (host === "100.64.0.1" ? (gagalW1++, new Response("{\"error\":\"model runner has unexpectedly stopped\"}", { status: 500 })) : null),
    webApp: (isi) => (isi.path.includes("PROFILML-1") && sibuk++ < 2 ? new Response("<html><title>Error</title></html>", { status: 200 }) : null),
  });
  await A.putaran({ fetch: W.f, pdfKeGambar: W.pdfKeGambar });
  assert.equal(W.catat.simpan[0].p_hasil, "lolos", W.catat.simpan[0].p_ringkas);
  assert.ok(gagalW1 >= 1, "w1 sempat gagal"); assert.equal(sibuk, 3, "dua kali sibuk, percobaan ketiga berhasil");
  assert.ok(W.catat.model.filter((x) => x.host === "100.64.0.1").length === gagalW1, "w1 diistirahatkan setelah gagal");
});

await uji("agen: berkas hilang = catatan cek; Web App terus gagal = galat (dicoba lagi otomatis); kunci AI ditolak = berhenti", async () => {
  const W1 = dunia({ webApp: (isi) => (isi.path.includes("FOLLOWESP-2") ? new Response(JSON.stringify({ ok: false, pesan: "BERKAS_TIDAK_ADA" })) : null) });
  await A.putaran({ fetch: W1.f, pdfKeGambar: W1.pdfKeGambar });
  assert.equal(W1.catat.simpan[0].p_hasil, "cek");
  assert.match(W1.catat.simpan[0].p_ringkas, /P2 Siti Aminah: Berkas tidak ditemukan di Drive/);

  const W2 = dunia({ webApp: (isi) => (isi.path.includes("PROFILML-3") ? new Response(JSON.stringify({ ok: false, pesan: "SIBUK", ulang: true })) : null) });
  await A.putaran({ fetch: W2.f, pdfKeGambar: W2.pdfKeGambar });
  assert.equal(W2.catat.simpan[0].p_hasil, "galat");
  assert.match(W2.catat.simpan[0].p_ringkas, /dicoba lagi otomatis/);
  assert.deepEqual(W2.catat.simpan[0].p_identitas, []);

  const W3 = dunia({ webApp: () => new Response(JSON.stringify({ ok: false, pesan: "BUKAN_ADMIN" })) });
  await assert.rejects(A.putaran({ fetch: W3.f, pdfKeGambar: W3.pdfKeGambar }), /menolak kunci AI/);
  assert.equal(W3.catat.simpan.length, 0, "tidak menyimpan galat palsu bila kunci salah pasang");
});

/* ── pool GPU (bawaan produksi) ────────────────────────────────────────── */
const KEPALA = "100.92.177.120";
function duniaPool({ visi = true, chat = null, ...o } = {}) {
  const W = dunia(o), asli = W.f;
  writeFileSync(join(BROKER, "pool-head.txt"), KEPALA + "\n"); writeFileSync(join(BROKER, "pool-model.txt"), "35B\n");
  W.catat.pool = []; W.catat.puncak = 0;
  let jalan = 0;
  const baca = Object.fromEntries((o.tim || TIM).pemain.map((p, i) => [p.urutan, bacaBaik(p, i)]));
  if (o.ubah) o.ubah(baca);
  const jawab = (x, status = 200) => new Response(JSON.stringify(x), { status, headers: { "content-type": "application/json" } });
  W.f = async (url, opt = {}) => {
    if (url === `http://${KEPALA}:8080/health`) return jawab({ status: "ok" });
    if (url === `http://${KEPALA}:8080/props`) return jawab({ total_slots: 4, modalities: { vision: visi, audio: false } });
    if (url === `http://${KEPALA}:8080/v1/chat/completions`) {
      const isi = JSON.parse(opt.body);
      W.catat.pool.push(isi);
      W.catat.puncak = Math.max(W.catat.puncak, ++jalan);
      try {
        await new Promise((ok) => setTimeout(ok, 2));
        if (chat) { const r = chat(isi); if (r) return r; }
        assert.equal(isi.temperature, 0); assert.deepEqual(isi.chat_template_kwargs, { enable_thinking: false });
        assert.equal(isi.response_format.type, "json_schema"); assert.ok(isi.response_format.json_schema.schema.properties);
        const c = isi.messages[0].content;
        let hasil;
        if (typeof c === "string") hasil = { pantas: true, alasan: "" };
        else {
          const u = c.find((x) => x.type === "image_url").image_url.url;
          assert.match(u, /^data:image\/jpeg;base64,/);
          const path = Buffer.from(u.split(",")[1], "base64").toString().split("|")[1];
          const p = (o.tim || TIM).pemain.find((x) => Object.values(x).includes(path));
          const k = { dokumen_path: "identitas", profil_ml_path: "profil_ml", follow_esports_path: "follow_esports_path", follow_ppdt_path: "follow_ppdt_path", izin_path: "izin" }[Object.keys(p).find((x) => p[x] === path)];
          hasil = baca[p.urutan][k];
        }
        return jawab({ choices: [{ message: { content: JSON.stringify(hasil) } }] });
      } finally { jalan--; }
    }
    return asli(url, opt);
  };
  return W;
}
const mesin = (m) => { A.CFG.mesin = m; for (const n of ["want-heavy", "last-request", "pool-head.txt", "pool-model.txt"]) rmSync(join(BROKER, n), { force: true }); };

await uji("pool: model 35B di pool GPU, broker diminta pool, paralel ≤ 2, tanpa worker armada", async () => {
  mesin("pool");
  const W = duniaPool();
  await A.putaran({ fetch: W.f, pdfKeGambar: W.pdfKeGambar });
  const s = W.catat.simpan[0];
  assert.equal(s.p_hasil, "lolos", s.p_ringkas);
  assert.equal(W.catat.pool.length, 21, "20 berkas + nama tim");
  assert.equal(W.catat.model.length, 0, "armada tidak dipakai");
  assert.ok(W.catat.puncak <= 2 && W.catat.puncak >= 1, `paralel ${W.catat.puncak}`);
  assert.equal(s.p_model, `Qwen3.6-35B-A3B (pool GPU) · agen v${N.VERSI_AGEN}`);
  assert.ok(existsSync(join(BROKER, "want-heavy")), "want-heavy dinyalakan");
  assert.ok(Math.abs(Number(readFileSync(join(BROKER, "last-request"), "utf8")) - Date.now() / 1000) < 30, "last-request diperbarui");
});

await uji("pool: tanpa mmproj = belum siap (pool+armada pakai 9b); gambar tak terbaca model = catatan cek; pool galat terus = galat", async () => {
  mesin("pool+armada");
  const W1 = duniaPool({ visi: false });
  await A.putaran({ fetch: W1.f, pdfKeGambar: W1.pdfKeGambar });
  assert.equal(W1.catat.pool.length, 0, "pool tanpa penglihatan tidak dipakai");
  assert.equal(W1.catat.model.length, 21); assert.equal(W1.catat.simpan[0].p_hasil, "lolos");

  mesin("pool");
  const W2 = duniaPool({ chat: (isi) => (JSON.stringify(isi).includes(Buffer.from("BERKAS|gdrive/PROFILML-2").toString("base64").slice(0, 20))
    ? new Response(JSON.stringify({ error: { code: 400, message: "failed to load image or audio file" } }), { status: 400 }) : null) });
  await A.putaran({ fetch: W2.f, pdfKeGambar: W2.pdfKeGambar });
  assert.equal(W2.catat.simpan[0].p_hasil, "cek");
  assert.match(W2.catat.simpan[0].p_ringkas, /P2 Siti Aminah: Gambar tidak bisa dibuka model/);

  mesin("pool");
  const W3 = duniaPool({ chat: () => new Response(JSON.stringify({ error: { message: "slot unavailable" } }), { status: 503 }) });
  await A.putaran({ fetch: W3.f, pdfKeGambar: W3.pdfKeGambar });
  assert.equal(W3.catat.simpan[0].p_hasil, "galat");
  assert.match(W3.catat.simpan[0].p_ringkas, /model gagal 4 kali \(pool: slot unavailable\)/);
});

await uji("pool: belum dirakit → agen menunggu sambil meminta pool, lanjut begitu pool siap", async () => {
  mesin("pool");
  const W = duniaPool();
  rmSync(join(BROKER, "pool-head.txt"));
  let dimintaDulu = null;
  const broker = setTimeout(() => { // "broker" selesai merakit pool sesudah agen sempat menunggu
    dimintaDulu = existsSync(join(BROKER, "want-heavy"));
    writeFileSync(join(BROKER, "pool-head.txt"), KEPALA);
  }, 80);
  await A.putaran({ fetch: W.f, pdfKeGambar: W.pdfKeGambar });
  clearTimeout(broker);
  assert.equal(dimintaDulu, true, "want-heavy dinyalakan selagi menunggu");
  assert.equal(W.catat.simpan[0].p_hasil, "lolos", W.catat.simpan[0].p_ringkas);
  assert.equal(W.catat.pool.length, 21);
});

console.log(`${lulus} uji agen AI lulus`);
process.exit(0);
