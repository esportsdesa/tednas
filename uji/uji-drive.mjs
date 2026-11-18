/**
 * Uji deploy/drive/Code.gs tanpa login Google: skrip dijalankan di Node (vm) melawan Drive, Sheets, Cache,
 * Lock, dan Supabase TIRUAN. Supabase tiruan meniru kontrak migration-8-drive.sql — nama parameter tiap RPC
 * dicocokkan langsung dengan tanda tangan fungsi di berkas migrasi itu (perilaku SQL-nya diuji uji-sql.mjs).
 *   node uji/uji-drive.mjs
 */
import assert from "node:assert/strict";
import { buatDunia } from "./tiruan-google.mjs";
import { randomUUID } from "node:crypto";

const URL_EXEC = "https://script.google.com/macros/s/AKfycbTEDNASuji0123456789abcdefghij/exec";
let lulus = 0;
const uji = async (nama, f) => { try { await f(); lulus++; } catch (e) { console.error(`GAGAL: ${nama}\n`, e); process.exit(1); } };

const { S, KUNCI, J, gs, db, benda, hitung, props, cache, pemicu, log, ROOT_DRIVE, folderBernama, anakDari, sahkan, daftarTim, paket, kabar, post, blob, signed } = buatDunia({ KUNCI_AI: "d4".repeat(32) });
/* ── isi berkas uji ───────────────────────────────────────────────────── */
const JPG = (n) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`jpg-${n}`)]);
const PNG = (n) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]), Buffer.from(`png-${n}`)]);
const PDF = (n) => Buffer.from(`%PDF-1.4 izin ${n}`);
const unggah = (buf, mime) => post({ aksi: "unggah", mime, data: buf.toString("base64") });
const isiBerkas = new Map();
function unggahPemain(awal, n = 5) {
  return Array.from({ length: n }, (_, i) => {
    const k = `${awal}-${i}`;
    const u = (buf, mime) => { const r = unggah(buf, mime); assert.equal(r.ok, true, JSON.stringify(r)); isiBerkas.set(r.path.split("~")[0], buf); return r.path; };
    return { nama: `Pemain ${k}`, jenis: i === 1 ? "KK" : "KTP", dok: u(JPG(`${k}d`), "image/jpeg"), ml: u(PNG(`${k}m`), "image/png"), ig1: u(JPG(`${k}a`), "image/jpeg"), ig2: u(JPG(`${k}b`), "image/jpeg"), izin: i === 4 ? u(PDF(k), "application/pdf") : null };
  });
}

/* ── skenario ─────────────────────────────────────────────────────────── */
await uji("pasang sebelum deploy: folder, Sheet, pemicu 10 menit, kunci dicek ke Supabase", () => {
  gs.pasang();
  assert.equal(pemicu.length, 1); assert.equal(pemicu[0].m, 10);
  assert.ok(log.some((l) => l.includes("Manage deployments")));
  assert.ok(log.some((l) => l === "Supabase: kunci cocok."));
  const root = folderBernama("TEDNas 2027 — Data Pendaftar");
  assert.ok(root && root._induk === ROOT_DRIVE.getId());
  const ss = benda.get(props.get("SHEET"));
  assert.equal(ss._induk, root.getId());
  assert.deepEqual(ss.getSheets().map((s) => s._nama), ["Tim", "Pemain"]);
  assert.equal(ss.getSheetByName("Tim").baris(1)[3], "WhatsApp kapten");
  assert.equal(db.url, null, "belum ada alamat untuk didaftarkan");
});

await uji("unggah: jpg/png/pdf disimpan di Berkas Masuk/<tanggal WIB>, path bertanda HMAC yang sah", () => {
  for (const [buf, mime, ext] of [[JPG(1), "image/jpeg", "jpg"], [PNG(1), "image/png", "png"], [PDF(1), "application/pdf", "pdf"]]) {
    const r = unggah(buf, mime);
    assert.equal(r.ok, true);
    assert.match(r.path, new RegExp(`^gdrive/[A-Za-z0-9_-]{10,100}\\.${ext}~[0-9a-f]{64}$`));
    const inti = sahkan(r.path);
    assert.ok(inti, "tanda Apps Script = tanda SQL (HMAC-SHA256 hex)");
    const f = benda.get(inti.slice(7).split(".")[0]);
    assert.ok(f._isi.equals(buf), "isi utuh");
    assert.equal(benda.get(f._induk).getName(), "2026-11-11");
    assert.equal(benda.get(benda.get(f._induk)._induk).getName(), "Berkas Masuk");
    assert.match(f.getName(), /^[0-9a-f-]{36}\.(jpg|png|pdf)$/);
  }
});

await uji("unggah ditolak: jenis, isi palsu, terlalu besar, rem per menit", () => {
  assert.equal(unggah(JPG(2), "image/gif").pesan, "JENIS_TIDAK_SAH");
  assert.equal(unggah(Buffer.from("<html>bukan foto</html>"), "image/jpeg").pesan, "ISI_TIDAK_SAH");
  assert.equal(unggah(PNG(2), "image/jpeg").pesan, "ISI_TIDAK_SAH", "png menyamar jpg");
  assert.equal(unggah(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(5 * 1024 * 1024)]), "image/jpeg").pesan, "TERLALU_BESAR");
  assert.equal(post({ aksi: "unggah", mime: "image/jpeg" }).pesan, "TERLALU_BESAR");
  const lama = gs.MAKS_UNGGAH_PER_MENIT;
  gs.MAKS_UNGGAH_PER_MENIT = 3;
  S.jam += 60_000;
  assert.equal(unggah(JPG(3), "image/jpeg").ok, true);
  unggah(JPG(4), "image/jpeg"); unggah(JPG(5), "image/jpeg");
  const r = unggah(JPG(6), "image/jpeg");
  assert.equal(r.pesan, "SIBUK"); assert.equal(r.ulang, true);
  gs.MAKS_UNGGAH_PER_MENIT = lama;
  assert.equal(post("{bukan json").pesan, "BADAN_TIDAK_SAH");
  assert.equal(post({ aksi: "entah" }).pesan, "AKSI_TIDAK_DIKENAL");
  assert.equal(post({ aksi: "tim", kunci: "salah", tim: {} }).pesan, "KUNCI_SALAH");
});

