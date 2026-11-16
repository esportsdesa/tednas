# Agen AI pemeriksa berkas TEDNas

Agen ini memeriksa berkas setiap tim pendaftar secara otomatis, begitu tim mendaftar atau datanya berubah. Hasilnya
tampil di halaman admin, di kolom **Cek AI** dan di jendela pemain. Agen **tidak** mengubah status tim. Admin yang
menekan **Verifikasi**, per tim atau sekaligus untuk semua tim yang lolos AI.

## Yang diperiksa

Dasarnya halaman Peraturan (`public/js/common.js`, `U.PERATURAN`).

| Berkas | AI membaca | Aturan |
|---|---|---|
| Identitas (KTP/KK/Suket/Kartu Pelajar) | jenis, nama, NIK, tanggal lahir, alamat | nama sama dengan yang didaftarkan; umur 15–30 per 15 Jan 2027; domisili sekabupaten dengan tim (desa lain boleh, dicatat sebagai info) |
| Surat izin orang tua | surat izin? nama anak, tanda tangan | wajib bila umur < 17; dibaca hanya untuk pemain < 17 |
| Profil Mobile Legends | profil ML? nickname, ID, server | harus profil ML dengan ID terlihat |
| Bukti follow @esportsdesa.official dan @ditjen_ppdt | Instagram? akun terlihat? status follow | harus "Mengikuti"/"Following" untuk akun yang benar |
| Nama tim | pantas? (SARA/pornografi/politik) | ditandai bila AI menilai tidak pantas |
| Lintas tim | — | NIK, ID ML, atau berkas yang sama persis dipakai dua pemain → kedua tim "Perlu dicek" |

AI hanya **membaca** isi gambar. Keputusan sesuai atau tidak sesuai diambil kode di `nilai.mjs`, jadi aturannya
bisa dibaca dan diuji (`node uji/uji-ai.mjs`).

Hasil per tim:
- **Lolos AI**: semua pemeriksaan sesuai.
- **Perlu dicek · n**: ada n catatan yang perlu dilihat admin.
- **Diulang**: berkas belum bisa diambil atau model belum menjawab. Agen mencoba lagi setelah 30 menit.

## Cara kerja

```
Supabase ──tednas_ai_antre (kunci ai_rahasia)──► agen (server dapur, systemd --user tednas-ai)
                                                   │ berkas: Web App Drive utama, aksi "berkas" + kunci_ai
                                                   │ baca:   qwen3.5:9b langsung ke worker armada yang hangat
                                                   ▼         (daftar dari LB /lb/keadaan; TIDAK ke Ollama dapur)
Supabase ◄──tednas_ai_simpan─────────────────────── nilai.mjs
```

- **Antrean.** Tim masuk antrean bila belum pernah diperiksa, isi tim atau berkasnya berubah, `VERSI_AGEN` naik,
  atau admin menekan **Periksa Ulang AI**. Tim yang masih menunggu verifikasi didahulukan. Menekan Verifikasi
  tidak membuat tim diperiksa ulang.
- **Kunci.** Agen memakai kunci sendiri, `ai_rahasia` di Supabase dan `KUNCI_AI` di Code.gs utama. Dengan kunci
  itu agen hanya bisa membaca berkas TEDNas, membaca antrean, dan menulis hasil AI.
- **Data pribadi.**
  - NIK disimpan sebagai HMAC (untuk mencari yang ganda) dan versi tersamar `3507********0003`.
  - Log tidak memuat nama atau NIK.
  - Gambar dikirim ke worker armada lewat tailnet dan tidak disimpan di disk. PDF diubah ke gambar di folder
    sementara yang langsung dihapus.
- **Tanpa worker.** Bila tidak ada worker yang sehat dan hangat, agen menunggu. Ollama dapur tidak dipakai, karena
  RAM server tipis.

## Pasang dan rawat (dari laptop, folder repo)

Rahasia ada di `.siap/` (tidak ikut git).

```
node .siap/ai.mjs siapkan    # kunci AI + .siap/Code.gs (utama, berisi KUNCI & KUNCI_AI) + .siap/Code-esportsdesa.gs
node .siap/ai.mjs kunci      # migration-10-ai-periksa.sql + ai_rahasia di Supabase (produksi)
#   lalu: tempel .siap/Code.gs ke proyek Apps Script utama → Deploy → Manage deployments → New version
node .siap/ai.mjs cek        # Web App utama versi baru + kunci AI bisa membaca satu berkas
node .siap/ai.mjs pasang     # salin agen ke dapur ~/tednas-ai + nyalakan systemd --user tednas-ai
node .siap/ai.mjs status     # log agen + jumlah lolos/cek/diulang/antre
```

- **Uji satu gambar ke model sungguhan:** `node agen-ai/agen.mjs --coba foto.jpg identitas "Nama Pemain"`.
  Butuh terowongan `ssh -L 11435:127.0.0.1:11435 jot` dan laptop di tailnet.
- **Mengubah aturan atau prompt:** ubah `nilai.mjs`, naikkan `VERSI_AGEN` bila semua tim perlu diperiksa ulang,
  uji (`node uji/uji-ai.mjs`), lalu `node .siap/ai.mjs pasang`.
- **Mematikan agen:** `ssh jot systemctl --user disable --now tednas-ai`. Situs tidak terpengaruh. Kolom Cek AI
  tetap menampilkan hasil terakhir.
