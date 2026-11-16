/**
 * Penilaian berkas pendaftar TEDNas: pertanyaan untuk model penglihatan dan aturan peraturan turnamen.
 * Murni (tanpa jaringan/berkas), supaya bisa diuji tuntas: uji/uji-ai.mjs.
 *
 * AI hanya MEMBACA isi gambar. Keputusan "sesuai/tidak" diambil kode di bawah dari hasil bacaan itu, jadi
 * aturannya bisa diperiksa orang. Hasil akhir tetap rekomendasi: yang menekan Verifikasi adalah admin.
 */

export const VERSI_AGEN = 1;
export const TANGGAL_ACUAN = "2027-01-15"; // Peraturan A: "Berusia 15–30 tahun per 15 Januari 2027"
export const UMUR_MIN = 15, UMUR_MAKS = 30, UMUR_IZIN = 17;
export const AKUN_IG = { follow_esports_path: "esportsdesa.official", follow_ppdt_path: "ditjen_ppdt" };

/* ── Pertanyaan untuk model (format = JSON Schema; Ollama memaksa keluaran mengikuti skema) ── */

const obj = (props) => ({ type: "object", properties: props, required: Object.keys(props) });
const S = { type: "string" }, B = { type: "boolean" };

export function tanyaIdentitas(jenis, nama) {
  return {
    prompt: `Ini foto dokumen identitas seorang pendaftar turnamen esports desa. Pendaftar menyebutnya "${jenis}" atas nama "${nama}".
Baca isinya PERSIS seperti tertulis, jangan menebak. Kosongkan isian yang tidak tertulis atau tidak terbaca.
- jenis_dokumen: KTP, KK (Kartu Keluarga), Suket (surat keterangan domisili dari RT/RW/desa/kelurahan), Kartu Pelajar, lain, atau tidak_terbaca.
- terbaca: false bila foto buram, terpotong sampai data utama hilang, atau bukan dokumen identitas.
- nama: nama orang pada dokumen. Untuk KK: nama anggota keluarga yang paling mirip dengan "${nama}" (kosong bila tidak ada yang mirip).
- nik: 16 digit NIK orang itu, tanpa spasi.
- tanggal_lahir: tanggal lahir orang itu, format YYYY-MM-DD.
- desa_kelurahan, kecamatan, kabupaten_kota, provinsi: alamat pada dokumen. Tulis kabupaten_kota lengkap dengan kata KABUPATEN atau KOTA bila tertulis.
- sekolah: nama sekolah (untuk kartu pelajar).`,
    format: obj({
      jenis_dokumen: { type: "string", enum: ["KTP", "KK", "Suket", "Kartu Pelajar", "lain", "tidak_terbaca"] },
      terbaca: B, nama: S, nik: S, tanggal_lahir: S, desa_kelurahan: S, kecamatan: S, kabupaten_kota: S, provinsi: S, sekolah: S,
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
    prompt: `Nama tim turnamen esports desa: "${namaTim}".
Aturan: nama tim harus bebas dari unsur SARA, pornografi, dan politik praktis.
- pantas: false HANYA bila nama itu jelas mengandung SARA, kata kasar/pornografi, atau politik praktis (nama partai, calon, slogan kampanye). Nama desa, kata "esports", "squad", "team", nama hewan, dan sejenisnya pantas.
- alasan: satu kalimat singkat, kosong bila pantas.`,
    format: obj({ pantas: B, alasan: S }),
  };
}

/* ── Pembanding teks ──────────────────────────────────────────────────── */

export const huruf = (s) => String(s ?? "").toUpperCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

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
const kataNama = (s) => huruf(s).split(" ").filter(Boolean).map((k) => SINGKATAN[k] || k);
const kataCocok = (a, b) => a === b || mirip(a, b) || (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a)));

/** Nama yang didaftarkan vs nama di dokumen. Cocok bila semua kata dari nama yang lebih pendek ada di yang lain
 *  (salah ketik kecil, singkatan Muhammad/M., dan nama panggilan yang merupakan bagian nama lengkap diterima). */
