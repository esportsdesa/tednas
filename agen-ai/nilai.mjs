/**
 * Penilaian berkas pendaftar TEDNas: pertanyaan untuk model penglihatan dan aturan peraturan turnamen.
 * Murni (tanpa jaringan/berkas), supaya bisa diuji tuntas: uji/uji-ai.mjs.
 *
 * AI hanya MEMBACA isi gambar. Keputusan "sesuai/tidak" diambil kode di bawah dari hasil bacaan itu, jadi
 * aturannya bisa diperiksa orang. Tim yang lolos langsung Terverifikasi (permintaan user 16 Nov 2026, dijalankan
 * tednas_ai_simpan di database); tim yang "cek" tetap Menunggu sampai admin memutuskan.
 */
import { PROVINSI, KABKOTA } from "./wilayah.mjs";

// v2 (16 Nov): identitas apa pun yang memuat nama & alamat (KTP/KK/KIA/kartu pelajar/suket/SIM/lain);
// domisili = SATU PROVINSI dengan tim (bukan lagi sekabupaten); nama tim bebas (hanya dicek kepantasannya).
// v3 (16 Nov, dari hasil nyata pertama): satu foto berisi beberapa kartu → baca kartu orang itu saja; foto
// identitas/izin yang sama untuk beberapa pemain BUKAN ganda (KK bersama, foto kartu sekelas); inisial nama diterima.
export const VERSI_AGEN = 3;
export const TANGGAL_ACUAN = "2027-01-15"; // Peraturan A: "Berusia 15–30 tahun per 15 Januari 2027"
export const UMUR_MIN = 15, UMUR_MAKS = 30, UMUR_IZIN = 17;
export const AKUN_IG = { follow_esports_path: "esportsdesa.official", follow_ppdt_path: "ditjen_ppdt" };

/* ── Pertanyaan untuk model (format = JSON Schema; server model memaksa keluaran mengikuti skema) ── */

const obj = (props) => ({ type: "object", properties: props, required: Object.keys(props) });
const S = { type: "string" }, B = { type: "boolean" };
const JENIS_DOK = ["KTP", "KK", "KIA", "Kartu Pelajar", "Suket", "SIM", "lain", "bukan_identitas", "tidak_terbaca"];

export function tanyaIdentitas(jenis, nama) {
  return {
    prompt: `Ini foto dokumen identitas seorang pendaftar turnamen esports desa. Pendaftar menyebutnya "${jenis}" atas nama "${nama}".
Dokumen yang diterima: KTP, KK (Kartu Keluarga), KIA (Kartu Identitas Anak), Kartu Pelajar, Suket (surat keterangan domisili dari RT/RW/desa/kelurahan), SIM, atau dokumen identitas lain yang memuat nama dan alamat.
Baca isinya PERSIS seperti tertulis, jangan menebak. Kosongkan isian yang tidak tertulis atau tidak terbaca.
PENTING: foto bisa memuat lebih dari satu orang, misalnya beberapa kartu pelajar sekaligus atau KK dengan banyak anggota keluarga. Pilih SATU orang yang namanya paling mirip dengan "${nama}", lalu baca hanya data orang itu (dan dokumennya). Bila tidak ada yang mirip, kosongkan nama.
- jenis_dokumen: KTP, KK, KIA, Kartu Pelajar, Suket, SIM, lain (identitas lain), bukan_identitas (bukan dokumen identitas sama sekali), atau tidak_terbaca.
- terbaca: false bila foto buram atau terpotong sampai nama dan alamat tidak terbaca.
- nama: nama orang itu, persis seperti tertulis (kosong bila tidak ada yang mirip dengan "${nama}").
- nik: 16 digit NIK orang itu, tanpa spasi.
- tanggal_lahir: tanggal lahir orang itu, format YYYY-MM-DD.
- alamat_dari: "pemilik" bila dokumen memuat alamat tempat tinggal orang itu; "sekolah" bila hanya ada alamat sekolah (kartu pelajar); "tidak_ada" bila tidak ada alamat sama sekali.
- desa_kelurahan, kecamatan, kabupaten_kota, provinsi: dari alamat itu. Di KTP provinsi tertulis di baris paling atas ("PROVINSI ...") dan kabupaten/kota di baris kedua. Tulis kabupaten_kota lengkap dengan kata KABUPATEN atau KOTA bila tertulis.
- sekolah: nama sekolah (untuk kartu pelajar).`,
    format: obj({
      jenis_dokumen: { type: "string", enum: JENIS_DOK }, terbaca: B, nama: S, nik: S, tanggal_lahir: S,
      alamat_dari: { type: "string", enum: ["pemilik", "sekolah", "tidak_ada"] },
      desa_kelurahan: S, kecamatan: S, kabupaten_kota: S, provinsi: S, sekolah: S,
    }),
  };
}

