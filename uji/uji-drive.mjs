/**
 * Uji deploy/drive/Code.gs tanpa login Google: skrip dijalankan di Node (vm) melawan Drive, Sheets, Cache,
 * Lock, dan Supabase TIRUAN. Supabase tiruan meniru kontrak migration-8-drive.sql — nama parameter tiap RPC
 * dicocokkan langsung dengan tanda tangan fungsi di berkas migrasi itu (perilaku SQL-nya diuji uji-sql.mjs).
 *   node uji/uji-drive.mjs
 */
import assert from "node:assert/strict";
import { buatDunia } from "./tiruan-google.mjs";

const URL_EXEC = "https://script.google.com/macros/s/AKfycbTEDNASuji0123456789abcdefghij/exec";
let lulus = 0;
const uji = async (nama, f) => { try { await f(); lulus++; } catch (e) { console.error(`GAGAL: ${nama}\n`, e); process.exit(1); } };

const { S, KUNCI, J, gs, db, benda, hitung, props, cache, pemicu, log, ROOT_DRIVE, folderBernama, anakDari, sahkan, daftarTim, paket, kabar, post, blob, signed } = buatDunia();
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
  assert.equal(b[9], "Menunggu verifikasi"); assert.equal(b[10], "5"); assert.equal(b[11], "2026-11-11 10:02");
  assert.equal(b[12], t1.folder, "kolom Folder berkas");
  const pem = ss.getSheetByName("Pemain").data();
  assert.equal(pem.length, 5);
  assert.deepEqual(pem.map((x) => x[3]), ["Kapten", "Pemain", "Pemain", "Pemain", "Pemain"]);
  assert.match(pem[0][6], /^https:\/\/drive\.google\.com\/file\/d\/1Tiru\w+\/view$/);
  assert.equal(pem[4][10] !== "", true, "izin orang tua pemain 5"); assert.equal(pem[0][10], "");
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
  assert.equal(pem[0][6], "Supabase: dokumen/a0.jpg");
  assert.equal(anakDari(benda.get(lama.folder.split("/").pop())).length, 0);
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

console.log(`${lulus} uji Code.gs lulus`);

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
