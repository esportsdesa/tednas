/**
 * TEDNas 2027 — penyimpanan Google Drive (akun pemilik Drive: yanuarardaraja@gmail.com).
 *
 * Satu proyek Apps Script, dua peran:
 *  1. WEB APP (Deploy → Web app, Execute as: Me, Who has access: Anyone)
 *     - aksi "unggah": browser pendaftar mengirim berkas (base64) → disimpan di "Berkas Masuk/<tanggal>"
 *       → dijawab path "gdrive/<id>.<ext>~<tanda HMAC>" yang diperiksa tednas_daftar() di Supabase.
 *     - aksi "tim" / "hapus": dikirim database (pg_net) SEKETIKA tim mendaftar, berubah, atau dihapus
 *       → baris di Sheet ditulis/ditandai. Wajib membawa KUNCI.
 *     - aksi "berkas": halaman admin membuka berkas; wajib membawa token sesi admin Supabase.
 *     Kabar tim baru juga memindahkan berkas tim itu ke folder timnya dengan nama yang terbaca.
 *  2. PEMICU BERKALA `rapikan` (tiap MENIT_PEMICU menit): menyusulkan kabar & perapian yang gagal
 *     (paling banyak RAPI_PER_PUTARAN tim — jatah pemicu Gmail terbatas) dan membuang unggahan yatim.
 *
 *   My Drive
 *   └── TEDNas 2027 — Data Pendaftar
 *       ├── Data Pendaftar TEDNas 2027       (Sheet: tab "Tim" dan "Pemain")
 *       ├── Berkas Masuk / YYYY-MM-DD        (unggahan baru; yang tak dipakai dibuang setelah HARI_YATIM hari)
 *       └── Tim / <kode prov> <Provinsi> / TED-00001 — Nama Tim (Desa, Kabupaten)
 *
 * Sheet = salinan satu arah; mengedit Sheet tidak mengubah data di situs.
 * Panduan pasang: deploy/drive/PASANG.md di repo esportsdesa/tednas.
 */

var VERSI = "2026-11-11";
var KUNCI = "__KUNCI__"; // = tednas_rahasia.drive_rahasia di Supabase. RAHASIA: jangan dibagikan.
var SUPABASE_URL = "https://dlznnpmzccndjqxxhnio.supabase.co";
var SUPABASE_KUNCI_PUBLIK = "sb_publishable_jBDfxJAsqsdLlKD3eK_TVA_9l4voeNS"; // sama dengan public/js/config.js

/** Yang boleh MELIHAT folder (berisi KTP/KK): kosong = hanya pemilik. Bisa juga dibagikan langsung dari Drive. */
var PEMIRSA = [];

var NAMA_FOLDER = "TEDNas 2027 — Data Pendaftar";
var NAMA_SHEET = "Data Pendaftar TEDNas 2027";

/* Akun Gmail biasa: pemicu 90 menit/hari & 20.000 UrlFetch/hari, dibagi dengan skrip lain di akun ini. */
var MENIT_PEMICU = 10;
var BATAS_MS = 4.5 * 60 * 1000;
var MAKS_BYTE = 5 * 1024 * 1024;        // sama dengan batas di daftar.js
var MAKS_UNGGAH_PER_MENIT = 400;        // rem darurat bila ada yang membanjiri Web App
var HARI_YATIM = 7;                     // unggahan yang tak pernah dipakai pendaftaran dibuang setelah ini
var RAPI_PER_PUTARAN = 3;               // ±20 dtk per tim; sisanya putaran berikutnya

var JENIS = { "image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf" };
var BERKAS = [
  { kolom: "dokumen_path", label: "" },             // label = jenis identitas (KTP/KK/…)
  { kolom: "profil_ml_path", label: "Profil ML" },
  { kolom: "follow_esports_path", label: "Follow esportsdesa.official" },
  { kolom: "follow_ppdt_path", label: "Follow ditjen_ppdt" },
  { kolom: "izin_path", label: "Izin orang tua" },
];
var KEPALA_TIM = ["Kode", "Nama tim", "Kapten", "WhatsApp kapten", "Provinsi", "Kabupaten", "Kecamatan", "Desa",
  "Kode desa", "Status", "Jumlah pemain", "Waktu daftar (WIB)", "Folder berkas", "Terakhir disalin (WIB)"];