export function tanyaProfilMl(nama) {
  return {
    prompt: `Ini tangkapan layar yang dikirim sebagai bukti akun Mobile Legends: Bang Bang milik pendaftar "${nama}".
- profil_mlbb: true hanya bila ini halaman profil akun di gim Mobile Legends: Bang Bang (ada nickname dan ID akun).
- nickname: nama akun di gim, persis seperti tertulis.
- id_akun: angka ID akun (angka sebelum tanda kurung), persis seperti tertulis.
- server: angka server/zona di dalam tanda kurung.
Kosongkan yang tidak terlihat.`,
    format: obj({ profil_mlbb: B, nickname: S, id_akun: S, server: S }),
  };
}

export function tanyaFollow(akun) {
  return {
    prompt: `Ini tangkapan layar yang dikirim sebagai bukti pendaftar sudah mengikuti (follow) akun Instagram @${akun}.
- instagram: true bila ini tangkapan layar aplikasi atau situs Instagram.
- akun_terlihat: true bila username @${akun} terlihat di layar.
- username_profil: username akun yang halaman profilnya sedang dibuka (tanpa @), kosong bila bukan halaman profil.
- status: "mengikuti" bila @${akun} tampak SUDAH diikuti: tombol abu-abu "Mengikuti" atau "Following" di profil @${akun}, atau @${akun} ada di daftar "Mengikuti" milik pengguna. "belum_mengikuti" bila tombolnya biru "Ikuti", "Follow", "Ikuti balik", atau "Follow back". "tidak_terlihat" bila tidak bisa dipastikan.`,
    format: obj({ instagram: B, akun_terlihat: B, username_profil: S, status: { type: "string", enum: ["mengikuti", "belum_mengikuti", "tidak_terlihat"] } }),
  };
}

export function tanyaIzin(nama) {
  return {
    prompt: `Ini berkas yang dikirim sebagai surat izin orang tua/wali bagi pendaftar "${nama}" (di bawah 17 tahun) untuk mengikuti turnamen esports.
- surat_izin: true bila ini surat izin atau persetujuan dari orang tua atau wali.
- nama_anak: nama anak/peserta yang diizinkan, persis seperti tertulis.
- nama_ortu: nama orang tua/wali yang memberi izin.
- ada_tanda_tangan: true bila ada tanda tangan orang tua/wali.`,
    format: obj({ surat_izin: B, nama_anak: S, nama_ortu: S, ada_tanda_tangan: B }),
  };
}

export function tanyaNamaTim(namaTim) {
  return {
    prompt: `Nama tim turnamen esports desa: "${namaTim}". Nama tim bebas, asal tidak mengandung SARA, pornografi, atau politik praktis.
- pantas: false HANYA bila nama itu jelas mengandung SARA, kata kasar/pornografi, atau politik praktis (nama partai, calon, slogan kampanye). Nama desa, kata "esports", "squad", "team", nama hewan, plesetan, dan sejenisnya pantas.
- alasan: satu kalimat singkat, kosong bila pantas.`,
    format: obj({ pantas: B, alasan: S }),
  };
}

/* ── Pembanding teks ──────────────────────────────────────────────────── */

export const huruf = (s) => String(s ?? "").toUpperCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const rapat = (s) => huruf(s).replace(/\s/g, "");