let t1;
await uji("pendaftaran → kabar tim: baris Sheet + berkas pindah ke folder tim dengan nama terbaca", () => {
  S.jam += 60_000;
  t1 = daftarTim("Garuda Desa", unggahPemain(1));
  const r = kabar("tim", { tim: paket(t1) });
  assert.equal(r.ok, true); assert.equal(r.rapi, true);
  assert.equal(t1.tersalin, 1, "drive_tersalin"); assert.ok(t1.rapi > 0, "drive_rapi"); assert.match(t1.folder, /^https:\/\/drive\.google\.com\/drive\/folders\//);
  const ss = benda.get(props.get("SHEET"));
  const tim = ss.getSheetByName("Tim");
  assert.equal(tim.data().length, 1);
  const b = tim.baris(2);
  assert.deepEqual(b.slice(0, 4), ["TED-00001", "Garuda Desa", "Pemain 1-0", t1.wa_kapten]);
  assert.equal(b[9], "Menunggu verifikasi"); assert.equal(b[10], "5"); assert.equal(b[12], "2026-11-11 10:02");
  assert.equal(b[11], "tidak wajib (daftar sebelum 18 Nov)", "tim form v1: twibbon tidak wajib");
  assert.equal(b[13], t1.folder, "kolom Folder berkas");
  const pem = ss.getSheetByName("Pemain").data();
  assert.equal(pem.length, 5);
  assert.deepEqual(pem.map((x) => x[3]), ["Kapten", "Pemain", "Pemain", "Pemain", "Pemain"]);
  assert.match(pem[0][7], /^https:\/\/drive\.google\.com\/file\/d\/1Tiru\w+\/view$/);
  assert.equal(pem[4][11] !== "", true, "izin orang tua pemain 5"); assert.equal(pem[0][11], "");
  assert.deepEqual(pem.map((x) => x[5]), [t1.wa_kapten, "", "", "", ""], "kolom WhatsApp: pemain 1 = kapten, tim lama tanpa WA pemain");
  const folder = benda.get(t1.folder.split("/").pop());
  assert.equal(folder.getName(), "TED-00001 — Garuda Desa (Mangliawan, KAB. MALANG)");
  assert.equal(benda.get(folder._induk).getName(), "35 JAWA TIMUR");
  assert.equal(benda.get(benda.get(folder._induk)._induk).getName(), "Tim");
  const nama = anakDari(folder).map((x) => x.getName()).sort();
  assert.equal(nama.length, 21);
  assert.ok(nama.includes("1. Pemain 1-0 — KTP.jpg") && nama.includes("2. Pemain 1-1 — KK.jpg") && nama.includes("1. Pemain 1-0 — Profil ML.png"));
  assert.ok(nama.includes("5. Pemain 1-4 — Izin orang tua.pdf") && nama.includes("3. Pemain 1-2 — Follow ditjen_ppdt.jpg"));
});

await uji("verifikasi admin → baris diperbarui di tempat, berkas tidak dipindah ulang", () => {
  const sebelum = hitung.moveTo;
  t1.status = "terverifikasi"; t1.versi = 2;
  assert.equal(kabar("tim", { tim: paket(t1) }).rapi, false);
  const ss = benda.get(props.get("SHEET"));
  assert.equal(ss.getSheetByName("Tim").data().length, 1, "tidak ada baris ganda");
  assert.equal(ss.getSheetByName("Tim").baris(2)[9], "Terverifikasi");
  assert.equal(ss.getSheetByName("Pemain").data().length, 5);
  assert.equal(hitung.moveTo, sebelum);
  assert.equal(t1.tersalin, 2);
});

let t2;
await uji("tim kedua + ganti nama tim → folder ikut berganti, baris pemain tim lain utuh", () => {
  t2 = daftarTim("Banteng Muda", unggahPemain(2, 6));
  kabar("tim", { tim: paket(t2) });
  t1.nama_tim = "Garuda Emas"; t1.versi = 3;
  kabar("tim", { tim: paket(t1) });
  const folder = benda.get(t1.folder.split("/").pop());
  assert.equal(folder.getName(), "TED-00001 — Garuda Emas (Mangliawan, KAB. MALANG)");
  const pem = benda.get(props.get("SHEET")).getSheetByName("Pemain").data();
  assert.equal(pem.length, 11);
  assert.equal(pem.filter((x) => x[0] === "TED-00002").length, 6);
  assert.equal(pem.filter((x) => x[0] === "TED-00001" && x[1] === "Garuda Emas").length, 5);
  assert.equal(pem.find((x) => x[0] === "TED-00002" && x[2] === "6")[3], "Cadangan");
});

await uji("Sheet sedang dipakai (gembok) → SIBUK; pemicu berkala menyusulkan Sheet lalu merapikan", () => {
  S.gembokSibuk = true;
  const t3 = daftarTim("Elang Sakti", unggahPemain(3));
  const r = kabar("tim", { tim: paket(t3) });
  assert.equal(r.pesan, "SIBUK"); assert.equal(t3.tersalin, 0);
  S.gembokSibuk = false;
  S.jam += 10 * 60_000;
  const h = J(gs.rapikan());
  assert.equal(h.sheet, 1); assert.equal(h.rapi, 1); assert.deepEqual(h.galat, []);
  assert.equal(t3.tersalin, 1); assert.ok(t3.rapi > 0);
  assert.equal(anakDari(benda.get(t3.folder.split("/").pop())).length, 21);
  assert.equal(J(gs.rapikan()).sheet, 0, "putaran berikutnya kosong");
});

await uji("perapian dibatasi per putaran (jatah pemicu)", () => {
  const banyak = [1, 2, 3, 4, 5].map((i) => daftarTim(`Antre ${i}`, unggahPemain(10 + i)));
  for (const t of banyak) { t.tersalin = t.versi; }       // seolah Sheet sudah ditulis tapi perapian gagal
  S.jam += 10 * 60_000;
  assert.equal(J(gs.rapikan()).rapi, 3);
  assert.equal(J(gs.rapikan()).rapi, 2);
  assert.ok(banyak.every((t) => t.rapi > 0));
});

await uji("tim dihapus admin → ditandai di Sheet & folder, antrean hapus dibersihkan", () => {
  db.hapus.push({ kode: "TED-00002", nama_tim: "Banteng Muda" });
  db.tim = db.tim.filter((x) => x.kode !== "TED-00002");
  assert.equal(kabar("hapus", { kode: "TED-00002" }).ok, true);
  const tim = benda.get(props.get("SHEET")).getSheetByName("Tim");
  assert.equal(tim.data().find((x) => x[0] === "TED-00002")[9], "DIHAPUS dari situs");
  assert.ok([...benda.values()].some((x) => x._jenis === "folder" && x._nama.startsWith("[DIHAPUS] TED-00002 — Banteng Muda")));
  assert.equal(db.hapus.length, 0);
  // Kabar langsung gagal → antrean hapus disusulkan pemicu.
  db.hapus.push({ kode: "TED-00003", nama_tim: "Elang Sakti" });
  S.jam += 10 * 60_000;
  assert.equal(J(gs.rapikan()).hapus, 1);
  assert.equal(db.hapus.length, 0);
});

await uji("admin membuka berkas: token admin sah, berkas TEDNas saja, hasil di-cache", () => {
  const path = t1.pemain[0].dokumen_path;
  const r = post({ aksi: "berkas", path, token: "token-admin-sah-0123456789" });
  assert.equal(r.ok, true); assert.equal(r.mime, "image/jpeg"); assert.equal(r.nama, "1. Pemain 1-0 — KTP.jpg");
  assert.ok(Buffer.from(r.data, "base64").equals(isiBerkas.get(path)));
  const auth = hitung.auth;
  assert.equal(post({ aksi: "berkas", path, token: "token-admin-sah-0123456789" }).ok, true);
  assert.equal(hitung.auth, auth, "token admin di-cache");
  assert.equal(post({ aksi: "berkas", path, token: "token-bukan-admin-012345" }).pesan, "BUKAN_ADMIN");
  assert.equal(post({ aksi: "berkas", path, token: "token-palsu-sama-sekali-xx" }).pesan, "BUKAN_ADMIN");
  assert.equal(post({ aksi: "berkas", path }).pesan, "BUKAN_ADMIN");
  const lain = ROOT_DRIVE.createFile(blob(signed(JPG("rahasia")), "image/jpeg", "foto-pribadi.jpg"));
  assert.equal(post({ aksi: "berkas", path: `gdrive/${lain.getId()}.jpg`, token: "token-admin-sah-0123456789" }).pesan, "BUKAN_BERKAS_TEDNAS");
  assert.equal(post({ aksi: "berkas", path: "gdrive/../../x.jpg", token: "token-admin-sah-0123456789" }).pesan, "PATH_TIDAK_SAH");
  assert.equal(post({ aksi: "berkas", path: "gdrive/1TiruTidakAdaSamaSekali00000.jpg", token: "token-admin-sah-0123456789" }).pesan, "BERKAS_TIDAK_ADA");
  // Berkas yang masih di Berkas Masuk juga bisa dibuka.
  const baru = unggah(JPG("baru"), "image/jpeg").path.split("~")[0];
  assert.equal(post({ aksi: "berkas", path: baru, token: "token-admin-sah-0123456789" }).ok, true);
});

await uji("agen AI membaca berkas dengan KUNCI_AI (tanpa login admin); kunci lain & berkas di luar TEDNas ditolak", () => {
  const path = t1.pemain[1].profil_ml_path, auth = hitung.auth;
  const r = post({ aksi: "berkas", path, kunci_ai: "d4".repeat(32) });
  assert.equal(r.ok, true); assert.equal(r.mime, "image/png");
  assert.ok(Buffer.from(r.data, "base64").equals(isiBerkas.get(path)));
  assert.equal(hitung.auth, auth, "kunci AI tidak memanggil Supabase Auth");
  assert.equal(post({ aksi: "berkas", path, kunci_ai: "d5".repeat(32) }).pesan, "BUKAN_ADMIN");
  assert.equal(post({ aksi: "berkas", path, kunci_ai: KUNCI }).pesan, "BUKAN_ADMIN", "kunci Drive bukan kunci AI");
  assert.equal(post({ aksi: "berkas", path, kunci_ai: ["d4".repeat(32)] }).pesan, "BUKAN_ADMIN");
  const lain = ROOT_DRIVE.createFile(blob(signed(JPG("rahasia-ai")), "image/jpeg", "foto-pribadi-2.jpg"));
  assert.equal(post({ aksi: "berkas", path: `gdrive/${lain.getId()}.jpg`, kunci_ai: "d4".repeat(32) }).pesan, "BUKAN_BERKAS_TEDNAS");
  // Code.gs tanpa KUNCI_AI terisi (penanda __KUNCI_AI__ dibiarkan) = jalur AI mati.
  const W2 = buatDunia();
  W2.gs.pasang();
  assert.equal(W2.post({ aksi: "berkas", path, kunci_ai: "__KUNCI_AI__" }).pesan, "BUKAN_ADMIN");
  assert.equal(W2.post({ aksi: "berkas", path, kunci_ai: "d4".repeat(32) }).pesan, "BUKAN_ADMIN");
});

await uji("unggahan yatim > 7 hari dibuang; yang dipakai pendaftaran tetap", () => {
  const yatim = [unggah(JPG("y1"), "image/jpeg").path, unggah(PNG("y2"), "image/png").path].map((p) => benda.get(p.slice(7).split(".")[0]));
  const terpakai = daftarTim("Terdaftar Belum Rapi", unggahPemain(30));
  terpakai.tersalin = terpakai.versi; terpakai.rapi = 1;  // perapian dilewati → berkasnya masih di Berkas Masuk
  S.jam += 8 * 86_400_000;
  const h = J(gs.rapikan());
  assert.ok(h.buang >= 2, JSON.stringify(h));
  assert.ok(yatim.every((f) => f.isTrashed()));
  const masih = terpakai.pemain.flatMap((p) => [p.dokumen_path, p.profil_ml_path]).map((p) => benda.get(p.slice(7).split(".")[0]));
  assert.ok(masih.every((f) => !f.isTrashed()), "berkas terdaftar tidak dibuang");
});

await uji("skrip tidak pernah mendaftarkan alamatnya sendiri (getUrl Apps Script tak bisa dipercaya)", () => {
  S.urlLayanan = URL_EXEC;
  gs.rapikan();
  assert.equal(db.url, null);
  log.length = 0;
  gs.pasang();
  assert.equal(db.url, null);
  assert.ok(log.some((l) => l.includes("Manage deployments")));
  assert.equal(pemicu.length, 1, "pasang ulang tidak menggandakan pemicu");
});

await uji("tim lama (berkas di bucket Supabase): baris tertulis, berkas tidak disentuh", () => {
  const lama = daftarTim("Tim Lama", Array.from({ length: 5 }, (_, i) => ({ nama: `Lama ${i}`, dok: `dokumen/a${i}.jpg`, ml: `dokumen/b${i}.png`, ig1: `dokumen/c${i}.jpg`, ig2: `dokumen/d${i}.jpg` })), { lama: true });
  assert.equal(kabar("tim", { tim: paket(lama) }).ok, true);
  const pem = benda.get(props.get("SHEET")).getSheetByName("Pemain").data().filter((x) => x[0] === lama.kode);
  assert.equal(pem[0][7], "Supabase: dokumen/a0.jpg");
  assert.equal(anakDari(benda.get(lama.folder.split("/").pop())).length, 0);
});

await uji("form v2: WA tiap pemain + bukti twibbon → kolom Sheet, twibbon pindah ke folder tim", () => {
  S.jam += 60_000;
  const pem = unggahPemain(50).map((p, i) => (i ? { ...p, wa: `62813000050${i}` } : p));
  const t = daftarTim("Twibbon Jaya", pem, { twibbon: unggah(JPG("twibbon50"), "image/jpeg").path });
  assert.equal(t.form_versi, 2);
  assert.equal(kabar("tim", { tim: paket(t) }).rapi, true);
  const ss = benda.get(props.get("SHEET"));
  const b = ss.getSheetByName("Tim").data().find((x) => x[0] === t.kode);
  const idTw = t.twibbon_path.slice(7).split(".")[0];
  assert.equal(b[11], `https://drive.google.com/file/d/${idTw}/view`, "kolom Bukti twibbon");
  assert.equal(b[13], t.folder);
  const baris = ss.getSheetByName("Pemain").data().filter((x) => x[0] === t.kode);
  assert.deepEqual(baris.map((x) => x[5]), [t.wa_kapten, "628130000501", "628130000502", "628130000503", "628130000504"]);
  assert.deepEqual(baris.map((x) => x[6]), ["KTP", "KK", "KTP", "KTP", "KTP"], "jenis identitas tetap di kolomnya");
  const f = benda.get(idTw);
  assert.equal(f._induk, t.folder.split("/").pop()); assert.equal(f.getName(), "Bukti twibbon tim.jpg");
  assert.equal(anakDari(benda.get(t.folder.split("/").pop())).length, 22);
});

await uji("twibbon di Berkas Masuk tidak dibuang sebagai yatim; tim yang dirapikan Code.gs lama → drive_rapi = 0 → twibbon ikut dipindah", () => {
  const t = daftarTim("Rapi Lama", unggahPemain(51), { twibbon: unggah(PNG("twibbon51"), "image/png").path });
  t.tersalin = t.versi; t.rapi = 1;  // seperti TED-00068: ditulis Code.gs 2026-11-16, twibbon tertinggal di Berkas Masuk
  const f = benda.get(t.twibbon_path.slice(7).split(".")[0]);
  S.jam += 8 * 86_400_000;
  J(gs.rapikan());
  assert.equal(f.isTrashed(), false, "twibbon dipakai (migrasi 17)");
  assert.equal(benda.get(benda.get(f._induk)._induk).getName(), "Berkas Masuk");
  t.rapi = 0;
  S.jam += 10 * 60_000;
  assert.ok(J(gs.rapikan()).rapi >= 1);
  assert.equal(f._induk, t.folder.split("/").pop()); assert.equal(f.getName(), "Bukti twibbon tim.png");
});

await uji("Sheet buatan versi lama: kolom WhatsApp & Bukti twibbon disisipkan di tempatnya, isi lama bergeser (tidak ditimpa)", () => {
  const W = buatDunia();
  W.gs.pasang();
  const ss = W.benda.get(W.props.get("SHEET"));
  const tim = ss.getSheetByName("Tim"), pem = ss.getSheetByName("Pemain");
  tim._rows.length = 0; pem._rows.length = 0;
  // tim yang sudah tertulis versi lama, berkasnya belum dirapikan: putaran pertama versi baru = perapian (tanpa tulisTim)
  const t0 = W.daftarTim("Tim Sheet Lama", Array.from({ length: 5 }, (_, i) => ({ nama: `Lama ${i}`, dok: `dokumen/e${i}.jpg`, ml: `dokumen/f${i}.png`, ig1: `dokumen/g${i}.jpg`, ig2: `dokumen/h${i}.jpg` })), { lama: true });
  t0.tersalin = t0.versi;
  tim._rows.push(["Kode", "Nama tim", "Kapten", "WhatsApp kapten", "Provinsi", "Kabupaten", "Kecamatan", "Desa", "Kode desa", "Status", "Jumlah pemain", "Waktu daftar (WIB)", "Folder berkas", "Terakhir disalin (WIB)"],
    [t0.kode, "Tim Sheet Lama", "Kapten Lama", "6281299900000", "JAWA TIMUR", "KAB. MALANG", "Pakis", "Mangliawan", "35.07.18.2010", "Terverifikasi", "5", "2026-11-12 08:00", "https://drive.google.com/drive/folders/lama", "2026-11-16 10:00"]);
  pem._rows.push(["Kode tim", "Nama tim", "No", "Peran", "Nama", "Jenis identitas", "Kartu identitas", "Profil ML", "Follow @esportsdesa.official", "Follow @ditjen_ppdt", "Izin orang tua"],
    [t0.kode, "Tim Sheet Lama", "1", "Kapten", "Kapten Lama", "KTP", "https://drive.google.com/file/d/ktp/view", "https://drive.google.com/file/d/ml/view", "a", "b", ""]);
  W.S.jam += 10 * 60_000;
  assert.equal(J(W.gs.rapikan()).rapi, 1);
  assert.deepEqual(tim.baris(1), J(W.gs.KEPALA_TIM), "perapian pun menyelaraskan kepala dulu");
  assert.deepEqual(tim.data().find((x) => x[0] === t0.kode).slice(10, 14), ["5", "", "2026-11-12 08:00", t0.folder], "folder ditulis di kolom yang benar");
  const t = W.daftarTim("Tim Baru", Array.from({ length: 5 }, (_, i) => ({ nama: `Baru ${i}`, dok: `dokumen/a${i}.jpg`, ml: `dokumen/b${i}.png`, ig1: `dokumen/c${i}.jpg`, ig2: `dokumen/d${i}.jpg` })), { lama: true });
  assert.equal(W.kabar("tim", { tim: W.paket(t) }).ok, true);
  assert.deepEqual(tim.baris(1), J(W.gs.KEPALA_TIM));
  assert.deepEqual(pem.baris(1), J(W.gs.KEPALA_PEMAIN));
  const lama = tim.data().find((x) => x[0] === t0.kode);
  assert.deepEqual([lama[10], lama[11], lama[12], lama[13]], ["5", "", "2026-11-12 08:00", t0.folder]);
  const lp = pem.data().find((x) => x[0] === t0.kode);
  assert.deepEqual(lp.slice(4, 8), ["Kapten Lama", "", "KTP", "https://drive.google.com/file/d/ktp/view"]);
  assert.equal(tim.data().find((x) => x[0] === t.kode)[11], "tidak wajib (daftar sebelum 18 Nov)");
  t.versi++;
  W.kabar("tim", { tim: W.paket(t) });
  assert.equal(tim.baris(1).length, 15, "kabar berikutnya tidak menyisipkan lagi");
  assert.equal(pem.baris(1).length, 12);
});

await uji("kunci belum dipasang di Supabase: pasang berhenti dengan pesan jelas, pemicu tidak meledak", () => {
  S.kunciDb = "kunci-lain-di-supabase";
  log.length = 0;
  gs.pasang();
  assert.ok(log.some((l) => l.includes("Supabase MENOLAK kunci skrip ini")), log.join("\n"));
  assert.ok(!log.some((l) => l.startsWith("Putaran pertama")), "putaran pertama dilewati");
  assert.equal(pemicu.length, 1);
  S.jam += 10 * 60_000;
  const h = J(gs.rapikan());
  assert.ok(h.galat.some((g) => g.startsWith("antre:") && g.includes("KUNCI_SALAH")), JSON.stringify(h));
  assert.equal(cache.has("rapikan_jalan"), false);
  S.kunciDb = KUNCI;
});

await uji("detak tercatat & galat tidak menghentikan putaran", () => {
  const rusak = daftarTim("Berkas Hilang", unggahPemain(40));
  const id = rusak.pemain[0].dokumen_path.slice(7).split(".")[0];
  benda.delete(id);
  rusak.tersalin = rusak.versi;
  S.jam += 10 * 60_000;
  const h = J(gs.rapikan());
  assert.ok(h.galat.some((g) => g.startsWith(`${rusak.kode} rapi:`)), JSON.stringify(h));
  const d = JSON.parse(props.get("DETAK"));
  assert.equal(d.hasil.galat.length, h.galat.length);
  assert.equal(cache.has("rapikan_jalan"), false, "penanda jalan dilepas");
});

console.log(`${lulus} uji Code.gs (utama) lulus`);

/* ── PERAN cermin (akun esportsdesa): salinan penuh dari Drive utama ──── */
{
  const C = buatDunia({ KUNCI: "d4".repeat(32), PERAN: "cermin" });
  const ujiC = (nama, f) => uji(`cermin: ${nama}`, f);
  // "Drive utama" yang dibagikan ke akun cermin: berkas di luar folder TEDNas akun cermin.
  const utama = C.gs.DriveApp.createFolder("TEDNas 2027 — Data Pendaftar (akun utama, dibagikan)");
  const isiUtama = new Map();
  const berkasUtama = (buf, mime, ext) => { const f = utama.createFile(C.blob(C.signed(buf), mime, `${randomUUID()}.${ext}`)); const p = `gdrive/${f.getId()}.${ext}`; isiUtama.set(p, buf); return p; };
  const pemainUtama = (k, n = 5) => Array.from({ length: n }, (_, i) => ({ nama: `Pemain ${k}-${i}`, jenis: i === 1 ? "KK" : "KTP",
    dok: berkasUtama(JPG(`${k}${i}d`), "image/jpeg", "jpg"), ml: berkasUtama(PNG(`${k}${i}m`), "image/png", "png"),
    ig1: berkasUtama(JPG(`${k}${i}a`), "image/jpeg", "jpg"), ig2: berkasUtama(JPG(`${k}${i}b`), "image/jpeg", "jpg"),
    izin: i === 4 ? berkasUtama(PDF(`${k}${i}`), "application/pdf", "pdf") : null }));
  const idDari = (p) => p.slice(7).split(".")[0];
  const sheet = () => C.benda.get(C.props.get("SHEET"));
  const isiFolder = (url) => C.anakDari(C.benda.get(url.split("/").pop()));
  let t1;

  await ujiC("pasang: folder & Sheet sendiri, kunci cermin dicek lewat tednas_cermin_antre", () => {
    C.gs.pasang();
    assert.ok(C.log.some((l) => l === "Peran  : cermin"));
    assert.ok(C.log.some((l) => l === "Supabase: kunci cocok."), C.log.join("\n"));
    assert.equal(C.pemicu.length, 1);
    assert.deepEqual(sheet().getSheets().map((s) => s._nama), ["Tim", "Pemain"]);
  });

  await ujiC("tidak menerima unggahan pendaftar maupun permintaan berkas admin", () => {
    assert.equal(C.post({ aksi: "unggah", mime: "image/jpeg", data: JPG(1).toString("base64") }).pesan, "BUKAN_WEB_APP_UTAMA");
    assert.equal(C.post({ aksi: "berkas", path: "gdrive/1TiruApaSajaxxxxxxxx.jpg", token: "token-admin-sah-0123456789" }).pesan, "BUKAN_WEB_APP_UTAMA");
    assert.equal(JSON.parse(C.gs.doGet().getContent()).peran, "cermin");
    assert.equal(C.post({ aksi: "tim", kunci: "salah", tim: {} }).pesan, "KUNCI_SALAH");
  });

  await ujiC("kabar tim: berkas DISALIN ke folder tim akun ini, Sheet bertaut ke salinan, Drive utama utuh", () => {
    t1 = C.daftarTim("Garuda Cermin", pemainUtama("g"), { lama: true });
    const r = C.kabar("tim", { tim: C.paket(t1) });
    assert.deepEqual(r, { ok: true, disalin: 21 });
    assert.equal(t1.cermin, t1.versi, "cermin_tersalin");
    assert.match(t1.cfolder, /^https:\/\/drive\.google\.com\/drive\/folders\//);
    const isi = isiFolder(t1.cfolder);
    assert.equal(isi.length, 21);
    assert.ok(isi.some((f) => f.getName() === "1. Pemain g-0 — KTP.jpg"));
    assert.ok(isi.some((f) => f.getName() === "2. Pemain g-1 — KK.jpg"));
    assert.ok(isi.some((f) => f.getName() === "5. Pemain g-4 — Izin orang tua.pdf"));
    const p0 = t1.pemain[0].dokumen_path;
    const salinan = isi.find((f) => f.getDescription() === `asal:${idDari(p0)}`);
    assert.ok(salinan && salinan._isi.equals(isiUtama.get(p0)), "isi salinan utuh");
    assert.equal(C.benda.get(idDari(p0))._induk, utama.getId(), "berkas utama tidak dipindah");
    assert.equal(C.benda.get(C.benda.get(t1.cfolder.split("/").pop())._induk)._nama, "35 JAWA TIMUR");
    const tim = sheet().getSheetByName("Tim").data().find((x) => x[0] === t1.kode);
    assert.equal(tim[13], t1.cfolder, "kolom Folder berkas = folder cermin");
    const pem = sheet().getSheetByName("Pemain").data().filter((x) => x[0] === t1.kode);
    assert.equal(pem.length, 5);
    assert.equal(pem[0][7], `https://drive.google.com/file/d/${salinan.getId()}/view`, "tautan ke SALINAN, bukan berkas utama");
    assert.ok(pem.every((x) => !x.join(" ").includes(utama.getId())));
  });

  await ujiC("kabar ulang (verifikasi admin): tidak menyalin lagi, baris diperbarui di tempat", () => {
    t1.status = "terverifikasi"; t1.versi++;
    assert.deepEqual(C.kabar("tim", { tim: C.paket(t1) }), { ok: true, disalin: 0 });
    assert.equal(isiFolder(t1.cfolder).length, 21);
    assert.equal(sheet().getSheetByName("Tim").data().filter((x) => x[0] === t1.kode)[0][9], "Terverifikasi");
    assert.equal(t1.cermin, t1.versi);
  });

  await ujiC("berkas pemain diganti di situs → salinan baru, salinan lama ke tempat sampah; salinan kembar dibereskan", () => {
    const lamaPath = t1.pemain[2].profil_ml_path;
    const lama = isiFolder(t1.cfolder).find((f) => f.getDescription() === `asal:${idDari(lamaPath)}`);
    t1.pemain[2].profil_ml_path = berkasUtama(PNG("ganti"), "image/png", "png");
    t1.versi++;
    // seolah dua eksekusi sempat menyalin berkas yang sama
    const kembar = lama.makeCopy("kembar.png", C.benda.get(t1.cfolder.split("/").pop())).setDescription(lama.getDescription());
    assert.deepEqual(C.kabar("tim", { tim: C.paket(t1) }), { ok: true, disalin: 1 });
    assert.equal(lama.isTrashed() && kembar.isTrashed(), true);
    const baru = isiFolder(t1.cfolder).find((f) => f.getDescription() === `asal:${idDari(t1.pemain[2].profil_ml_path)}`);
    assert.equal(baru.getName(), "3. Pemain g-2 — Profil ML.png");
    assert.equal(isiFolder(t1.cfolder).length, 21);
    assert.equal(sheet().getSheetByName("Pemain").data().filter((x) => x[0] === t1.kode)[2][8], `https://drive.google.com/file/d/${baru.getId()}/view`);
  });

  await ujiC("tim yang sama sedang disalin eksekusi lain → SIBUK (disusulkan pemicu)", () => {
    C.cache.set(`cermin:${t1.kode}`, "1");
    assert.equal(C.kabar("tim", { tim: C.paket(t1) }).pesan, "SIBUK");
    C.cache.delete(`cermin:${t1.kode}`);
  });

  await ujiC("pemicu menyusulkan tim yang tertinggal (dibatasi per putaran) & antrean hapus cermin", () => {
    const banyak = Array.from({ length: 7 }, (_, i) => C.daftarTim(`Susul ${i}`, pemainUtama(`s${i}`, 5), { lama: true }));
    C.S.jam += 10 * 60_000;
    let h = J(C.gs.rapikan());
    assert.equal(h.sheet, 5, JSON.stringify(h));
    h = J(C.gs.rapikan());
    assert.equal(h.sheet, 2);
    assert.ok(banyak.every((t) => t.cermin === t.versi && t.cfolder));
    C.db.chapus.push({ kode: banyak[0].kode, nama_tim: banyak[0].nama_tim });
    C.db.tim = C.db.tim.filter((x) => x.kode !== banyak[0].kode);
    h = J(C.gs.rapikan());
    assert.equal(h.hapus, 1);
    assert.equal(C.db.chapus.length, 0, "tednas_cermin_hapus_selesai dipanggil");
    assert.equal(sheet().getSheetByName("Tim").data().find((x) => x[0] === banyak[0].kode)[9], "DIHAPUS dari situs");
    assert.ok(C.benda.get(banyak[0].cfolder.split("/").pop())._nama.startsWith("[DIHAPUS] "));
  });

  await ujiC("berkas utama belum terbaca (folder utama belum dibagikan) → galat, tim lain tetap jalan", () => {
    const rusak = C.daftarTim("Belum Dibagikan", pemainUtama("r"), { lama: true });
    C.benda.delete(idDari(rusak.pemain[0].dokumen_path));
    const sehat = C.daftarTim("Sehat", pemainUtama("h"), { lama: true });
    C.S.jam += 10 * 60_000;
    const h = J(C.gs.rapikan());
    assert.ok(h.galat.some((g) => g.startsWith(rusak.kode)), JSON.stringify(h));
    assert.equal(rusak.cermin ?? 0, 0, "tidak ditandai tersalin");
    assert.equal(sehat.cermin, sehat.versi);
  });

  await ujiC("tim lama (bucket Supabase): baris tertulis apa adanya, tidak ada yang disalin", () => {
    const lama = C.daftarTim("Tim Lama", Array.from({ length: 5 }, (_, i) => ({ nama: `Lama ${i}`, dok: `dokumen/a${i}.jpg`, ml: `dokumen/b${i}.png`, ig1: `dokumen/c${i}.jpg`, ig2: `dokumen/d${i}.jpg` })), { lama: true });
    assert.deepEqual(C.kabar("tim", { tim: C.paket(lama) }), { ok: true, disalin: 0 });
    assert.equal(sheet().getSheetByName("Pemain").data().find((x) => x[0] === lama.kode)[7], "Supabase: dokumen/a0.jpg");
  });

  await ujiC("form v2: twibbon DISALIN ke folder tim akun ini, WA tiap pemain di Sheet; twibbon diganti → salinan lama dibuang", () => {
    const pem = pemainUtama("w").map((p, i) => (i ? { ...p, wa: `62813111000${i}` } : p));
    const t = C.daftarTim("Cermin Twibbon", pem, { lama: true, twibbon: berkasUtama(JPG("tw"), "image/jpeg", "jpg") });
    assert.deepEqual(C.kabar("tim", { tim: C.paket(t) }), { ok: true, disalin: 22 });
    const s = isiFolder(t.cfolder).find((f) => f.getName() === "Bukti twibbon tim.jpg");
    assert.ok(s && s.getDescription() === `asal:${idDari(t.twibbon_path)}`, "salinan twibbon bertanda asal");
    assert.ok(s._isi.equals(isiUtama.get(t.twibbon_path)));
    assert.equal(C.benda.get(idDari(t.twibbon_path))._induk, utama.getId(), "twibbon utama tidak dipindah");
    const b = sheet().getSheetByName("Tim").data().find((x) => x[0] === t.kode);
    assert.equal(b[11], `https://drive.google.com/file/d/${s.getId()}/view`, "tautan twibbon = SALINAN");
    assert.deepEqual(sheet().getSheetByName("Pemain").data().filter((x) => x[0] === t.kode).map((x) => x[5]), [t.wa_kapten, "628131110001", "628131110002", "628131110003", "628131110004"]);
    t.versi++;
    assert.deepEqual(C.kabar("tim", { tim: C.paket(t) }), { ok: true, disalin: 0 });
    assert.equal(s.isTrashed(), false, "salinan twibbon tidak dianggap berkas usang");
    t.twibbon_path = berkasUtama(PNG("tw2"), "image/png", "png"); t.versi++;
    assert.deepEqual(C.kabar("tim", { tim: C.paket(t) }), { ok: true, disalin: 1 });
    assert.equal(s.isTrashed(), true);
    assert.ok(isiFolder(t.cfolder).some((f) => f.getName() === "Bukti twibbon tim.png"));
    assert.equal(isiFolder(t.cfolder).length, 22);
  });

  await ujiC("cek: folder tim di dalam folder TEDNas akun ini + daftar kode di Sheet", () => {
    const c = C.post({ aksi: "cek", kunci: C.KUNCI, folder: [t1.cfolder, utama.getUrl()], kode: true });
    assert.deepEqual(c.folder, [true, false]);
    assert.ok(c.kode.includes(t1.kode));
  });
  console.log(`${lulus} uji Code.gs lulus (utama + cermin)`);
}


/* ── public/js/drive.js (bagian browser) ──────────────────────────────── */
{
  const { readFileSync } = await import("node:fs");
  const { resolveObjectURL } = await import("node:buffer");
  const kodeJs = readFileSync(new URL("../public/js/drive.js", import.meta.url), "utf8");
  const muat = (url, fetch) => { const w = { APP_CONFIG: { DRIVE_URL: url } }; vm.runInNewContext(kodeJs, { window: w, fetch, btoa, atob, Blob, URL, setTimeout: (f, ms) => (ms > 60000 ? 0 : f()), Math, String, Boolean, Object, Uint8Array, JSON, Error }); return w.DRIVE; };
  const vm = (await import("node:vm")).default;
  await uji("drive.js: nonaktif bila DRIVE_URL kosong/aneh", async () => {
    assert.equal(muat("", null).aktif, false);
    assert.equal(muat("https://evil.example/exec", null).aktif, false);
    await assert.rejects(muat("", null).unggah(new Blob(["x"])), /DRIVE_BELUM_DIATUR/);
  });
  await uji("drive.js: unggah lewat Code.gs (text/plain, base64) & buka berkas admin jadi blob:", async () => {
    let jenis;
    const D = muat("https://script.google.com/macros/s/AKfycbUJI/exec", async (_u, o) => {
      jenis = o.headers["Content-Type"];
      return { text: async () => gs.doPost({ postData: { contents: o.body } }).getContent() };
    });
    assert.equal(D.aktif, true);
    const isi = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("foto dari HP")]);
    const path = await D.unggah(new Blob([isi], { type: "image/jpeg" }));
    assert.match(jenis, /^text\/plain/);
    assert.ok(sahkan(path));
    const url = await D.buka(path.split("~")[0], "token-admin-sah-0123456789");
    const b = resolveObjectURL(url);
    assert.equal(b.type, "image/jpeg");
    assert.ok(Buffer.from(await b.arrayBuffer()).equals(isi));
    await assert.rejects(D.buka(path.split("~")[0], "token-bukan-admin-012345"), /DRIVE_BUKAN_ADMIN/);
  });
  await uji("drive.js: halaman galat Google & SIBUK dicoba ulang, ISI_TIDAK_SAH langsung berhenti", async () => {
    let n = 0;
    const D = muat("https://script.google.com/macros/s/AKfycbUJI/exec", async (_u, o) => {
      n++;
      if (n === 1) throw new TypeError("Failed to fetch");
      if (n === 2) return { text: async () => "<html>Service invoked too many times</html>" };
      if (n === 3) return { text: async () => JSON.stringify({ ok: false, pesan: "SIBUK", ulang: true }) };
      return { text: async () => gs.doPost({ postData: { contents: o.body } }).getContent() };
    });
    assert.ok(sahkan(await D.unggah(new Blob([Buffer.from([0xff, 0xd8, 0xff, 1])], { type: "image/jpeg" }))));
    assert.equal(n, 4);
    n = 10;
    await assert.rejects(D.unggah(new Blob(["bukan jpg"], { type: "image/jpeg" })), /DRIVE_ISI_TIDAK_SAH/);
    assert.equal(n, 11, "tidak dicoba ulang");
  });
  console.log(`${lulus} uji total lulus (Code.gs + drive.js)`);
}
