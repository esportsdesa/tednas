# Agen AI pemeriksa berkas TEDNas

Agen ini memeriksa berkas setiap tim pendaftar secara otomatis, begitu tim mendaftar atau datanya berubah.

- **Lolos semua pemeriksaan:** status tim langsung **Terverifikasi**. Di halaman admin tertulis "Terverifikasi · AI".
- **Ada catatan:** tim tetap **Menunggu**. Admin melihat catatannya di kolom **Cek AI**. Tombol **WA Kapten**
  mengirim catatan itu ke kapten sebagai petunjuk perbaikan, beserta tautan untuk mengganti berkas sendiri
  (README utama, "Kabari kapten & perbaikan berkas"). Setelah kapten menyimpan, agen memeriksa ulang dengan sendirinya.
- AI tidak pernah menolak tim, dan tidak pernah menimpa status yang sudah diubah admin.

## Yang diperiksa

Dasarnya halaman Peraturan (`public/js/common.js`, `U.PERATURAN`) dan arahan panitia 16 Nov 2026.

| Berkas | AI membaca | Aturan |
|---|---|---|
| Identitas: KTP, KK, KIA, kartu pelajar, surat keterangan domisili, SIM, atau identitas lain yang memuat alamat | jenis, nama, NIK, tanggal lahir, alamat | nama sama dengan yang didaftarkan; umur 15–30 per 15 Jan 2027; domisili **satu provinsi** dengan tim. Kabupaten atau desa lain boleh, dicatat sebagai info. |
| Surat izin orang tua | surat izin? nama anak, tanda tangan | wajib bila umur < 17; dibaca hanya untuk pemain < 17 |
| Profil Mobile Legends | profil ML? nickname, ID, server | harus profil ML dengan ID terlihat |
| Bukti follow @esportsdesa.official dan @ditjen_ppdt | Instagram? akun terlihat? status follow | harus "Mengikuti"/"Following" untuk akun yang benar |
| Nama tim | pantas? (SARA/pornografi/politik) | nama bebas, hanya ditandai bila jelas tidak pantas |
| Lintas tim | — | 1 orang hanya boleh di 1 tim. NIK, ID ML, atau berkas yang sama persis dipakai dua pemain → tim yang **mendaftar belakangan** "Perlu dicek"; tim yang lebih dulu hanya mendapat catatan. Dua kali di tim yang sama → tim itu "Perlu dicek". |

- **Provinsi domisili** diambil dari kabupaten/kota di dokumen (`wilayah.mjs`, 514 kabupaten/kota). Dengan begitu
  KTP lama dari daerah pemekaran tetap terbaca benar, misalnya Merauke yang tertulis "PAPUA" padahal kini Papua
  Selatan. Bila kabupaten/kota tidak terbaca atau ambigu ("Banjar"), dipakai provinsi yang tertulis.
- **Kartu pelajar tanpa alamat** jadi catatan "perlu dicek", karena provinsinya tidak bisa dipastikan.
- AI hanya **membaca** isi gambar. Keputusan sesuai atau tidak sesuai diambil kode di `nilai.mjs`, jadi aturannya
  bisa dibaca dan diuji (`node uji/uji-ai.mjs`). Aturan status otomatis ada di `supabase/migration-10-ai-periksa.sql`
  (`tednas_ai_terapkan`), diuji `node uji/uji-sql.mjs`.

Hasil per tim:
- **Lolos AI**: semua pemeriksaan sesuai. Status langsung Terverifikasi kecuali admin pernah mengubah status tim itu.
- **Perlu dicek · n**: ada n catatan yang perlu dilihat admin. Tim yang tadinya diverifikasi AI kembali Menunggu.
- **Diulang**: berkas belum bisa diambil atau model belum menjawab. Status tidak berubah. Agen mencoba lagi setelah
  30 menit.

## Model: gabungan (bawaan sejak 16 Nov malam)

`TEDNAS_MESIN=gabungan`. Dua model dipakai berurutan.

1. **qwen3.5:9b di armada worker** membaca semua berkas, sekitar 1 menit per tim. Model ini selalu tersedia, dan
   permintaannya dikirim langsung ke worker yang hangat, tidak lewat LB.
2. Berkas yang **ditolak** 9b dibaca ulang **Qwen3.6-35B-A3B di pool GPU**, dan jawaban 35B yang dipakai. Yang
   dibaca ulang hanya catatan atas bacaan model. Berkas hilang, berkas yang tidak diunggah, atau berkas kembar tidak
   ikut dibaca ulang.
   - Uji A/B 16 Nov di 3 tim nyata: identitas sebanding, tetapi 9b gagal membaca ID Mobile Legends 8 dari 10,
     padahal 35B membaca semuanya.
3. Kalau pool belum siap (atau gagal di tengah), hasil 9b disimpan sebagai "Perlu dicek" dengan
   `rincian.tunggu = n`. Ringkasannya diawali "Menunggu cek ulang model besar …", dan di admin tertulis "n berkas
   dicek ulang". Agen lalu meminta pool ke broker. Begitu pool siap, tim itu diambil lagi dan dituntaskan, dan
   langsung Terverifikasi bila semuanya ternyata sesuai.
   - Penandanya `tednas_ai.versi`, tanpa perubahan database: `VERSI_AGEN×10+1` = tuntas, `VERSI_AGEN×10` = tunda.
   - Selagi pool belum siap, antrean diminta dengan versi tunda, jadi tim tunda tidak diambil berulang.