export function namaCocok(didaftar, diDokumen) {
  const a = kataNama(didaftar), b = kataNama(diDokumen);
  if (!a.length || !b.length) return false;
  const [pendek, panjang] = a.length <= b.length ? [a, b] : [b, a];
  const sisa = [...panjang];
  for (const k of pendek) {
    const i = sisa.findIndex((x) => kataCocok(k, x));
    if (i < 0) return false;
    sisa.splice(i, 1);
  }
  // Satu kata pendek saja (mis. "Adi") baru cocok bila sama persis dengan salah satu kata nama dokumen.
  if (pendek.length === 1 && pendek[0].length < 4) return panjang.includes(pendek[0]);
  return true;
}

const AWALAN_WILAYAH = /^(KABUPATEN|KAB|KOTA ADMINISTRASI|KOTA ADM|KOTA|KECAMATAN|KEC|DESA|DS|KELURAHAN|KEL|KAMPUNG|KAMPONG|GAMPONG|NAGARI|PEKON|LEMBANG|KALURAHAN)\b\s*/;
const intiWilayah = (s) => { let x = huruf(s); for (let i = 0; i < 2; i++) x = x.replace(AWALAN_WILAYAH, ""); return x.replace(/\s/g, ""); };
const jenisKab = (s) => { const x = huruf(s); return /^KOTA\b/.test(x) ? "KOTA" : /^KAB(UPATEN)?\b/.test(x) ? "KAB" : ""; };