function jarak(a, b) { // Levenshtein
  if (a === b) return 0;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
const toleransi = (s) => (s.length >= 8 ? 2 : s.length >= 5 ? 1 : 0);
const mirip = (a, b) => jarak(a, b) <= Math.min(toleransi(a), toleransi(b));

const SINGKATAN = { M: "MUHAMMAD", MUH: "MUHAMMAD", MUHAMAD: "MUHAMMAD", MUHAMMAD: "MUHAMMAD", MOHAMMAD: "MUHAMMAD", MOHAMAD: "MUHAMMAD",
  MOCH: "MUHAMMAD", MOCHAMAD: "MUHAMMAD", MOCHAMMAD: "MUHAMMAD", MOH: "MUHAMMAD", MHD: "MUHAMMAD", MUHHAMAD: "MUHAMMAD", MOHD: "MUHAMMAD",
  AHMAD: "AHMAD", ACHMAD: "AHMAD", AHMAT: "AHMAD", ABD: "ABDUL", ABDUL: "ABDUL" };
// Tiap kata: r = apa adanya, m = setelah singkatan Muhammad/Ahmad/Abdul diseragamkan.
const kataNama = (s) => huruf(s).split(" ").filter(Boolean).map((r) => ({ r, m: SINGKATAN[r] || r }));
const kataCocok = (a, b) => a.m === b.m || mirip(a.m, b.m) || mirip(a.r, b.r) // salah ketik sebelum diseragamkan: "Muhamah" ~ "MUHAMAD"
  || (a.m.length >= 3 && b.m.length >= 3 && (a.m.startsWith(b.m) || b.m.startsWith(a.m)))
  // inisial: "Muhammad Alif A." = "MUHAMMAD ALIF AZIZI"
  || (a.r.length === 1 && b.r.startsWith(a.r)) || (b.r.length === 1 && a.r.startsWith(b.r));

/** Nama yang didaftarkan vs nama di dokumen. Cocok bila semua kata dari nama yang lebih pendek ada di yang lain
 *  (salah ketik kecil, singkatan Muhammad/M., inisial, dan nama panggilan yang merupakan bagian nama lengkap
 *  diterima). Minimal satu kata utuh (bukan inisial) harus cocok. */
export function namaCocok(didaftar, diDokumen) {
  const a = kataNama(didaftar), b = kataNama(diDokumen);
  if (!a.length || !b.length) return false;
  const [pendek, panjang] = a.length <= b.length ? [a, b] : [b, a];
  const sisa = [...panjang];
  let utuh = 0;
  for (const k of pendek) {
    const i = sisa.findIndex((x) => kataCocok(k, x));
    if (i < 0) return false;
    if (k.r.length > 1 && sisa[i].r.length > 1) utuh++;
    sisa.splice(i, 1);
  }
  if (!utuh) return false;
  // Satu kata pendek saja (mis. "Adi") baru cocok bila sama persis dengan salah satu kata nama dokumen.
  if (pendek.length === 1 && pendek[0].m.length < 4) return panjang.some((x) => x.m === pendek[0].m);
  return true;
}

/* ── Wilayah: provinsi domisili dari alamat di dokumen ────────────────── */

const AWALAN_WILAYAH = /^(KABUPATEN|KAB|KOTA ADMINISTRASI|KOTA ADM|KOTA|ADMINISTRASI|ADM)\b\s*/;
const intiWilayah = (s) => { let x = huruf(s); for (let i = 0; i < 2; i++) x = x.replace(AWALAN_WILAYAH, ""); return x.replace(/\s/g, ""); };
const jenisKab = (s) => { const x = huruf(s); return /^KOTA\b/.test(x) ? "KOTA" : /^KAB(UPATEN)?\b/.test(x) ? "KAB" : ""; };
const KAB = KABKOTA.map(([kode, nama]) => ({ kode, prov: kode.slice(0, 2), nama, jenis: jenisKab(nama), inti: intiWilayah(nama) }));
export const namaKab = (kode) => KAB.find((k) => k.kode === kode)?.nama || kode;

/** Kabupaten/kota yang cocok dengan tulisan di dokumen. Tanpa awalan, "MALANG" = Kab. Malang & Kota Malang. */
export function cariKabKota(teks) {
  const j = jenisKab(teks), inti = intiWilayah(teks);
  if (!inti) return [];
  const saring = (f) => KAB.filter((k) => (!j || k.jenis === j) && f(k.inti));
  const persis = saring((x) => x === inti);
  return persis.length ? persis : saring((x) => mirip(x, inti));
}

// Singkatan & nama lama provinsi yang lazim tertulis di dokumen (dibandingkan tanpa spasi).
const ALIAS_PROV = Object.fromEntries(Object.entries({
  11: ["NAD", "NANGGROE ACEH DARUSSALAM", "DAERAH ISTIMEWA ACEH", "DI ACEH"], 12: ["SUMUT"], 13: ["SUMBAR"], 16: ["SUMSEL"],
  19: ["BABEL", "BANGKA BELITUNG", "KEP BANGKA BELITUNG"], 21: ["KEPRI", "KEP RIAU"],
  31: ["DKI", "DKI JAKARTA", "JAKARTA", "DAERAH KHUSUS JAKARTA"], 32: ["JABAR"], 33: ["JATENG"], 35: ["JATIM"],
  34: ["DIY", "DI YOGYAKARTA", "YOGYAKARTA", "JOGJAKARTA", "DI JOGJAKARTA", "DAERAH ISTIMEWA JOGJAKARTA"],
  52: ["NTB"], 53: ["NTT"], 61: ["KALBAR"], 62: ["KALTENG"], 63: ["KALSEL"], 64: ["KALTIM"], 65: ["KALTARA"],
  71: ["SULUT"], 72: ["SULTENG"], 73: ["SULSEL"], 74: ["SULTRA"], 76: ["SULBAR"], 82: ["MALUT"], 91: ["IRIAN JAYA"], 92: ["IRIAN JAYA BARAT"],
}).flatMap(([k, a]) => a.map((x) => [rapat(x), String(k)])));

/** Kode provinsi dari tulisan di dokumen ("PROVINSI JAWA TIMUR", "D.I. YOGYAKARTA", "NTB"); null bila tak dikenali. */
export function kodeProvinsi(teks) {
  const x = rapat(huruf(teks).replace(/^(PROVINSI|PROPINSI|PROV)\b\s*/, ""));
  if (!x) return null;
  if (ALIAS_PROV[x]) return ALIAS_PROV[x];
  const persis = Object.entries(PROVINSI).find(([, n]) => rapat(n) === x);
  if (persis) return persis[0];
  const dekat = Object.entries(PROVINSI).filter(([, n]) => mirip(rapat(n), x));
  return dekat.length === 1 ? dekat[0][0] : null;
}

/**
 * Provinsi domisili pemain. Kabupaten/kota didahulukan karena memberi provinsi TERKINI (KTP lama dari daerah
 * pemekaran, mis. Merauke, masih bertulis "PAPUA" padahal kini Papua Selatan); provinsi tertulis dipakai bila
 * kabupaten/kota tidak terbaca atau ambigu.
 * → { prov: kode|null, kab: kode|null (null bila tak pasti), pemekaran: provinsi tertulis ≠ provinsi kabupatennya }
 */
export function domisili(id) {
  const kab = cariKabKota(id?.kabupaten_kota), tulis = kodeProvinsi(id?.provinsi);
  const dariKab = [...new Set(kab.map((k) => k.prov))];
  const prov = dariKab.length === 1 ? dariKab[0] : dariKab.includes(tulis) || !dariKab.length ? tulis : null;
  const kabPas = kab.filter((k) => k.prov === prov);
  return { prov, kab: kabPas.length === 1 ? kabPas[0].kode : null, pemekaran: !!(tulis && prov && tulis !== prov && dariKab.length === 1) };
}

/* ── Tanggal & umur ───────────────────────────────────────────────────── */

const tanggalSah = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCMonth() === +m[2] - 1 && +m[1] >= 1940 && +m[1] <= 2026 ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

/** Umur penuh pada tanggal acuan. */
export function umurPada(lahir, acuan = TANGGAL_ACUAN) {
  const l = tanggalSah(lahir); if (!l) return null;
  const [ly, lm, ld] = l.split("-").map(Number), [ay, am, ad] = acuan.split("-").map(Number);
  return ay - ly - (am < lm || (am === lm && ad < ld) ? 1 : 0);
}

export const nikBersih = (s) => String(s || "").replace(/[^0-9]/g, "");

/** NIK digit 7–12 = tgl-bln-thn lahir (tanggal +40 untuk perempuan). */
export function lahirDariNik(nik) {
  const n = nikBersih(nik); if (n.length !== 16) return null;
  let dd = +n.slice(6, 8); const mm = +n.slice(8, 10), yy = +n.slice(10, 12);
  if (dd > 40) dd -= 40;
  const tahun = yy <= 26 ? 2000 + yy : 1900 + yy;
  return tanggalSah(`${tahun}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`);
}

/** Tanggal lahir dari hasil baca identitas: yang tertulis, atau yang tersirat di NIK. */
export const lahirIdentitas = (id) => (id && !id.galat ? tanggalSah(id.tanggal_lahir) || lahirDariNik(id.nik) : null);

export const samarkanNik = (nik) => { const n = nikBersih(nik); return n.length >= 10 ? n.slice(0, 4) + "*".repeat(n.length - 8) + n.slice(-4) : ""; };

/* ── Penilaian satu tim ───────────────────────────────────────────────── */

/**
 * @param tim     paket tim (tednas_ai_antre): nama_tim, prov_kode, provinsi, kab_kode, kabupaten, desa, pemain[]
 * @param baca    { [urutan]: { identitas, profil_ml, follow_esports_path, follow_ppdt_path, izin } } hasil bacaan AI;
 *                tiap entri bisa { galat: "…" } (berkas tak ada / tak terbaca) atau undefined (tak diunggah)
 * @param namaTim hasil tanyaNamaTim (boleh null)
 * @param sha     { [urutan]: { kolom: sha } } untuk berkas sama dipakai dua kali oleh satu pemain
 * → { hasil: "lolos"|"cek", ringkas, rincian, identitas }
 * Butir: s = "cek" (perlu dilihat admin) | "info" (dicatat saja) | "ok".
 * Pemain yang sama di dua tim (NIK/ID ML/berkas sama) dinilai database (tednas_ai_ganda_hitung), bukan di sini.
 */
export function nilaiTim(tim, baca, namaTim, sha = {}) {
  const pemain = [], timButir = [], identitas = [];

  for (const p of tim.pemain || []) {
    const b = baca[p.urutan] || {}, butir = [], data = {};
    const cek = (berkas, t) => butir.push({ b: berkas, s: "cek", t });
    const info = (berkas, t) => butir.push({ b: berkas, s: "info", t });
    const ok = (berkas, t) => butir.push({ b: berkas, s: "ok", t });

    // 1. Identitas
    const id = b.identitas;
    let umur = null;
    if (!id) cek("identitas", "Berkas identitas tidak ada.");
    else if (id.galat) cek("identitas", id.galat);
    else if (id.jenis_dokumen === "bukan_identitas") cek("identitas", "Berkas identitas bukan dokumen identitas (KTP/KK/KIA/kartu pelajar/surat keterangan/SIM).");
    else if (!id.terbaca || id.jenis_dokumen === "tidak_terbaca") cek("identitas", "Foto identitas tidak terbaca (buram atau terpotong).");
    else {
      const dok = id.jenis_dokumen === "lain" ? "Identitas lain" : id.jenis_dokumen;
      data.dok = dok;
      data.nama = id.nama || "";
      if (!id.nama) cek("identitas", id.jenis_dokumen === "KK" ? `Nama "${p.nama}" tidak ditemukan di KK.` : "Nama di dokumen tidak terbaca.");
      else if (!namaCocok(p.nama, id.nama)) cek("identitas", `Nama di dokumen "${id.nama}" tidak sama dengan nama terdaftar "${p.nama}".`);

      const nik = nikBersih(id.nik);
      if (nik.length === 16) { data.nik = samarkanNik(nik); data._nik = nik; }
      else if (nik && ["KTP", "KK", "KIA"].includes(id.jenis_dokumen)) info("identitas", "NIK terbaca tidak 16 digit.");

      const lahir = tanggalSah(id.tanggal_lahir), dariNik = lahirDariNik(nik);
      const pakai = lahir || dariNik;
      if (lahir && dariNik && lahir !== dariNik) info("identitas", `Tanggal lahir ${lahir} tidak sama dengan yang tersirat di NIK (${dariNik}).`);
      if (!pakai) cek("identitas", "Tanggal lahir tidak terbaca, umur tidak bisa dicek.");
      else {
        umur = umurPada(pakai);
        data.lahir = pakai; data.umur = umur;
        if (umur < UMUR_MIN || umur > UMUR_MAKS) cek("identitas", `Umur ${umur} tahun per 15 Jan 2027 (syarat 15–30).`);
      }

      // Domisili: pemain satu tim harus satu provinsi dengan tim (user 16 Nov); kabupaten/desa boleh berbeda.
      const dom = domisili(id);
      data.alamat = [id.desa_kelurahan, id.kecamatan, id.kabupaten_kota, id.provinsi].filter(Boolean).join(", ");
      if (dom.prov) data.prov = PROVINSI[dom.prov];
      if (!dom.prov) {
        cek("identitas", id.alamat_dari === "tidak_ada" || (!id.kabupaten_kota && !id.provinsi)
          ? `${dok} tanpa alamat yang terbaca: provinsi domisili perlu dicek manual.`
          : `Provinsi domisili tidak bisa dipastikan dari alamat "${data.alamat}".`);
      } else if (dom.prov !== tim.prov_kode) {
        cek("identitas", `Domisili di ${PROVINSI[dom.prov]}, sedangkan tim mewakili ${tim.provinsi}. Pemain satu tim harus satu provinsi.`);
      } else {
        if (dom.kab && tim.kab_kode && dom.kab !== tim.kab_kode) info("identitas", `Domisili di ${namaKab(dom.kab)}, tim di ${tim.kabupaten} (masih satu provinsi).`);
        if (id.alamat_dari === "sekolah") info("identitas", "Domisili dibaca dari alamat sekolah di kartu pelajar.");
        if (dom.pemekaran) info("identitas", `Dokumen menulis provinsi "${id.provinsi}"; ${id.kabupaten_kota} kini masuk ${PROVINSI[dom.prov]}.`);
      }
      if (!butir.some((x) => x.b === "identitas" && x.s === "cek")) ok("identitas", `${dok} sesuai${umur !== null ? `, umur ${umur}` : ""}${dom.prov ? `, ${PROVINSI[dom.prov]}` : ""}.`);
    }

    // 2. Izin orang tua bila di bawah 17 tahun
    if (umur !== null && umur < UMUR_IZIN) {
      const iz = b.izin;
      if (!p.izin_path) cek("izin", `Umur ${umur} tahun: surat izin orang tua/wali wajib, tetapi tidak diunggah.`);
      else if (!iz || iz.galat) cek("izin", iz?.galat || "Surat izin tidak terbaca.");
      else if (!iz.surat_izin) cek("izin", "Berkas izin bukan surat izin orang tua/wali.");
      else {
        if (!iz.ada_tanda_tangan) cek("izin", "Surat izin tanpa tanda tangan orang tua/wali.");
        if (iz.nama_anak && !namaCocok(p.nama, iz.nama_anak)) cek("izin", `Surat izin atas nama "${iz.nama_anak}", bukan "${p.nama}".`);
        if (!butir.some((x) => x.b === "izin" && x.s === "cek")) ok("izin", "Surat izin orang tua ada dan bertanda tangan.");
      }
    }

    // 3. Profil Mobile Legends
    const ml = b.profil_ml;
    if (!ml) cek("profil_ml", "Tangkapan layar profil ML tidak ada.");
    else if (ml.galat) cek("profil_ml", ml.galat);
    else if (!ml.profil_mlbb) cek("profil_ml", "Bukan tangkapan layar profil akun Mobile Legends.");
    else {
      const idAkun = nikBersih(ml.id_akun), server = nikBersih(ml.server);
      data.ml_nick = ml.nickname || "";
      if (idAkun.length < 5) cek("profil_ml", "ID akun Mobile Legends tidak terlihat.");
      else { data.ml = server ? `${idAkun} (${server})` : idAkun; data._ml = server ? `${idAkun}(${server})` : idAkun; ok("profil_ml", `Akun ML ${data.ml}.`); }
    }

    // 4. Bukti follow dua akun Instagram
    for (const [kolom, akun] of Object.entries(AKUN_IG)) {
      const kode = kolom.replace(/_path$/, ""), f = b[kolom];
      if (!p[kolom]) { cek(kode, `Bukti follow @${akun} tidak diunggah.`); continue; }
      if (!f || f.galat) { cek(kode, f?.galat || `Bukti follow @${akun} tidak terbaca.`); continue; }
      if (!f.instagram) cek(kode, `Bukti follow @${akun} bukan tangkapan layar Instagram.`);
      else if (!f.akun_terlihat) cek(kode, `Akun @${akun} tidak terlihat di bukti follow${f.username_profil ? ` (yang terlihat @${f.username_profil})` : ""}.`);
      else if (f.status !== "mengikuti") cek(kode, f.status === "belum_mengikuti" ? `Bukti follow menunjukkan @${akun} BELUM diikuti (tombol "Ikuti").` : `Status follow @${akun} tidak bisa dipastikan dari tangkapan layar.`);
      else ok(kode, `Mengikuti @${akun}.`);
    }

    // 5. Satu berkas dipakai dua kali oleh pemain yang sama
    const s = sha[p.urutan] || {}, dobel = new Map();
    for (const [k, h] of Object.entries(s)) if (h) dobel.set(h, [...(dobel.get(h) || []), k]);
    for (const kol of dobel.values()) if (kol.length > 1) cek(kol[0].replace(/_path$/, ""), `Berkas yang sama persis diunggah untuk ${kol.map(labelKolom).join(" dan ")}.`);

    pemain.push({ u: p.urutan, nama: p.nama, butir, data: Object.fromEntries(Object.entries(data).filter(([k]) => !k.startsWith("_"))) });
    // Ganda lintas pemain/tim hanya dari tangkapan layar milik pribadi (profil ML, bukti follow). Foto identitas &
    // surat izin boleh sama: KK dipakai kakak-adik, atau satu foto berisi kartu pelajar seluruh tim.
    identitas.push({ u: p.urutan, nik: data._nik || "", ml: data._ml || "", sha: [...new Set(SHA_LINTAS.map((k) => s[k]).filter(Boolean))] });
  }

  // Tim: nama bebas, hanya dicek kepantasannya (SARA/pornografi/politik praktis).
  if (namaTim && namaTim.pantas === false) timButir.push({ b: "nama_tim", s: "cek", t: `Nama tim mungkin mengandung SARA/pornografi/politik praktis: ${namaTim.alasan || "-"}` });

  const catatan = [...timButir.filter((x) => x.s === "cek").map((x) => x.t),
    ...pemain.flatMap((p) => p.butir.filter((x) => x.s === "cek").map((x) => `P${p.u} ${p.nama}: ${x.t}`))];
  const hasil = catatan.length ? "cek" : "lolos";
  const jmlBerkas = pemain.reduce((n, p) => n + p.butir.filter((x) => x.s === "ok").length, 0);
  const ringkas = hasil === "lolos" ? `Semua sesuai (${jmlBerkas} pemeriksaan).` : `${catatan.length} catatan: ${catatan.join(" · ")}`;
  return { hasil, ringkas: ringkas.slice(0, 500), rincian: { tim: timButir, pemain }, identitas };
}

const SHA_LINTAS = ["profil_ml_path", "follow_esports_path", "follow_ppdt_path"];

export const labelKolom = (k) => ({ dokumen_path: "identitas", profil_ml_path: "profil ML", follow_esports_path: "follow @esportsdesa.official",
  follow_ppdt_path: "follow @ditjen_ppdt", izin_path: "surat izin" }[k] || k);