var KEPALA_PEMAIN = ["Kode tim", "Nama tim", "No", "Peran", "Nama", "Jenis identitas", "Kartu identitas",
  "Profil ML", "Follow @esportsdesa.official", "Follow @ditjen_ppdt", "Izin orang tua"];
var STATUS = { menunggu: "Menunggu verifikasi", terverifikasi: "Terverifikasi" };

/* ── Yang dijalankan orang ────────────────────────────────────────────── */

/** Sekali, SETELAH Deploy → Web app: folder & Sheet, pemicu berkala, daftarkan alamat Web App ke Supabase. */
function pasang() {
  lepas();
  ScriptApp.newTrigger("rapikan").timeBased().everyMinutes(MENIT_PEMICU).create();
  var induk = dasar();
  Logger.log("Folder : " + induk.folder.getUrl());
  Logger.log("Sheet  : " + induk.ss.getUrl());
  if (induk.gagalBagikan.length) Logger.log("GAGAL membagikan ke: " + induk.gagalBagikan.join(" | "));
  var url = alamatWebApp();
  Logger.log("Web App: " + (url || "BELUM DI-DEPLOY — Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone), lalu jalankan pasang lagi."));
  try {
    rpc("tednas_drive_antre", { p_kunci: KUNCI, p_jenis: "sheet", p_batas: 1 });
    Logger.log("Supabase: kunci cocok.");
  } catch (err) {
    Logger.log("Supabase MENOLAK: " + pesanGalat(err) + " — jalankan dulu SQL dari PASANG.md di Supabase.");
  }
  Logger.log("Putaran pertama: " + JSON.stringify(rapikan()));
}

/** Hentikan pemicu berkala (Web App tetap jalan; arsipkan deployment-nya untuk menghentikan unggahan). */
function lepas() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "rapikan") ScriptApp.deleteTrigger(t);
  });
}

/** Darurat: Sheet terhapus permanen. Sheet baru dibuat; tulis ulang semua tim: kosongkan drive_tersalin di Supabase. */
function sheetBaru() {
  PropertiesService.getScriptProperties().deleteProperty("SHEET");
  Logger.log("Sheet baru: " + dasar().ss.getUrl());
}

/* ── Web App ──────────────────────────────────────────────────────────── */

function doGet() {
  return jawab({ ok: true, nama: "TEDNas Drive", versi: VERSI });
}

function doPost(e) {
  var isi;
  try {
    isi = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  } catch (err) {
    return jawab({ ok: false, pesan: "BADAN_TIDAK_SAH" });
  }
  try {
    if (isi.aksi === "unggah") return jawab(unggah(isi));
    if (isi.aksi === "berkas") return jawab(lihatBerkas(isi));
    if (isi.aksi === "tim") return jawab((cekKunci(isi.kunci), kabarTim(isi.tim)));
    if (isi.aksi === "hapus") return jawab((cekKunci(isi.kunci), kabarHapus(isi.kode)));
    return jawab({ ok: false, pesan: "AKSI_TIDAK_DIKENAL" });
  } catch (err) {
    return jawab({ ok: false, pesan: pesanGalat(err) });
  }
}