/** null = tidak tertulis di dokumen; true/false = sama/beda. "Kota X" ≠ "Kabupaten X". */
export function wilayahSama(diDokumen, milikTim, tingkat) {
  const a = intiWilayah(diDokumen), b = intiWilayah(milikTim);
  if (!a) return null;
  if (tingkat === "kab") { const ja = jenisKab(diDokumen), jb = jenisKab(milikTim); if (ja && jb && ja !== jb) return false; }
  return a === b || mirip(a, b) || (a.length >= 5 && b.length >= 5 && (a.includes(b) || b.includes(a)));
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
 * @param tim     paket tim (tednas_ai_antre): nama_tim, desa, kecamatan, kabupaten, pemain[]
 * @param baca    { [urutan]: { identitas, profil_ml, follow_esports_path, follow_ppdt_path, izin } } hasil bacaan AI;
 *                tiap entri bisa { galat: "…" } (berkas tak ada / tak terbaca) atau undefined (tak diunggah)
 * @param namaTim hasil tanyaNamaTim (boleh null)
 * @param sha     { [urutan]: { kolom: sha } } untuk berkas sama dipakai dua kali oleh satu pemain
 * → { hasil: "lolos"|"cek", ringkas, rincian, identitas }
 * Butir: s = "cek" (perlu dilihat admin) | "info" (dicatat saja) | "ok".
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
    else if (!id.terbaca || id.jenis_dokumen === "tidak_terbaca" || id.jenis_dokumen === "lain") {
      cek("identitas", id.jenis_dokumen === "lain" ? "Berkas identitas bukan KTP/KK/surat keterangan/kartu pelajar." : "Foto identitas tidak terbaca (buram atau terpotong).");
    } else {
      data.dok = id.jenis_dokumen;
      const sebut = { KTP: "KTP", KK: "KK", "Suket RT/RW": "Suket", "Kartu Pelajar": "Kartu Pelajar" }[p.dokumen_jenis];
      if (sebut && sebut !== id.jenis_dokumen) info("identitas", `Diunggah ${id.jenis_dokumen}, didaftarkan sebagai ${p.dokumen_jenis}.`);
      data.nama = id.nama || "";
      if (!id.nama) cek("identitas", id.jenis_dokumen === "KK" ? `Nama "${p.nama}" tidak ditemukan di KK.` : "Nama di dokumen tidak terbaca.");
      else if (!namaCocok(p.nama, id.nama)) cek("identitas", `Nama di dokumen "${id.nama}" tidak sama dengan nama terdaftar "${p.nama}".`);

      const nik = nikBersih(id.nik);
      if (nik.length === 16) { data.nik = samarkanNik(nik); data._nik = nik; }
      else if (nik && id.jenis_dokumen !== "Kartu Pelajar") info("identitas", "NIK terbaca tidak 16 digit.");

      const lahir = tanggalSah(id.tanggal_lahir), dariNik = lahirDariNik(nik);
      const pakai = lahir || dariNik;
      if (lahir && dariNik && lahir !== dariNik) info("identitas", `Tanggal lahir ${lahir} tidak sama dengan yang tersirat di NIK (${dariNik}).`);
      if (!pakai) cek("identitas", "Tanggal lahir tidak terbaca, umur tidak bisa dicek.");
      else {
        umur = umurPada(pakai);
        data.lahir = pakai; data.umur = umur;
        if (umur < UMUR_MIN || umur > UMUR_MAKS) cek("identitas", `Umur ${umur} tahun per 15 Jan 2027 (syarat 15–30).`);
      }

      // Domisili (Peraturan A & B: berdomisili di desa; tim boleh gabungan beberapa desa)
      const kab = wilayahSama(id.kabupaten_kota, tim.kabupaten, "kab"), kec = wilayahSama(id.kecamatan, tim.kecamatan), desa = wilayahSama(id.desa_kelurahan, tim.desa);
      data.alamat = [id.desa_kelurahan, id.kecamatan, id.kabupaten_kota].filter(Boolean).join(", ");
      if (kab === false) cek("identitas", `Domisili di ${id.kabupaten_kota}, bukan ${tim.kabupaten}.`);
      else if (kab === null && desa === null) info("identitas", id.jenis_dokumen === "Kartu Pelajar" ? "Kartu pelajar tanpa alamat rumah: domisili tidak bisa dicek AI." : "Alamat tidak terbaca: domisili tidak bisa dicek AI.");
      else if (desa === false) info("identitas", `Pemain dari desa ${id.desa_kelurahan}${kec === false ? `, Kec. ${id.kecamatan}` : ""} (tim gabungan desa diperbolehkan).`);
      if (!butir.some((x) => x.b === "identitas" && x.s === "cek")) ok("identitas", `${id.jenis_dokumen} sesuai${umur !== null ? `, umur ${umur}` : ""}.`);
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
    identitas.push({ u: p.urutan, nik: data._nik || "", ml: data._ml || "", sha: [...new Set(Object.values(s).filter(Boolean))] });
  }

  // Tim
  if (namaTim && namaTim.pantas === false) timButir.push({ b: "nama_tim", s: "cek", t: `Nama tim mungkin melanggar aturan SARA/pornografi/politik: ${namaTim.alasan || "-"}` });

  const catatan = [...timButir.filter((x) => x.s === "cek").map((x) => x.t),
    ...pemain.flatMap((p) => p.butir.filter((x) => x.s === "cek").map((x) => `P${p.u} ${p.nama}: ${x.t}`))];
  const hasil = catatan.length ? "cek" : "lolos";
  const jmlBerkas = pemain.reduce((n, p) => n + p.butir.filter((x) => x.s === "ok").length, 0);
  const ringkas = hasil === "lolos" ? `Semua sesuai (${jmlBerkas} pemeriksaan).` : `${catatan.length} catatan: ${catatan.join(" · ")}`;
  return { hasil, ringkas: ringkas.slice(0, 500), rincian: { tim: timButir, pemain }, identitas };
}

export const labelKolom = (k) => ({ dokumen_path: "identitas", profil_ml_path: "profil ML", follow_esports_path: "follow @esportsdesa.official",
  follow_ppdt_path: "follow @ditjen_ppdt", izin_path: "surat izin" }[k] || k);
