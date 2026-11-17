/* Uji kasus pesan WA (public/js/saran.js): pesan menyesuaikan status tim, hasil AI, jejak kapten, dan keanggotaan grup.
   node uji/uji-saran.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const window = {};
runInNewContext(readFileSync(new URL("../public/js/saran.js", import.meta.url), "utf8"), { window });
const S = window.SARAN;
let lulus = 0;
const uji = (nama, f) => { f(); lulus++; };

const GRUP = "https://chat.whatsapp.com/UjiGrup";
const tim = (x = {}) => ({ kode: "TED-00009", nama_tim: "Tim Uji", nama_kapten: "Budi", desa: "Sukamaju", status: "menunggu",
  kapten_dikabari: null, perbaiki_pada: null, pemain: [{ urutan: 1, nama: "Budi" }, { urutan: 2, nama: "Andi" }], ...x });
const CATATAN = { tim: [], pemain: [{ u: 2, butir: [{ b: "follow_ppdt", s: "cek", t: "Bukti follow menunjukkan @ditjen_ppdt BELUM diikuti." }] }], ganda: [] };
const KOSONG = { tim: [], pemain: [], ganda: [] };
const PANITIA = { tim: [], pemain: [{ u: 1, butir: [{ b: "identitas", s: "cek", t: "Berkas di penyimpanan lama belum bisa dibaca." }] }], ganda: [] };
const info = (pada, x = {}) => ({ akhir: "cek", pada, tunggu: 0, ...x });
const kasus = (t, ai, inf, diGrup = null) => S.kasus({ tim: t, saran: S.daftar(ai, t.pemain), info: inf, diGrup });
const pesan = (t, ai, inf, diGrup = null) => S.pesanWa({ tim: t, ai, tautan: "https://esportsdesa.id/perbaiki#TED-00009.tok", grup: GRUP, info: inf, diGrup });

uji("terverifikasi: undang ke grup bila kapten belum/tak diketahui di grup, ingatkan pemain bila sudah", () => {
  const t = tim({ status: "terverifikasi" });
  assert.equal(kasus(t, KOSONG, info("2026-11-17T01:00:00Z"), null), "undang_grup");
  assert.equal(kasus(t, KOSONG, info("2026-11-17T01:00:00Z"), false), "undang_grup");
  assert.equal(kasus(t, KOSONG, info("2026-11-17T01:00:00Z"), true), "sudah_grup");
  const p = pesan(t, KOSONG, null, false);
  assert.match(p, /TERVERIFIKASI/);
  assert.match(p, /Nomor kakak belum ada di grup WhatsApp peserta\. Masuk grup/);
  assert.ok(p.includes(GRUP));
  assert.match(p, /Kalau ada data tim yang perlu diubah.*\nhttps:\/\/esportsdesa\.id\/perbaiki#TED-00009\.tok/s, "tautan ubah data tetap ada (semua data bisa diubah)");
  const q = pesan(t, KOSONG, null, true);
  assert.match(q, /Kakak sudah ada di grup WhatsApp peserta\. Pastikan semua pemain juga sudah masuk/);
});

uji("menunggu + catatan, belum dikabari → minta perbaikan (daftar + tautan + grup)", () => {
  const t = tim();
  assert.equal(kasus(t, CATATAN, info("2026-11-17T01:00:00Z")), "perbaiki");
  const p = pesan(t, CATATAN, info("2026-11-17T01:00:00Z"));
  assert.match(p, /Dari pemeriksaan berkas, ada yang perlu diperbaiki:/);
  assert.match(p, /\*Pemain 2: Andi\*\n• @ditjen_ppdt belum di-follow/);
  assert.match(p, /perbaiki#TED-00009\.tok/);
  assert.match(p, /Gabung grup WhatsApp peserta untuk info jadwal: https:\/\/chat\.whatsapp\.com\/UjiGrup/);
});

uji("sudah dikabari, catatan sama → ingatkan; catatan berubah sesudah dikabari → pembaruan", () => {
  const t = tim({ kapten_dikabari: "2026-11-17T05:00:00Z" });
  assert.equal(kasus(t, CATATAN, info("2026-11-17T01:00:00Z")), "ingatkan");
  assert.match(pesan(t, CATATAN, info("2026-11-17T01:00:00Z")), /^Halo Kak Budi[^\n]*\n\nMengingatkan lagi ya Kak/);
  assert.equal(kasus(t, CATATAN, info("2026-11-17T06:00:00Z")), "perbaiki");
  assert.match(pesan(t, CATATAN, info("2026-11-17T06:00:00Z")), /Ada pembaruan hasil pemeriksaan berkas tim kakak/);
});

uji("kapten memperbaiki: sebelum dicek ulang = sedang dicek; sesudah dicek ulang masih ada catatan = perbaikan lagi", () => {
  const t = tim({ kapten_dikabari: "2026-11-17T05:00:00Z", perbaiki_pada: "2026-11-17T07:00:00Z" });
  assert.equal(kasus(t, CATATAN, info("2026-11-17T01:00:00Z")), "diproses");
  const p = pesan(t, CATATAN, info("2026-11-17T01:00:00Z"));
  assert.match(p, /Terima kasih sudah memperbaiki berkas\. Berkas yang baru sedang dicek ulang\./);
  assert.doesNotMatch(p, /Andi/, "catatan lama tidak dikirim");
  assert.equal(kasus(t, CATATAN, info("2026-11-17T07:10:00Z")), "perbaiki_lagi");
  assert.match(pesan(t, CATATAN, info("2026-11-17T07:10:00Z")), /Setelah dicek ulang, masih ada yang perlu diperbaiki:/);
});

uji("belum dicek AI / galat / tanpa catatan untuk kapten", () => {
  assert.equal(kasus(tim(), KOSONG, null), "diproses");
  assert.equal(kasus(tim(), CATATAN, info("2026-11-17T01:00:00Z", { akhir: "galat" })), "diproses");
  assert.equal(kasus(tim(), KOSONG, info("2026-11-17T01:00:00Z", { tunggu: 2 })), "diproses");
  assert.equal(kasus(tim(), PANITIA, info("2026-11-17T01:00:00Z")), "panitia");
  assert.match(pesan(tim(), PANITIA, info("2026-11-17T01:00:00Z")), /sedang diperiksa panitia/);
  // Catatan yang sudah ada tetap dikirim walau sebagian berkas masih menunggu model besar.
  assert.equal(kasus(tim(), CATATAN, info("2026-11-17T01:00:00Z", { tunggu: 1 })), "perbaiki");
});

uji("kapten sudah di grup → baris ajakan grup tidak ditulis; tidak diketahui → ajakan biasa", () => {
  assert.doesNotMatch(pesan(tim(), CATATAN, info("2026-11-17T01:00:00Z"), true), /chat\.whatsapp\.com/);
  assert.match(pesan(tim(), CATATAN, info("2026-11-17T01:00:00Z"), false), /Nomor kakak belum ada di grup WhatsApp peserta\. Gabung/);
});

uji("tanpa info (pemanggil lama) perilakunya tetap", () => {
  assert.equal(kasus(tim(), CATATAN, undefined), "perbaiki");
  assert.equal(kasus(tim(), KOSONG, undefined), "diproses");
  assert.ok(Object.keys(S.KASUS).length === 7);
});

console.log(`${lulus} uji kasus pesan WA lulus`);