function jawab(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function cekKunci(k) {
  if (typeof k !== "string" || k !== KUNCI || KUNCI.indexOf("__") === 0) throw new Error("KUNCI_SALAH");
}

/** Satu berkas dari browser pendaftar. Tidak butuh login: dijaga jenis, ukuran, isi, dan rem per menit. */
function unggah(isi) {
  var ext = JENIS[isi.mime];
  if (!ext) return { ok: false, pesan: "JENIS_TIDAK_SAH" };
  if (typeof isi.data !== "string" || isi.data.length === 0 || isi.data.length > Math.ceil(MAKS_BYTE / 3) * 4 + 8) {
    return { ok: false, pesan: "TERLALU_BESAR" };
  }
  if (!jatahUnggah()) return { ok: false, pesan: "SIBUK", ulang: true };
  var bytes = Utilities.base64Decode(isi.data);
  if (bytes.length === 0 || bytes.length > MAKS_BYTE) return { ok: false, pesan: "TERLALU_BESAR" };
  if (!isiCocok(bytes, ext)) return { ok: false, pesan: "ISI_TIDAK_SAH" };
  var f = folderMasuk(tanggalWib(new Date())).createFile(Utilities.newBlob(bytes, isi.mime, Utilities.getUuid() + "." + ext));
  var path = "gdrive/" + f.getId() + "." + ext;
  return { ok: true, path: path + "~" + tanda(path) };
}

/** Tanda tangan isi berkas (byte Apps Script bertanda: -128..127). */
function isiCocok(b, ext) {
  var u = function (i) { return (b[i] + 256) % 256; };
  if (ext === "jpg") return u(0) === 0xff && u(1) === 0xd8 && u(2) === 0xff;
  if (ext === "png") return u(0) === 0x89 && u(1) === 0x50 && u(2) === 0x4e && u(3) === 0x47;
  if (ext === "pdf") return u(0) === 0x25 && u(1) === 0x50 && u(2) === 0x44 && u(3) === 0x46;
  return false;
}

function tanda(path) {
  return hex(Utilities.computeHmacSha256Signature(path, KUNCI));
}

function hex(bytes) {
  return bytes.map(function (x) { return ("0" + ((x + 256) % 256).toString(16)).slice(-2); }).join("");
}

function jatahUnggah() {
  var c = CacheService.getScriptCache();
  var k = "unggah:" + Math.floor(Date.now() / 60000);
  var n = Number(c.get(k) || 0);
  if (n >= MAKS_UNGGAH_PER_MENIT) return false;
  c.put(k, String(n + 1), 180);
  return true;
}

/** Halaman admin membuka berkas: token sesi Supabase harus milik akun di tednas_admin. */
function lihatBerkas(isi) {
  if (!adminSah(isi.token)) return { ok: false, pesan: "BUKAN_ADMIN" };
  var m = /^gdrive\/([A-Za-z0-9_-]{10,100})\.(pdf|jpg|png)$/.exec(String(isi.path || ""));
  if (!m) return { ok: false, pesan: "PATH_TIDAK_SAH" };
  var f;
  try {
    f = DriveApp.getFileById(m[1]);
  } catch (err) {
    return { ok: false, pesan: "BERKAS_TIDAK_ADA" };
  }
  // Hanya berkas di dalam folder TEDNas — token admin tidak boleh membuka berkas lain di Drive pemilik.
  if (!diDalam(f, PropertiesService.getScriptProperties().getProperty("FOLDER"), 4)) return { ok: false, pesan: "BUKAN_BERKAS_TEDNAS" };
  var b = f.getBlob();
  return { ok: true, mime: b.getContentType(), nama: f.getName(), data: Utilities.base64Encode(b.getBytes()) };
}

function adminSah(token) {
  if (typeof token !== "string" || token.length < 20 || token.length > 4096) return false;
  var c = CacheService.getScriptCache();
  var k = "adm:" + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));
  if (c.get(k) === "1") return true;
  var kepala = { apikey: SUPABASE_KUNCI_PUBLIK, Authorization: "Bearer " + token };
  var u = UrlFetchApp.fetch(SUPABASE_URL + "/auth/v1/user", { headers: kepala, muteHttpExceptions: true });
  if (u.getResponseCode() !== 200) return false;
  var id = (JSON.parse(u.getContentText()) || {}).id;
  if (!id) return false;
  var a = UrlFetchApp.fetch(SUPABASE_URL + "/rest/v1/tednas_admin?select=user_id&user_id=eq." + encodeURIComponent(id), { headers: kepala, muteHttpExceptions: true });
  var ok = a.getResponseCode() === 200 && JSON.parse(a.getContentText()).length > 0;
  if (ok) c.put(k, "1", 600);
  return ok;
}

