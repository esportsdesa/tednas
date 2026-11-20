# TEDNas

Website Turnamen Esports Desa Nasional 2027, Ditjen Percepatan Pembangunan Daerah Tertinggal.
Online di https://esportsdesa.id (Vercel: esportsdesa-1941, Supabase: dlznnpmzccndjqxxhnio).
Alamat lama tednas.vercel.app dialihkan otomatis ke esportsdesa.id.
Statis (`public/`) + Supabase + Vercel, tanpa proses build.

## Menyambungkan ke Supabase

1. Buat proyek Supabase, lalu jalankan seluruh `supabase/schema-tednas.sql` di SQL Editor.
2. Authentication > Users > Add user: email `admin@tednas.id`, buat kata sandi, centang Auto Confirm User.
3. Jalankan di SQL Editor:
   `insert into public.tednas_admin (user_id) select id from auth.users where email = 'admin@tednas.id';`
4. Authentication > Sign In / Providers: matikan "Allow new users to sign up".
5. Isi URL dan kunci publik proyek di `public/js/config.js`.

## Penyimpanan Google Drive

Berkas pendaftar diunggah langsung ke Google Drive yanuarardaraja@gmail.com lewat Web App Apps Script
(`deploy/drive/Code.gs`), tidak ke bucket Supabase (paket gratis hanya 1 GB). Data tim dikirim database ke
Sheet di Drive yang sama seketika saat mendaftar/berubah. Aktif bila `DRIVE_URL` di `public/js/config.js` diisi.
Pasang, uji, dan perawatan: [deploy/drive/PASANG.md](deploy/drive/PASANG.md). Migrasi: `supabase/migration-8-drive.sql` dan `migration-9-cermin-drive.sql`. Salinan penuh juga tercatat di Drive esportsdesa@gmail.com: [deploy/drive/CERMIN.md](deploy/drive/CERMIN.md).

## Cek berkas otomatis (agen AI)

Agen AI di server dapur membaca berkas tiap tim begitu tim mendaftar. Model gabungan: qwen3.5:9b di armada worker
membaca semua berkas, lalu berkas yang ditolaknya dibaca ulang Qwen3.6-35B di pool GPU.
Yang dibaca: identitas, umur, domisili satu kabupaten/kota, surat izin, profil Mobile Legends, bukti follow, dan pemain
yang terdaftar di dua tim.
- Lolos semua pemeriksaan: status langsung **Terverifikasi**.
- Ada catatan: tim tetap Menunggu, dan catatannya tampil di kolom **Cek AI** halaman admin.
- Status yang diubah admin tidak pernah ditimpa AI.

Kode agen dikelola panitia di luar repo ini. Migrasi: `supabase/migration-10-ai-periksa.sql`.
Selama migrasi itu belum dijalankan, halaman admin tetap berjalan seperti biasa tanpa kolom AI.

## Kabari kapten & perbaikan berkas

Admin cukup menekan **WA Kapten** di baris tim. WhatsApp admin terbuka ke nomor kapten dengan pesan yang sudah jadi:
- tim Menunggu: daftar perbaikan per pemain (catatan AI yang diubah jadi petunjuk untuk kapten, `public/js/saran.js`)
  dan tautan khusus tim itu, `perbaiki.html#<kode>.<token>`;
- tim Terverifikasi: kabar sudah terverifikasi;
- keduanya ditutup tautan grup WhatsApp peserta.

Lewat tautan itu kapten mengganti sendiri nama pemain, jenis kartu identitas, atau berkasnya. Berkas diunggah ke
Drive seperti saat mendaftar. Agen AI lalu memeriksa ulang tim itu, dan tim langsung Terverifikasi bila semuanya
sesuai. Tim yang sudah Terverifikasi tidak bisa diubah lewat tautan. Di halaman admin tercatat kapan kapten
dikabari dan kapan ia memperbaiki. Migrasi: `supabase/migration-12-perbaiki.sql`.

## Tautan komunitas (ToT)

Lomba antarkomunitas (ToT) dan papan skornya ada di **MZone**. esportsdesa.id tetap hanya jalur pendaftaran: di sini
cuma tautan pendaftaran per komunitas, `esportsdesa.id/k/<nomor>`, dan pencatatan komunitas tiap tim.
- **Admin → tab Komunitas:** tambah komunitas (nama, kota, provinsi, PIC), salin tautannya, atau kirim ke PIC dengan
  **WA PIC**. Komunitas bisa dinonaktifkan: tautannya tidak lagi mencatat tim baru.
- **Pendaftar:** `/k/<nomor>` dialihkan ke `daftar?k=<nomor>`. Formulir menampilkan "Kamu mendaftar lewat komunitas …".
  Kode disimpan 30 hari di browser (tautan terakhir yang berlaku), jadi tetap tercatat walau pendaftar baru mendaftar
  besoknya.
- **Komunitas bawaan MZone Tour:** tim yang mendaftar tanpa tautan komunitas, lewat kode yang tidak dikenal, atau lewat
  komunitas yang dinonaktifkan masuk ke sini. Tim yang terdaftar sebelum fitur ini juga dipindah ke sini oleh migrasi.
  Pendaftaran tidak pernah gagal karena kode komunitas.
- **Skor** yang ditampilkan admin: tim terverifikasi per komunitas (jumlah yang mendaftar dan menunggu ikut tampil).
- **Koreksi:** di dialog pemain, admin bisa memindahkan tim ke komunitas lain. Kolom CSV `komunitas` ikut terisi.

Migrasi: `supabase/migration-13-komunitas.sql`.

## Captcha (Cloudflare Turnstile)

Buat widget untuk hostname `esportsdesa.id` dan `tednas.vercel.app`. Site Key diisi di `public/js/config.js`. Secret Key dijalankan di SQL Editor:
`insert into public.tednas_rahasia (id, turnstile_secret) values (1, 'SECRET_KEY') on conflict (id) do update set turnstile_secret = excluded.turnstile_secret;`

Tanpa keduanya, formulir tampil tertutup dan database menolak pendaftaran.

Masuk di `/admin` dengan nama pengguna `admin`. Selama `config.js` masih `GANTI_...`, situs berjalan mode lokal.

## Mengubah website

Repository ini tersambung ke Vercel. Setiap perubahan yang di-push ke cabang `main`
otomatis tayang di https://esportsdesa.id dalam 1–2 menit; cabang lain menjadi pratinjau.

1. Clone repository, ubah berkas di `public/`, cek dengan server lokal
   (`python3 -m http.server --directory public`).
2. Commit dan push ke `main`, atau buat pull request supaya dicek dulu.
3. Perubahan database: tulis berkas `supabase/migration-N-....sql` baru dan minta pemilik
   proyek Supabase menjalankannya SEBELUM kodenya di-push.

Catatan:
- Tiap mengubah `public/data/`, naikkan `DATA_VERSI` di `public/js/common.js`.
- Jangan hapus meta `google-site-verification` di `index.html`.

## Data wilayah

`public/data/` dibangkitkan dari cahyadsn/wilayah (Kepmendagri 300.2.2-2138 Tahun 2025):
lalu disaring hanya desa: 37 provinsi (tanpa DKI Jakarta), 415 kabupaten + 19 kota yang punya desa, 75.266 desa
(74.446 di kabupaten + 820 di kota, migrasi 11). Kelurahan tidak bisa mendaftar.
