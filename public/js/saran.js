/* Catatan agen AI (agen-ai/nilai.mjs, ditulis untuk admin) → saran yang bisa langsung dikerjakan kapten.
   Dipakai di dua tempat:
   - admin.js: pesan WhatsApp "WA Kapten" (satu klik admin, pesan siap kirim);
   - perbaiki.js: halaman perbaikan berkas yang dibuka kapten dari tautan di pesan itu.
   Tiap saran membawa `kolom` (nama, dok, ml, ig1, ig2, izin) supaya halaman perbaikan menyorot isian yang perlu diganti.
   Catatan yang hanya bisa ditangani panitia (berkas di penyimpanan lama, gambar yang tak bisa dibaca model) tidak
   diteruskan ke kapten. */
(function () {
  const AKUN = { follow_esports: 'esportsdesa.official', follow_ppdt: 'ditjen_ppdt' };
  const KOLOM = { identitas: 'dok', dokumen: 'dok', profil_ml: 'ml', follow_esports: 'ig1', follow_ppdt: 'ig2', izin: 'izin' };
  const HANYA_PANITIA = /penyimpanan lama|Gambar terlalu besar|tidak bisa dibuka model|Alamat berkas tidak sah|di luar folder TEDNas/;
  const CARA_FOLLOW = (a) => `Buka profil @${a} di Instagram, follow, lalu screenshot sampai nama akun @${a} dan tombol "Mengikuti" terlihat.`;
  const JENIS_GANDA = { nik: 'NIK', ml: 'ID Mobile Legends' };

  /** Satu catatan AI {b, t} → {kolom, teks} untuk kapten, atau null bila hanya untuk panitia. */
  function satu(b, t) {
    t = String(t || '');
    if (HANYA_PANITIA.test(t)) return null;
    const k = KOLOM[b] || null;
    let m;
    if ((m = /^Berkas yang sama persis diunggah untuk (.+)\.$/.exec(t))) {
      return { kolom: k, teks: `Berkas yang sama diunggah untuk ${m[1]}. Unggah berkas yang sesuai untuk masing-masing.` };
    }
    if (b === 'identitas') {
      if ((m = /^Nama di dokumen "(.+)" tidak sama dengan nama terdaftar "(.+)"\.$/.exec(t))) {
        return { kolom: 'nama', teks: `Nama terdaftar "${m[2]}" berbeda dengan nama di kartu identitas ("${m[1]}"). Tulis nama lengkap sesuai kartu identitas.` };
      }
      if ((m = /^Nama "(.+)" tidak ditemukan di KK\.$/.exec(t))) {
        return { kolom: 'nama', teks: `Nama "${m[1]}" tidak ditemukan di KK. Tulis nama sesuai KK, atau unggah identitas yang memuat nama pemain ini.` };
      }
      if (/^Nama di dokumen tidak terbaca/.test(t)) return { kolom: 'dok', teks: 'Nama di kartu identitas tidak terbaca. Foto ulang dengan jelas.' };
      if ((m = /^Domisili di (.+), sedangkan tim mewakili (.+)\. Pemain satu tim/.exec(t))) {
        return { kolom: 'dok', teks: `Domisili pemain ini di ${m[1]}, padahal tim mewakili ${m[2]}. Semua pemain harus satu provinsi dengan desa yang diwakili: ganti dengan pemain lain, atau unggah identitas yang menunjukkan domisili di ${m[2]}.` };
      }
      if (/tanpa alamat yang terbaca/.test(t)) {
        return { kolom: 'dok', teks: 'Kartu identitasnya tidak memuat alamat, jadi provinsi domisilinya tidak bisa dipastikan. Unggah KTP, KK, atau surat keterangan domisili.' };
      }
      if (/^Provinsi domisili tidak bisa dipastikan/.test(t)) {
        return { kolom: 'dok', teks: 'Alamat di kartu identitas kurang jelas. Unggah foto yang alamatnya terbaca, atau KK/surat keterangan domisili.' };
      }
      if (/^Tanggal lahir tidak terbaca/.test(t)) {
        return { kolom: 'dok', teks: 'Tanggal lahir di kartu identitas tidak terbaca. Foto ulang dengan jelas, atau unggah identitas yang memuat tanggal lahir (KTP, KK, atau KIA).' };
      }
      if ((m = /^Umur (\d+) tahun per/.exec(t))) {
        return { kolom: 'dok', teks: `Umur pemain ini ${m[1]} tahun per 15 Januari 2027, padahal syaratnya 15–30 tahun. Ganti dengan pemain lain, atau unggah identitas yang benar bila tanggal lahirnya salah terbaca.` };
      }
      if (/buram atau terpotong/.test(t)) return { kolom: 'dok', teks: 'Foto kartu identitas buram atau terpotong. Foto ulang di tempat terang, utuh, dan tidak miring.' };
      if (/bukan dokumen identitas/.test(t)) {
        return { kolom: 'dok', teks: 'Berkas yang diunggah bukan kartu identitas. Unggah KTP, KK, KIA, kartu pelajar, atau surat keterangan domisili.' };
      }
      if (/tidak ada\.$|tidak ditemukan di Drive/.test(t)) return { kolom: 'dok', teks: 'Kartu identitas tidak ditemukan. Unggah ulang.' };
    }
    if (b === 'izin') {
      if (/wajib, tetapi tidak diunggah/.test(t)) return { kolom: 'izin', teks: 'Pemain di bawah 17 tahun wajib menyertakan surat izin orang tua/wali yang sudah ditandatangani.' };
      if (/tanpa tanda tangan/.test(t)) return { kolom: 'izin', teks: 'Surat izin belum ditandatangani orang tua/wali.' };
      if ((m = /^Surat izin atas nama "(.+)", bukan/.exec(t))) return { kolom: 'izin', teks: `Surat izin atas nama "${m[1]}", bukan pemain ini. Unggah surat izin atas nama pemain ini.` };
      if (/bukan surat izin/.test(t)) return { kolom: 'izin', teks: 'Berkas yang diunggah bukan surat izin orang tua/wali. Format suratnya bisa diunduh di halaman perbaikan.' };
      return { kolom: 'izin', teks: 'Surat izin tidak terbaca. Foto ulang dengan jelas.' };
    }
    if (b === 'profil_ml') {
      if (/ID akun/.test(t)) return { kolom: 'ml', teks: 'Screenshot profil Mobile Legends belum menampilkan ID akun. Buka profil di game, lalu screenshot sampai ID dan server terlihat.' };
      if (/^Bukan tangkapan layar profil/.test(t)) return { kolom: 'ml', teks: 'Berkas profil ML bukan screenshot profil Mobile Legends. Screenshot halaman profil akun di game, sampai ID dan server terlihat.' };
      return { kolom: 'ml', teks: 'Screenshot profil Mobile Legends tidak ada. Unggah ulang.' };
    }
    if (AKUN[b]) {
      const a = AKUN[b];
      if (/tidak diunggah/.test(t)) return { kolom: k, teks: `Bukti follow @${a} belum diunggah. ${CARA_FOLLOW(a)}` };
      if (/BELUM diikuti/.test(t)) return { kolom: k, teks: `@${a} belum di-follow (tombolnya masih "Ikuti"). Follow dulu, lalu screenshot ulang.` };
      if (/bukan tangkapan layar Instagram/.test(t)) return { kolom: k, teks: `Bukti follow @${a} bukan screenshot Instagram. ${CARA_FOLLOW(a)}` };
      if (/tidak terlihat/.test(t)) return { kolom: k, teks: `Screenshot follow belum menampilkan akun @${a}. ${CARA_FOLLOW(a)}` };
      return { kolom: k, teks: `Status follow @${a} belum jelas. ${CARA_FOLLOW(a)}` };
    }
    if (b === 'nama_tim') return { kolom: null, teks: 'Nama tim dinilai mungkin mengandung unsur SARA, pornografi, atau politik praktis. Balas pesan ini dengan usulan nama tim yang baru.' };
    return { kolom: k, teks: t };
  }

  /** Pemain ganda {u, jenis, u_lain} (u_lain hanya bila pasangannya di tim yang sama) → saran. */
  function ganda(g) {
    if (g.jenis === 'berkas') {
      return { kolom: 'ml', teks: g.u_lain ? `Screenshot pemain ini sama persis dengan milik Pemain ${g.u_lain}. Unggah screenshot akun pemain ini sendiri.`
        : 'Screenshot pemain ini sama persis dengan yang dipakai tim lain. Unggah screenshot akun pemain ini sendiri.' };
    }
    const j = JENIS_GANDA[g.jenis] || g.jenis;
    return { kolom: 'dok', teks: g.u_lain ? `${j} pemain ini sama dengan Pemain ${g.u_lain} di tim ini. Setiap pemain harus orang yang berbeda.`
      : `${j} pemain ini sudah terdaftar di tim lain yang mendaftar lebih dulu. 1 orang hanya boleh di 1 tim: ganti dengan pemain lain.` };
  }

  /** ai = {tim: [{b,t,s?}], pemain: [{u, butir: [{b,t,s?}]}], ganda: [{u, jenis, u_lain}]} (bentuk tednas_perbaiki_lihat)
   *  pemain = [{urutan, nama}] → {tim: [saran], pemain: [{urutan, nama, saran: [..]}] hanya yang punya saran}. */
  function daftar(ai, pemain) {
    const per = new Map((pemain || []).map((p) => [p.urutan, []]));
    const tambah = (u, x) => { const l = per.get(u); if (x && l && !l.some((y) => y.teks === x.teks)) l.push(x); };
    const cek = (b) => !b.s || b.s === 'cek';
    for (const p of (ai && ai.pemain) || []) for (const b of p.butir || []) if (cek(b)) tambah(p.u, satu(b.b, b.t));
    for (const g of (ai && ai.ganda) || []) tambah(g.u, ganda(g));
    const tim = ((ai && ai.tim) || []).filter(cek).map((b) => satu(b.b, b.t)).filter(Boolean);
    return { tim, pemain: (pemain || []).map((p) => ({ urutan: p.urutan, nama: p.nama, saran: per.get(p.urutan) || [] })).filter((p) => p.saran.length) };
  }

  const labelPemain = (u) => `Pemain ${u}${u === 1 ? ' (kapten)' : u === 6 ? ' (cadangan)' : ''}`;

  /** Pesan WhatsApp untuk kapten. tim = baris tednas_tim (+pemain), ai = bentuk daftar() di atas. */
  function pesanWa({ tim, ai, tautan, grup }) {
    const baris = [`Halo Kak ${tim.nama_kapten}, kapten tim *${tim.nama_tim}* (${tim.kode}), Desa ${tim.desa}.`, ''];
    // Tim terverifikasi (user 17 Nov): isinya ajakan masuk grup peserta.
    if (tim.status === 'terverifikasi') {
      baris.push('Tim kakak sudah *TERVERIFIKASI* di Turnamen Esports Desa Nasional 2027.');
      if (grup) baris.push('', 'Ajak semua pemain masuk grup WhatsApp peserta. Jadwal dan pengumuman turnamen dikirim di sana:', grup);
      baris.push('', 'Panitia TEDNas 2027');
      return baris.join('\n');
    } else {
      const d = daftar(ai, tim.pemain);
      baris.push('Terima kasih sudah mendaftar Turnamen Esports Desa Nasional 2027.');
      if (d.tim.length || d.pemain.length) {
        baris.push('Dari pemeriksaan berkas, ada yang perlu diperbaiki:');
        for (const x of d.tim) baris.push('', `• ${x.teks}`);
        for (const p of d.pemain) {
          baris.push('', `*${labelPemain(p.urutan)}: ${p.nama}*`);
          for (const s of p.saran) baris.push(`• ${s.teks}`);
        }
        baris.push('', 'Perbaiki langsung lewat tautan ini (khusus tim kakak, jangan disebar):', tautan, '',
          'Setelah disimpan, berkas dicek ulang otomatis. Kalau semuanya sesuai, tim langsung terverifikasi.');
      } else {
        baris.push('Berkas tim kakak sedang diperiksa panitia. Kalau ada berkas yang ingin diganti, pakai tautan ini (khusus tim kakak, jangan disebar):', tautan);
      }
    }
    if (grup) baris.push('', `Gabung grup WhatsApp peserta untuk info jadwal: ${grup}`);
    baris.push('', 'Panitia TEDNas 2027');
    return baris.join('\n');
  }

  window.SARAN = { satu, ganda, daftar, pesanWa, labelPemain };
})();