/** Kabar dari database: satu tim (baru/berubah) → baris Tim + Pemain di Sheet. */
function kabarTim(t) {
  if (!t || !/^TED-\d+$/.test(String(t.kode || "")) || !t.id) return { ok: false, pesan: "TIM_TIDAK_SAH" };
  var gembok = LockService.getScriptLock();
  if (!gembok.tryLock(30000)) return { ok: false, pesan: "SIBUK", ulang: true }; // rapikan() menyusul
  try {
    var induk = dasar();
    tulisTim(induk.ss, t);
    namaiFolderTim(t);
  } finally {
    gembok.releaseLock();
  }
  rpc("tednas_drive_selesai", { p_kunci: KUNCI, p_jenis: "sheet", p_tim: t.id, p_versi: t.versi });
  // Tim baru: berkasnya langsung dipindah ke folder tim di eksekusi ini juga (Web App tidak memakan jatah
  // pemicu harian). Gagal di sini tidak apa-apa: rapikan() menyusul lewat antrean "rapi".
  var rapi = !(t.rapi > 0);
  if (rapi) {
    try { rapikanTim(t); } catch (err) { return { ok: true, rapi: false, pesan: pesanGalat(err) }; }
  }
  return { ok: true, rapi: rapi };
}

/** Kabar dari database: tim dihapus admin → ditandai di Sheet (baris & berkas TIDAK dihapus). */
function kabarHapus(kode) {
  if (!/^TED-\d+$/.test(String(kode || ""))) return { ok: false, pesan: "KODE_TIDAK_SAH" };
  var gembok = LockService.getScriptLock();
  if (!gembok.tryLock(30000)) return { ok: false, pesan: "SIBUK", ulang: true };
  try {
    var sh = dasar().ss.getSheetByName("Tim");
    var baris = cariBaris(sh, kode);
    if (baris) sh.getRange(baris, KEPALA_TIM.indexOf("Status") + 1).setValue("DIHAPUS dari situs").setBackground("#f4cccc");
    var p = PropertiesService.getScriptProperties();
    var f = bukaFolder(p.getProperty("TIM_" + kode));
    if (f && f.getName().indexOf("[DIHAPUS] ") !== 0) f.setName("[DIHAPUS] " + f.getName());
  } finally {
    gembok.releaseLock();
  }
  rpc("tednas_drive_hapus_selesai", { p_kunci: KUNCI, p_kode: kode });
  return { ok: true };
}

/* ── Pemicu berkala ───────────────────────────────────────────────────── */

