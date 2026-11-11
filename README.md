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
Pasang, uji, dan perawatan: [deploy/drive/PASANG.md](deploy/drive/PASANG.md). Migrasi: `supabase/migration-8-drive.sql`.

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
lalu disaring hanya desa di kabupaten: 37 provinsi (tanpa DKI Jakarta), 415 kabupaten, 74.446 desa. Kota dan kelurahan tidak bisa mendaftar.