Mode lain: `pool` (hanya 35B, menunggu pool), `pool+armada`, `armada` (hanya 9b).

### Pool GPU

Qwen3.6-35B-A3B berjalan di pool GPU gabungan Gambir: beberapa PC billing yang menganggur, dikelola broker
`/home/jot/rpc-broker` di dapur. Cara kerjanya sama dengan Kawan Bicara:

- Selama ada antrean, agen menyalakan `want-heavy` dan memperbarui `last-request`. Broker lalu merakit pool begitu
  cukup PC menganggur, dan membongkarnya 15 menit setelah antrean habis.
- Alamat kepala dibaca dari `pool-head.txt` dan `pool-model.txt`.
- Pool baru dianggap siap bila `/props` menyatakan `modalities.vision`. Artinya llama-server dinyalakan dengan
  `--mmproj` (modul penglihatan `mmproj-Qwen_Qwen3.6-35B-A3B-f16.gguf` di kepala, ditambahkan ke
  `head-serve-dyn.ps1` pada 16 Nov). Encoder gambar berjalan di CPU kepala supaya tidak menambah VRAM PC billing.
- Laju: 35–50 detik per gambar (prompt eval ±19 token/detik lewat RPC). Gambar dikirim satu per satu
  (`TEDNAS_POOL_PARALEL=1`), karena dua gambar sekaligus sempat membuat rpc-server anggota crash.
- Kalau kepala pool mati, broker membongkar dan merakit ulang otomatis.

## Cara kerja

```
Supabase ──tednas_ai_antre (kunci ai_rahasia)──► agen (server dapur, systemd --user tednas-ai)
                                                   │ berkas: Web App Drive utama, aksi "berkas" + kunci_ai
                                                   │ baca:   Qwen3.6-35B di pool GPU (want-heavy → broker)
                                                   ▼
Supabase ◄──tednas_ai_simpan──────────────────────── nilai.mjs
   └─ tednas_ai_terapkan: lolos → Terverifikasi (status_oleh 'ai'); cek → tetap/kembali Menunggu
```

- **Antrean.** Tim masuk antrean bila:
  - belum pernah diperiksa;
  - isi tim atau berkasnya berubah;
  - `VERSI_AGEN` naik;
  - admin menekan **Periksa Ulang AI**.

  Tim yang masih menunggu verifikasi didahulukan. Perubahan status tidak membuat tim diperiksa ulang.
- **Keputusan admin.** Setiap perubahan status dicatat di `tednas_tim.status_oleh` (`ai` atau `admin`). Tim yang
  statusnya pernah diubah admin tidak disentuh agen lagi.
- **Kunci.** Agen memakai kunci sendiri, `ai_rahasia` di Supabase dan `KUNCI_AI` di Code.gs utama. Dengan kunci
  itu agen hanya bisa:
  - membaca berkas TEDNas;
  - membaca antrean;
  - menulis hasil AI, yang lalu menerapkan aturan status di atas.
- **Data pribadi.**
  - NIK disimpan sebagai HMAC (untuk mencari yang ganda) dan versi tersamar `3507********0003`.
  - Log tidak memuat nama atau NIK.
  - Gambar dikirim lewat tailnet ke PC Jaring sendiri (kepala pool) dan tidak disimpan di disk. PDF diubah ke gambar
    di folder sementara yang langsung dihapus.

## Pasang dan rawat (dari laptop, folder repo)

Rahasia ada di `.siap/` (tidak ikut git).

```
node .siap/ai.mjs siapkan    # kunci AI + .siap/Code.gs (utama, berisi KUNCI & KUNCI_AI) + .siap/Code-esportsdesa.gs
node .siap/ai.mjs kunci      # migration-10-ai-periksa.sql + ai_rahasia di Supabase (produksi)
#   lalu: tempel .siap/Code.gs ke proyek Apps Script utama → Deploy → Manage deployments → New version
node .siap/ai.mjs cek        # Web App utama versi baru + kunci AI bisa membaca satu berkas
node .siap/ai.mjs pasang     # salin agen ke dapur ~/tednas-ai + nyalakan systemd --user tednas-ai
node .siap/ai.mjs status     # log agen + jumlah lolos/cek/diulang/antre per status
```

- **Uji satu gambar ke model sungguhan:** jalankan di dapur, dengan pool menyala:
  `node agen.mjs --coba foto.jpg identitas "Nama Pemain"`.
- **Mengubah aturan atau prompt:** ubah `nilai.mjs`, naikkan `VERSI_AGEN` bila semua tim perlu diperiksa ulang,
  uji (`node uji/uji-ai.mjs`), lalu `node .siap/ai.mjs pasang`.
- **Mematikan agen:** `ssh jot systemctl --user disable --now tednas-ai`. Situs tidak terpengaruh, dan status yang
  sudah diubah tetap. Broker membongkar pool 15 menit kemudian.