function rapikan() {
  var c = CacheService.getScriptCache();
  if (c.get("rapikan_jalan")) return { lewati: true };
  c.put("rapikan_jalan", "1", 400);
  var mulai = Date.now();
  var habis = function () { return Date.now() - mulai > BATAS_MS; };
  var hasil = { sheet: 0, rapi: 0, hapus: 0, buang: 0, galat: [] };
  try {
    try { daftarkanAlamat(); } catch (err) { hasil.galat.push("alamat: " + pesanGalat(err)); }
    // 1. Kabar yang gagal/terlambat dari database (drive_tersalin < drive_versi) + antrean hapus.
    var a = rpc("tednas_drive_antre", { p_kunci: KUNCI, p_jenis: "sheet", p_batas: 50 });
    (a.hapus || []).forEach(function (h) {
      if (habis()) return;
      try { if (kabarHapus(h.kode).ok) hasil.hapus++; } catch (err) { hasil.galat.push(h.kode + ": " + pesanGalat(err)); }
    });
    (a.tim || []).forEach(function (t) {
      if (habis()) return;
      // Perapian berkas tidak di sini (mahal untuk jatah pemicu) — lihat langkah 2.
      try { if (kabarTim(Object.assign({}, t, { rapi: 1 })).ok) hasil.sheet++; } catch (err) { hasil.galat.push(t.kode + ": " + pesanGalat(err)); }
    });
    // 2. Berkas tim yang belum sempat dipindah ke folder timnya (biasanya sudah oleh kabarTim).
    if (!habis()) {
      var r = rpc("tednas_drive_antre", { p_kunci: KUNCI, p_jenis: "rapi", p_batas: RAPI_PER_PUTARAN });
      (r.tim || []).forEach(function (t) {
        if (habis()) return;
        try { rapikanTim(t); hasil.rapi++; } catch (err) { hasil.galat.push(t.kode + " rapi: " + pesanGalat(err)); }
      });
    }
    // 3. Unggahan yang tak pernah dipakai pendaftaran.
    if (!habis()) {
      try { hasil.buang = buangYatim(habis); } catch (err) { hasil.galat.push("yatim: " + pesanGalat(err)); }
    }
  } finally {
    c.remove("rapikan_jalan");
    PropertiesService.getScriptProperties().setProperty("DETAK", JSON.stringify({ waktu: new Date().toISOString(), hasil: hasil }));
  }
  return hasil;
}

/** Pindahkan & namai berkas satu tim: "1. Nama — KTP.jpg" di folder timnya. */
function rapikanTim(t) {
  var folder = folderTim(t);
  (t.pemain || []).forEach(function (p) {
    BERKAS.forEach(function (b) {
      var m = /^gdrive\/([A-Za-z0-9_-]+)\.(pdf|jpg|png)$/.exec(String(p[b.kolom] || ""));
      if (!m) return; // berkas lama di Supabase / kosong
      // Tiga panggilan per berkas (±0,5 dtk): moveTo ke folder yang sama tidak mengubah apa pun.
      var f = DriveApp.getFileById(m[1]);
      f.moveTo(folder);
      f.setName(p.urutan + ". " + bersih(p.nama) + " — " + (b.label || p.dokumen_jenis) + "." + m[2]);
    });
  });
  var gembok = LockService.getScriptLock();
  if (gembok.tryLock(30000)) {
    try {
      var sh = dasar().ss.getSheetByName("Tim");
      var baris = cariBaris(sh, t.kode);
      if (baris) sh.getRange(baris, KEPALA_TIM.indexOf("Folder berkas") + 1).setValue(folder.getUrl());
    } finally {
      gembok.releaseLock();
    }
  }
  rpc("tednas_drive_selesai", { p_kunci: KUNCI, p_jenis: "rapi", p_tim: t.id, p_versi: t.versi, p_folder: folder.getUrl() });
}

/** Unggahan di "Berkas Masuk/<tanggal>" yang lebih tua dari HARI_YATIM hari dan tidak dipakai → tempat sampah. */
function buangYatim(habis) {
  var p = PropertiesService.getScriptProperties();
  var masuk = bukaFolder(p.getProperty("MASUK"));
  if (!masuk) return 0;
  var batas = tanggalWib(new Date(Date.now() - HARI_YATIM * 86400000));
  var dibuang = 0;
  var hari = masuk.getFolders();
  while (hari.hasNext() && !habis()) {
    var d = hari.next();
    if (!(d.getName() < batas)) continue;
    var isi = [];
    var it = d.getFiles();
    while (it.hasNext() && isi.length < 300) {
      var f = it.next();
      var m = /^[0-9a-f-]+\.(pdf|jpg|png)$/i.exec(f.getName());
      if (m) isi.push({ f: f, path: "gdrive/" + f.getId() + "." + m[1].toLowerCase() });
    }
    if (isi.length === 0) {
      if (!d.getFiles().hasNext()) { d.setTrashed(true); p.deleteProperty("MASUK_" + d.getName()); }
      continue;
    }
    var dipakai = {};
    for (var i = 0; i < isi.length; i += 200) {
      (rpc("tednas_drive_dipakai", { p_kunci: KUNCI, p_paths: isi.slice(i, i + 200).map(function (x) { return x.path; }) }) || [])
        .forEach(function (x) { dipakai[x] = true; });
    }
    isi.forEach(function (x) {
      if (!dipakai[x.path]) { x.f.setTrashed(true); dibuang++; }
    });
  }
  return dibuang;
}

