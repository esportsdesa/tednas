# Penyimpanan Google Drive

Data dan berkas pendaftar TEDNas disimpan di Google Drive **yanuarardaraja@gmail.com**:

```
My Drive
└── TEDNas 2027 — Data Pendaftar
    ├── Data Pendaftar TEDNas 2027        Sheet: tab "Tim" dan "Pemain" (dengan tautan tiap berkas)
    ├── Berkas Masuk / YYYY-MM-DD         unggahan yang baru masuk
    └── Tim / 35 JAWA TIMUR / TED-00001 — Nama Tim (Desa, Kabupaten)
                                          "1. Nama — KTP.jpg", "1. Nama — Profil ML.png", …
```

## Cara kerja

- **Berkas** (kartu identitas, profil ML, 2 bukti follow, izin orang tua) diunggah HP pendaftar
  **langsung** ke Web App Apps Script (`Code.gs`), tidak lewat bucket Supabase. Supabase gratis hanya
  1 GB penyimpanan + 5 GB egress — habis di sekitar 150 tim. Web App menjawab path
  `gdrive/<id>.<ext>~<tanda>`. `tednas_daftar()` memeriksa tanda HMAC-nya, lalu menyimpan path tanpa tanda.
- **Data tim** dikirim database ke Web App **seketika** saat tim mendaftar, diverifikasi, diubah, atau
  dihapus (pemicu + `pg_net`, setelah commit), lalu ditulis ke Sheet. Berkas tim baru dipindah ke folder
  timnya di eksekusi yang sama.
- Kalau kabar itu gagal (Web App sibuk, Google galat sesaat), pemicu `rapikan` (tiap 10 menit) menyusulkannya
  lewat kolom `drive_versi > drive_tersalin`. Unggahan yang tidak pernah dipakai pendaftaran dibuang setelah 7 hari.
- **Admin** membuka berkas Drive dari halaman `/admin` seperti biasa, termasuk unduhan ZIP. Web App
  memeriksa token sesi admin ke Supabase dan hanya mau menyajikan berkas di dalam folder TEDNas.
- Tabel tim tetap ada di Supabase karena halaman publik, rekap, bagan, dan admin membacanya dari sana
  (ukurannya hanya beberapa MB). Sheet adalah salinan seketika. Mengedit Sheet tidak mengubah situs.
- Tanpa `DRIVE_URL` di `public/js/config.js`, situs memakai bucket Supabase seperti dulu. Path lama
  `dokumen/...` tetap diterima dan tetap bisa dibuka admin.

## Pasang (sekali)

Rahasia bersama dibuat di laptop: `node deploy/drive/buat-siap.mjs`. Perintah ini menghasilkan
`.siap/supabase.sql` dan `.siap/Code.gs`. Folder `.siap/` tidak masuk git karena **repo ini publik**.

1. **Supabase** (akun pemilik proyek `dlznnpmzccndjqxxhnio`): SQL Editor → New query → tempel seluruh
   `.siap/supabase.sql` → Run. Hasil terakhir harus `rahasia_terpasang = true`. Langkah ini aman kapan
   saja, karena selama alamat Web App belum terdaftar database belum mengirim apa pun.
2. **Google** (login **yanuarardaraja@gmail.com**): buka <https://script.new>, beri nama
   "TEDNas — Penyimpanan Drive", hapus isi editor, tempel seluruh `.siap/Code.gs`, lalu simpan (Ctrl+S).
3. **Deploy → New deployment** → ikon gerigi → **Web app** → Execute as: **Me** → Who has access:
   **Anyone** → Deploy → Authorize access → pilih akun → "Google hasn't verified this app" → Advanced →
   Go to … (unsafe) → Allow. Ini skrip milik akun sendiri.
4. Di editor pilih fungsi **`pasang`** → Run. Execution log menampilkan Folder, Sheet, dan
   "Supabase: kunci cocok."
5. **Deploy → Manage deployments** → salin **Web app URL** (berakhiran `/exec`; Who has access harus
   **Anyone**). Daftarkan ke Supabase dengan kunci:
   `select public.tednas_drive_setel_url('<isi .siap/rahasia.txt>', '<Web app URL>');`
   Skrip TIDAK mendaftarkan alamatnya sendiri: `ScriptApp.getService().getUrl()` pernah memberi alamat
   `/exec` yang 404 bagi publik (12 Nov 2026).
6. Uji Web App asli (lihat di bawah), isi `DRIVE_URL` di `public/js/config.js` dengan alamat yang sama,
   lalu push ke `main`.

### Uji setelah deploy

- `curl -sL <alamat /exec>` → `{"ok":true,"nama":"TEDNas Drive",…}`.
- Unggah satu JPEG kecil lewat `aksi: "unggah"`, pastikan path bertanda dan tandanya cocok dengan
  `.siap/rahasia.txt`. Berkas uji ini otomatis dibuang 7 hari kemudian.
- Dari peramban (asal lain), `fetch(POST text/plain)` harus bisa membaca jawabannya melewati pengalihan
  302 Google. Inilah yang tidak bisa ditiru `uji/uji-peramban.mjs`.

## Perawatan

- **Memperbarui skrip:** `node deploy/drive/buat-siap.mjs`, tempel ulang `.siap/Code.gs`, simpan, lalu
  **Deploy → Manage deployments → edit (pensil) → Version: New version → Deploy**. Alamat `/exec` tetap sama.
- **Mengganti kunci:** hapus `.siap/rahasia.txt`, jalankan `buat-siap.mjs`, jalankan ulang
  `.siap/supabase.sql`, lalu tempel ulang dan deploy ulang Code.gs.
- **Menghentikan pemicu:** jalankan `lepas`. **Menghentikan unggahan:** kosongkan `DRIVE_URL` (situs
  kembali ke bucket Supabase), atau arsipkan deployment Web App.
- **Sheet terhapus permanen:** jalankan `sheetBaru`, lalu di Supabase:
  `update public.tednas_tim set drive_tersalin = 0;`. Semua tim ditulis ulang oleh pemicu (50 per putaran).
- **Kuota Gmail:** pemicu 90 menit/hari dan 20.000 UrlFetch/hari, dibagi dengan skrip lain di akun ini
  (salinan JES 2026). Unggahan dan kabar dari database berjalan sebagai Web App, jadi tidak memakan jatah
  pemicu. Web App dibatasi ±30 eksekusi bersamaan. Klien mengunggah 2 berkas sekaligus dan mencoba ulang
  dengan jeda bila Google menolak.
- **Tim dihapus admin:** baris di Sheet ditandai "DIHAPUS dari situs" dan foldernya diberi awalan
  `[DIHAPUS]`. Berkasnya **tidak** dihapus; hapus manual dari Drive bila perlu.

## Uji (di laptop)

| Perintah | Isi |
|---|---|
| `node uji/uji-sql.mjs` | skema + migrasi 8 di Postgres 17 sungguhan (container sementara di server jot, tiruan Supabase): tanda HMAC Node = pgcrypto, pendaftaran Drive & lama, kabar setelah commit membawa pemain, verifikasi, hapus, antrean, hak akses |
| `node uji/uji-drive.mjs` | Code.gs di Node dengan Google/Supabase tiruan (nama parameter RPC dicocokkan ke migrasi) + `public/js/drive.js` |
| `node uji/uji-peramban.mjs` | Chromium: halaman daftar asli → Code.gs asli → RPC tiruan → Sheet & folder; 2 unggahan bersamaan, coba ulang, pesan galat per berkas |
