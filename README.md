# TEDNas

Website Turnamen Esports Desa Nasional 2027, Ditjen Percepatan Pembangunan Daerah Tertinggal.
Online di https://tednas.vercel.app (Vercel: esportsdesa-1941, Supabase: dlznnpmzccndjqxxhnio).
Statis (`public/`) + Supabase + Vercel, tanpa proses build.

## Menyambungkan ke Supabase

1. Buat proyek Supabase, lalu jalankan seluruh `supabase/schema-tednas.sql` di SQL Editor.
2. Authentication > Users > Add user: email `admin@tednas.id`, buat kata sandi, centang Auto Confirm User.
3. Jalankan di SQL Editor:
   `insert into public.tednas_admin (user_id) select id from auth.users where email = 'admin@tednas.id';`
4. Authentication > Sign In / Providers: matikan "Allow new users to sign up".
5. Isi URL dan kunci publik proyek di `public/js/config.js`.

## Captcha (Cloudflare Turnstile)

Buat widget untuk hostname `tednas.vercel.app`. Site Key diisi di `public/js/config.js`. Secret Key dijalankan di SQL Editor:
`insert into public.tednas_rahasia (id, turnstile_secret) values (1, 'SECRET_KEY') on conflict (id) do update set turnstile_secret = excluded.turnstile_secret;`

Tanpa keduanya, formulir tampil tertutup dan database menolak pendaftaran.

Masuk di `/admin` dengan nama pengguna `admin`. Selama `config.js` masih `GANTI_...`, situs berjalan mode lokal.

## Deploy ulang

```bash
npx vercel deploy --prod --yes
```

## Data wilayah

`public/data/` dibangkitkan dari cahyadsn/wilayah (Kepmendagri 300.2.2-2138 Tahun 2025):
lalu disaring hanya desa di kabupaten: 37 provinsi (tanpa DKI Jakarta), 415 kabupaten, 74.446 desa. Kota dan kelurahan tidak bisa mendaftar.