/* ── Supabase ─────────────────────────────────────────────────────────── */

function rpc(nama, isi) {
  var r = UrlFetchApp.fetch(SUPABASE_URL + "/rest/v1/rpc/" + nama, {
    method: "post",
    contentType: "application/json",
    headers: { apikey: SUPABASE_KUNCI_PUBLIK },
    payload: JSON.stringify(isi),
    muteHttpExceptions: true,
  });
  var kode = r.getResponseCode();
  var teks = r.getContentText();
  if (kode < 200 || kode >= 300) {
    var pesan = teks;
    try { pesan = JSON.parse(teks).message || teks; } catch (err) { /* teks apa adanya */ }
    throw new Error("Supabase " + kode + " " + nama + ": " + String(pesan).slice(0, 200));
  }
  return teks ? JSON.parse(teks) : null;
}

/** Alamat /exec Web App ini, atau "" bila belum di-deploy. */
function alamatWebApp() {
  try {
    var u = ScriptApp.getService().getUrl() || "";
    return /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(u) ? u : "";
  } catch (err) {
    return "";
  }
}

/** Database perlu tahu alamat Web App untuk mengirim kabar; didaftarkan ulang bila berubah. */
function daftarkanAlamat() {
  var u = alamatWebApp();
  var p = PropertiesService.getScriptProperties();
  if (!u || p.getProperty("ALAMAT_TERDAFTAR") === u) return;
  rpc("tednas_drive_setel_url", { p_kunci: KUNCI, p_url: u });
  p.setProperty("ALAMAT_TERDAFTAR", u);
}

/* ── Folder & Sheet ───────────────────────────────────────────────────── */

function dasar() {
  var p = PropertiesService.getScriptProperties();
  var folder = bukaFolder(p.getProperty("FOLDER"));
  if (!folder) {
    folder = DriveApp.createFolder(NAMA_FOLDER);
    p.setProperty("FOLDER", folder.getId());
    var gagal = [];
    var saya = pemilikSkrip();
    PEMIRSA.forEach(function (email) {
      if (email.toLowerCase() === saya) return;
      try { folder.addViewer(email); } catch (err) { gagal.push(email + ": " + pesanGalat(err)); }
    });
    p.setProperty("GAGAL_BAGIKAN", JSON.stringify(gagal));
  }
  var ss = bukaSheet(p.getProperty("SHEET"));
  if (!ss) {
    ss = SpreadsheetApp.create(NAMA_SHEET);
    p.setProperty("SHEET", ss.getId());
    DriveApp.getFileById(ss.getId()).moveTo(folder);
    var tim = ss.getSheets()[0];
    tim.setName("Tim");
    pasangKepala(tim, KEPALA_TIM);
    pasangKepala(ss.insertSheet("Pemain"), KEPALA_PEMAIN);
  }
  var gagalBagikan = [];
  try { gagalBagikan = JSON.parse(p.getProperty("GAGAL_BAGIKAN") || "[]"); } catch (err) { gagalBagikan = []; }
  return { folder: folder, ss: ss, gagalBagikan: gagalBagikan };
}

/** Subfolder `nama` di `induk`, id disimpan di properti `kunci`. Dibuat di bawah gembok supaya tidak kembar. */
function folderAnak(induk, kunci, nama) {
  var p = PropertiesService.getScriptProperties();
  var f = bukaFolder(p.getProperty(kunci));
  if (f) return f;
  var gembok = LockService.getScriptLock();
  gembok.waitLock(20000);
  try {
    f = bukaFolder(p.getProperty(kunci));
    if (!f) {
      f = induk().createFolder(nama);
      p.setProperty(kunci, f.getId());
    }
    return f;
  } finally {
    gembok.releaseLock();
  }
}

