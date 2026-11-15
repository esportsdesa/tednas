# Pindah pemilik Drive: yanuarardaraja@gmail.com → esportsdesa@gmail.com

Pada 15 Nov 2026 Kemendes meminta data pendaftar disimpan di Drive **esportsdesa@gmail.com**. Semua data
dan berkas dipindah ke Drive milik akun itu. Membagikan folder saja tidak cukup, karena pemiliknya tetap
akun lama. Drive akun lama tetap utuh sebagai cadangan sampai dihapus manual.

## Urutan

1. **Laptop:** `node .siap/pindah-akun.mjs siapkan` membuat kunci baru (`.siap/rahasia-baru.txt`) dan
   `.siap/Code-esportsdesa.gs`, yaitu `Code.gs` yang sudah berisi kunci itu.
2. **Google, login esportsdesa@gmail.com:** pasang `.siap/Code-esportsdesa.gs` dengan langkah 2–5 di
   [PASANG.md](PASANG.md): script.new → tempel → Deploy Web app (Me / Anyone) → jalankan `pasang`.
   - Pada tahap ini log berbunyi *"Supabase belum menerima kunci skrip ini … WAJAR bila sedang pindah akun"*.
   - Salin **Web app URL**.
3. **Google, login yanuarardaraja@gmail.com:** bagikan folder lama "TEDNas 2027 — Data Pendaftar" ke
   esportsdesa@gmail.com sebagai **Pelihat**, supaya skrip baru bisa menyalin berkasnya.
   - Akses umum: **Dibatasi**. Folder ini berisi KTP/KK.
4. **Laptop:** `node .siap/pindah-akun.mjs alih <Web app URL>`.
   - Memeriksa Web App baru: versi, kunci, dan apakah folder lama terbaca.
   - Menjalankan `supabase/migration-9-pindah-akun-drive.sql`.
   - Memasang kunci dan alamat baru di Supabase dalam satu transaksi.
   - Kunci lama tetap sah **hanya untuk tanda berkas**, supaya pendaftar yang halamannya masih memuat
     alamat lama tetap bisa mengirim.
   - Semua pintu Apps Script menolak kunci lama, jadi pemicu skrip lama berhenti menyentuh antrean
     dengan sendirinya.
   - Lalu ganti `DRIVE_URL` di `public/js/config.js` dan push ke `main`.
5. **Laptop:** `node .siap/pindah-akun.mjs salin`.
   - Tiap berkas `gdrive/…` disalin ke "Berkas Masuk" Drive baru (aksi `salin`, berkunci).
   - Path pemain diganti dalam satu pernyataan per tim, sehingga hanya ada satu kabar per tim. Kabar
     itu menulis Sheet baru lalu memindah berkas ke folder timnya.
   - Aman diulang. Petanya disimpan di `.siap/pindah-akun-peta.json`.
6. **Laptop:** `node .siap/pindah-akun.mjs periksa`. Hasil yang benar: semua berkas dan folder tim berada
   di dalam folder TEDNas akun baru, semua tim ada di Sheet baru, dan antrean kosong.
7. **Beberapa jam kemudian**, ulangi `salin` lalu `periksa`. Ini menyusulkan pendaftar dari halaman lama
   yang terlanjur mengunggah ke Web App lama.
8. **Seminggu kemudian:**
   - Cabut kunci lama: `update public.tednas_rahasia set drive_rahasia_lama = null;`.
   - Di akun lama: jalankan `lepas` dan arsipkan deployment lama.
   - Drive lama boleh dihapus bila tidak dipakai sebagai cadangan.

Berkas lama di bucket Supabase (`dokumen/…`) tidak ikut `salin`. Untuk memindahnya, pakai
`.siap/pindah-lama.mjs`, yang butuh kunci layanan Supabase.
