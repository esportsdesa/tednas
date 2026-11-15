/**
 * Uji agen AI pemeriksa berkas (agen-ai/): aturan penilaian (nilai.mjs) dan alur agen (agen.mjs) melawan
 * Supabase, Web App Drive, LB, dan worker TIRUAN. Tidak memanggil model sungguhan.
 * Kontrak SQL-nya (tednas_ai_antre/simpan) diuji uji-sql.mjs; uji model sungguhan: agen.mjs --coba.
 *   node uji/uji-ai.mjs
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

const KUNCI_AI = "d4".repeat(32);
Object.assign(process.env, {
  TEDNAS_SUPABASE_URL: "https://sb.tiruan", TEDNAS_SUPABASE_KUNCI_PUBLIK: "sb_publishable_uji",
  TEDNAS_DRIVE_URL: "https://script.google.com/macros/s/AKfycbAIuji0123456789abcdefghijk/exec",
  TEDNAS_AI_KUNCI: KUNCI_AI, TEDNAS_LB_URL: "http://127.0.0.1:11435", TEDNAS_PARALEL: "3", TEDNAS_TUNDA_KALI: "0",
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

await uji("wilayah: Kota ≠ Kabupaten, awalan diabaikan, nama tim memuat desa", () => {
  assert.equal(N.wilayahSama("KABUPATEN MALANG", "Kabupaten Malang", "kab"), true);
  assert.equal(N.wilayahSama("KAB. MALANG", "Kabupaten Malang", "kab"), true);
  assert.equal(N.wilayahSama("MALANG", "Kabupaten Malang", "kab"), true);
  assert.equal(N.wilayahSama("KOTA MALANG", "Kabupaten Malang", "kab"), false);
  assert.equal(N.wilayahSama("KABUPATEN PASURUAN", "Kabupaten Malang", "kab"), false);
  assert.equal(N.wilayahSama("", "Kabupaten Malang", "kab"), null);
  assert.equal(N.wilayahSama("DESA MANGLIAWAN", "Mangliawan"), true);
  assert.equal(N.wilayahSama("MANGLIAWAM", "Mangliawan"), true, "salah baca 1 huruf");
  assert.equal(N.wilayahSama("PAKISJAJAR", "Pakis"), true, "kata yang memuat (≥5 huruf)");
  assert.equal(N.namaTimMemuatDesa("Mangliawan Esports", "Mangliawan"), true);
  assert.equal(N.namaTimMemuatDesa("MANGLI AWAN SQUAD", "Mangliawan"), true);
  assert.equal(N.namaTimMemuatDesa("Garuda Esports", "Mangliawan"), false);
  assert.equal(N.namaTimMemuatDesa("Esport Manggliawan", "Mangliawan"), true, "salah ketik");
});

/* ── tim tiruan ───────────────────────────────────────────────────────── */
const TIM = {
  kode: "TED-00777", id: "11111111-2222-3333-4444-555555555555", sidik: "a".repeat(32), nama_tim: "Mangliawan Esports",
  desa: "Mangliawan", kecamatan: "Pakis", kabupaten: "Kabupaten Malang", status: "menunggu",
  pemain: [1, 2, 3, 4, 5].map((u) => ({
    urutan: u, nama: ["Budi Santoso", "Siti Aminah", "Rizky Ramadhan", "Dewi Lestari", "Agus Salim"][u - 1], dokumen_jenis: "KTP",
    dokumen_path: `gdrive/IDENTITAS-${u}0000.jpg`, profil_ml_path: `gdrive/PROFILML-${u}0000.png`,
    follow_esports_path: `gdrive/FOLLOWESP-${u}000.jpg`, follow_ppdt_path: `gdrive/FOLLOWPPDT-${u}000.jpg`, izin_path: null,
  })),
};
const NIK = ["3507181201000001", "3507184506080003", "3507180303010002", "3507186607020004", "3507180909990005"];
const bacaBaik = (p, i) => ({
  identitas: { jenis_dokumen: "KTP", terbaca: true, nama: p.nama.toUpperCase(), nik: NIK[i], tanggal_lahir: N.lahirDariNik(NIK[i]),
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
  baca[3].identitas.kabupaten_kota = "KOTA MALANG";
  baca[4].identitas.nama = "AGUS SALIMUDIN WIJAYA KUSUMA";                               // nama dokumen lain
  baca[5].identitas.tanggal_lahir = "1990-01-01"; baca[5].identitas.nik = "";            // 37 th
  baca[5].profil_ml = { profil_mlbb: false, nickname: "", id_akun: "", server: "" };
  const n = N.nilaiTim({ ...t, nama_tim: "Garuda Esports" }, baca, { pantas: true, alasan: "" },
    { 3: { follow_esports_path: "x1", follow_ppdt_path: "x1" } });
  assert.equal(n.hasil, "cek");
  assert.ok(n.ringkas.length <= 500 && n.ringkas.startsWith("8 catatan:"), n.ringkas.slice(0, 40));
  const semua = [...n.rincian.tim.filter((b) => b.s === "cek").map((b) => b.t),
    ...n.rincian.pemain.flatMap((p) => p.butir.filter((b) => b.s === "cek").map((b) => `P${p.u} ${p.nama}: ${b.t}`))].join(" · ");
  for (const pola of [/belum mencantumkan nama desa/, /P1 Budi Santoso: Umur 15 tahun: surat izin/, /P2 Siti Aminah: .*@ditjen_ppdt BELUM diikuti/,
    /P4 Dewi Lestari: Nama di dokumen "AGUS SALIMUDIN WIJAYA KUSUMA" tidak sama dengan nama terdaftar "Dewi Lestari"/,
    /P3 Rizky Ramadhan: Domisili di KOTA MALANG, bukan Kabupaten Malang/, /P5 Agus Salim: Umur 37/, /P5 Agus Salim: Bukan tangkapan layar profil/,
    /P3 Rizky Ramadhan: Berkas yang sama persis diunggah untuk follow @esportsdesa.official dan follow @ditjen_ppdt/]) {
    assert.match(semua, pola);
  }
  assert.equal(N.namaCocok("Agus Salim", "AGUS SALIMUDIN WIJAYA KUSUMA"), true, "Salim ⊂ Salimudin (awalan) diterima");
});

await uji("nilaiTim: izin diperiksa bila < 17; kartu pelajar tanpa alamat = info; berkas lama = cek", () => {
  const t = salin(TIM);
  t.pemain[0].izin_path = "gdrive/IZIN-10000000.pdf";
  t.pemain[1].dokumen_path = "dokumen/lama.jpg";
  const baca = Object.fromEntries(t.pemain.map((p, i) => [p.urutan, bacaBaik(p, i)]));
  baca[1].identitas.tanggal_lahir = "2011-03-01"; baca[1].identitas.nik = "";
  baca[1].izin = { surat_izin: true, nama_anak: "Budi Santoso", nama_ortu: "Slamet", ada_tanda_tangan: true };
  baca[2].identitas = { galat: "Berkas masih di penyimpanan lama (Supabase): cek manual." };
  Object.assign(baca[3].identitas, { jenis_dokumen: "Kartu Pelajar", desa_kelurahan: "", kecamatan: "", kabupaten_kota: "", nik: "", tanggal_lahir: "2009-07-07" });
  t.pemain[2].dokumen_jenis = "Kartu Pelajar";
  const n = N.nilaiTim(t, baca, null, {});
  const p = (u) => n.rincian.pemain.find((x) => x.u === u).butir;
  assert.ok(p(1).some((b) => b.b === "izin" && b.s === "ok"), "izin ok");
  assert.ok(p(2).some((b) => b.s === "cek" && /penyimpanan lama/.test(b.t)));
  assert.ok(p(3).some((b) => b.s === "info" && /Kartu pelajar tanpa alamat/.test(b.t)));
  assert.ok(!p(3).some((b) => b.s === "cek"), "kartu pelajar sah tanpa catatan cek");
  assert.equal(n.hasil, "cek");
  baca[1].izin.ada_tanda_tangan = false;
  assert.ok(N.nilaiTim(t, baca, null, {}).rincian.pemain[0].butir.some((b) => b.b === "izin" && /tanpa tanda tangan/.test(b.t)));
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
  assert.equal(s.p_identitas[0].sha.length, 4);
  assert.match(s.p_model, /qwen3\.5:9b · agen v1/);
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

console.log(`${lulus} uji agen AI lulus`);
process.exit(0);