/** Folder unggahan hari ini — jalur paling sering (tiap unggahan): satu panggilan Drive bila sudah ada. */
function folderMasuk(tgl) {
  return folderAnak(function () {
    return folderAnak(function () { return dasar().folder; }, "MASUK", "Berkas Masuk");
  }, "MASUK_" + tgl, tgl);
}

function folderTim(t) {
  var prov = folderAnak(function () {
    return folderAnak(function () { return dasar().folder; }, "TIM", "Tim");
  }, "PROV_" + t.prov_kode, t.prov_kode + " " + bersih(t.provinsi));
  var f = folderAnak(function () { return prov; }, "TIM_" + t.kode, namaFolderTim(t));
  if (f.getName() !== namaFolderTim(t) && f.getName().indexOf("[DIHAPUS] ") !== 0) f.setName(namaFolderTim(t));
  return f;
}

function namaFolderTim(t) {
  return t.kode + " — " + bersih(t.nama_tim) + " (" + bersih(t.desa) + ", " + bersih(t.kabupaten) + ")";
}

/** Nama tim berubah → folder timnya (bila sudah ada) ikut diganti. */
function namaiFolderTim(t) {
  var f = bukaFolder(PropertiesService.getScriptProperties().getProperty("TIM_" + t.kode));
  if (f && f.getName() !== namaFolderTim(t) && f.getName().indexOf("[DIHAPUS] ") !== 0) f.setName(namaFolderTim(t));
}

/** Apakah `f` ada di dalam folder `idInduk` (sampai `dalam` tingkat ke atas)? */
function diDalam(f, idInduk, dalam) {
  if (!idInduk) return false;
  var lapis = [f];
  for (var d = 0; d < dalam && lapis.length; d++) {
    var berikut = [];
    for (var i = 0; i < lapis.length; i++) {
      var it = lapis[i].getParents();
      while (it.hasNext()) {
        var x = it.next();
        if (x.getId() === idInduk) return true;
        berikut.push(x);
      }
    }
    lapis = berikut;
  }
  return false;
}

function ulangi(kerja) {
  var galat;
  for (var i = 0; i < 3; i++) {
    try { return kerja(); } catch (err) { galat = err; if (i < 2) Utilities.sleep(1500 * (i + 1)); }
  }
  throw galat;
}

/* Null HANYA bila id belum pernah disimpan atau barangnya di tempat sampah; galat lain DILEMPAR
   (pelajaran JES 7 Okt 2026: galat sesaat dianggap "terhapus" → Sheet kembar, data terbelah). */
function bukaFolder(id) {
  if (!id) return null;
  return ulangi(function () {
    var f = DriveApp.getFolderById(id);
    return f.isTrashed() ? null : f;
  });
}

function bukaSheet(id) {
  if (!id) return null;
  if (ulangi(function () { return DriveApp.getFileById(id).isTrashed(); })) return null;
  return ulangi(function () { return SpreadsheetApp.openById(id); });
}

/* ── Menulis Sheet ────────────────────────────────────────────────────── */

function tautan(path) {
  var s = String(path || "");
  var m = /^gdrive\/([A-Za-z0-9_-]+)\./.exec(s);
  if (m) return "https://drive.google.com/file/d/" + m[1] + "/view";
  return s ? "Supabase: " + s : "";
}

