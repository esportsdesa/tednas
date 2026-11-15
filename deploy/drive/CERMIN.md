# Cermin Drive: data juga tercatat di esportsdesa@gmail.com

Sejak 15 Nov 2026, data dan berkas pendaftar tercatat di **dua** akun Google. Kemendes memintanya
supaya data juga ada di Drive esportsdesa@gmail.com.

| | Utama — yanuarardaraja@gmail.com | Cermin — esportsdesa@gmail.com |
|---|---|---|
| Menerima unggahan HP pendaftar | ya | tidak |
| Dipakai halaman admin untuk membuka berkas | ya | tidak |
| Folder "TEDNas 2027 — Data Pendaftar" + Sheet + folder per tim | ya | ya, **milik akun ini sendiri** |
| Kunci di Supabase | `drive_rahasia` | `cermin_rahasia` (terpisah) |

## Cara kerja

1. Tiap kali tim mendaftar, diverifikasi, diubah, atau dihapus, database mengirim kabar ke Web App utama
   **dan** Web App cermin (`migration-9-cermin-drive.sql`, fungsi `tednas_drive_kirim`).
2. Web App cermin (`Code.gs` dengan `PERAN = "cermin"`) menyalin berkas tim itu dari Drive utama ke folder
   timnya sendiri.
   - Tiap salinan diberi deskripsi `asal:<id>`, jadi berkas yang sama tidak disalin dua kali.
   - Salinan berkas yang sudah diganti pemain dibuang.
3. Sheet cermin ditulis dengan tautan ke salinan milik akun cermin.
4. Bila kabar gagal, pemicu 10 menit di akun cermin menyusul lewat `cermin_tersalin < drive_versi`, paling
   banyak 5 tim per putaran.
5. Supaya bisa menyalin, folder utama harus dibagikan ke esportsdesa@gmail.com sebagai **Pelihat**.

## Pasang

1. **Laptop:**
   - `node .siap/cermin.mjs siapkan` membuat kunci cermin dan `.siap/Code-esportsdesa.gs`.
   - `node .siap/cermin.mjs kunci` menjalankan migrasi 9 dan memasang kunci cermin di Supabase.
2. **Login esportsdesa@gmail.com:**
   - script.new → tempel `.siap/Code-esportsdesa.gs` → simpan.
   - Jalankan `pasang`. Log harus berbunyi "Peran : cermin" dan "Supabase: kunci cocok".
   - Deploy → New deployment → Web app → Execute as **Me** → Who has access **Anyone**.
   - Salin Web app URL.
3. **Login yanuarardaraja@gmail.com:** bagikan folder "TEDNas 2027 — Data Pendaftar" ke
   esportsdesa@gmail.com sebagai **Pelihat**. Akses umum: **Dibatasi**.
4. **Laptop:**
   - `node .siap/cermin.mjs pasang <Web app URL>` memasang `cermin_url`, lalu mengirim semua tim lama
     ke cermin.
   - `node .siap/cermin.mjs periksa` harus melaporkan 0 tim belum tercermin.

## Perawatan

- **Memperbarui skrip cermin:** `node .siap/cermin.mjs siapkan`, tempel ulang, lalu
  Manage deployments → New version.
- **Menghentikan cermin:** `update public.tednas_rahasia set cermin_url = null;`. Situs dan Drive utama
  tidak terpengaruh.
- **Mengirim ulang semua tim ke cermin:** `update public.tednas_tim set cermin_tersalin = 0;` lalu
  `node .siap/cermin.mjs susul`.
- Berkas lama di bucket Supabase (`dokumen/…`) tidak ikut disalin, sama seperti di Drive utama. Sheet
  menuliskannya sebagai "Supabase: …".