function tulisTim(ss, t) {
  var pemain = (t.pemain || []).slice().sort(function (a, b) { return a.urutan - b.urutan; });
  var shTim = ss.getSheetByName("Tim");
  var baris = cariBaris(shTim, t.kode);
  var folderLama = baris ? String(shTim.getRange(baris, KEPALA_TIM.indexOf("Folder berkas") + 1).getValues()[0][0] || "") : "";
  if (!baris) baris = Math.max(shTim.getLastRow(), 1) + 1;
  tulis(shTim, baris, [[
    t.kode, t.nama_tim, t.nama_kapten, t.wa_kapten, t.provinsi, t.kabupaten, t.kecamatan, t.desa, t.desa_kode,
    STATUS[t.status] || t.status, String(pemain.length), waktuWib(t.created_at), t.folder || folderLama, waktuWib(new Date().toISOString()),
  ]]);
  shTim.getRange(baris, KEPALA_TIM.indexOf("Status") + 1).setBackground(null);

  var isi = pemain.map(function (p) {
    return [t.kode, t.nama_tim, String(p.urutan), p.urutan === 1 ? "Kapten" : p.urutan === 6 ? "Cadangan" : "Pemain",
      p.nama, p.dokumen_jenis, tautan(p.dokumen_path), tautan(p.profil_ml_path), tautan(p.follow_esports_path),
      tautan(p.follow_ppdt_path), tautan(p.izin_path)];
  });
  // Baris pemain satu tim selalu bersebelahan: ditimpa di tempat bila jumlahnya sama, selain itu diganti.
  var shP = ss.getSheetByName("Pemain");
  var blok = cariBlok(shP, t.kode);
  if (blok && blok.n === isi.length) {
    if (isi.length) tulis(shP, blok.awal, isi);
    return;
  }
  if (blok) shP.deleteRows(blok.awal, blok.n);
  if (isi.length) tulis(shP, Math.max(shP.getLastRow(), 1) + 1, isi);
}

/** Nomor baris (≥2) yang kolom A-nya = kode; 0 bila tidak ada. */
function cariBaris(sh, kode) {
  var akhir = sh.getLastRow();
  if (akhir < 2) return 0;
  var kolom = sh.getRange(2, 1, akhir - 1, 1).getValues();
  for (var i = 0; i < kolom.length; i++) if (String(kolom[i][0]) === kode) return i + 2;
  return 0;
}

/** Rentang baris berurutan yang kolom A-nya = kode: { awal, n } atau null. */
function cariBlok(sh, kode) {
  var akhir = sh.getLastRow();
  if (akhir < 2) return null;
  var kolom = sh.getRange(2, 1, akhir - 1, 1).getValues();
  var awal = -1, n = 0;
  for (var i = 0; i < kolom.length; i++) {
    if (String(kolom[i][0]) === kode) {
      if (awal < 0) awal = i;
      n = i - awal + 1;
    }
  }
  return awal < 0 ? null : { awal: awal + 2, n: n };
}

function pasangKepala(sh, kepala) {
  sh.getRange(1, 1, 1, kepala.length).setValues([kepala]).setFontWeight("bold");
  sh.setFrozenRows(1);
}

/** Tulis sebagai TEKS: tanpa format "@" Sheet memangkas nol depan dan mengubah nomor WA jadi notasi ilmiah. */
function tulis(sh, barisAwal, nilai) {
  var butuh = barisAwal + nilai.length - 1;
  if (sh.getMaxRows() < butuh) sh.insertRowsAfter(sh.getMaxRows(), butuh - sh.getMaxRows() + 50);
  var r = sh.getRange(barisAwal, 1, nilai.length, nilai[0].length);
  r.setNumberFormat("@");
  r.setValues(nilai.map(function (b) { return b.map(function (x) { return x == null ? "" : String(x); }); }));
}

/* ── Kecil-kecil ──────────────────────────────────────────────────────── */

function bersih(s) {
  return String(s == null ? "" : s).replace(/[\\/:*?"<>|\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

function tanggalWib(d) {
  return new Date(d.getTime() + 7 * 3600000).toISOString().slice(0, 10);
}

function waktuWib(iso) {
  var t = Date.parse(iso || "");
  return isNaN(t) ? "" : new Date(t + 7 * 3600000).toISOString().slice(0, 16).replace("T", " ");
}

function pesanGalat(err) {
  return String((err && err.message) || err).slice(0, 300);
}

function pemilikSkrip() {
  try { return String(Session.getEffectiveUser().getEmail() || "").toLowerCase(); } catch (err) { return ""; }
}
