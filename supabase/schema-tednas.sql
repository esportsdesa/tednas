-- TEDNas 2027 - Turnamen Esports Desa Nasional
-- Jalankan seluruh isi berkas ini di Supabase > SQL Editor. Aman dijalankan ulang.
--
-- Prinsip keamanan:
--  * Publik TIDAK BISA membaca tabel tednas_tim (berisi no. WA & dokumen KTP).
--    Publik hanya melihat view tednas_tim_publik yang tanpa kolom pribadi.
--  * Pendaftaran hanya lewat fungsi tednas_daftar().
--  * Dokumen disimpan di bucket PRIVAT: publik hanya bisa mengunggah, tidak bisa
--    membaca/menimpa/menghapus. Hanya admin yang bisa membuka.
--  * Admin = akun yang tercatat di tednas_admin, bukan sekadar "sudah login",
--    sehingga pendaftaran akun liar di Supabase Auth tidak memberi hak apa pun.

-- ========== TABEL ==========
create extension if not exists http with schema extensions;

-- Kunci rahasia Cloudflare Turnstile. Tanpa policy: tidak terbaca lewat API oleh siapa pun.
create table if not exists public.tednas_rahasia (
  id int primary key default 1 check (id = 1),
  turnstile_secret text not null
);
alter table public.tednas_rahasia enable row level security;
revoke all on public.tednas_rahasia from anon, authenticated;

create table if not exists public.tednas_admin (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.tednas_pengaturan (
  id int primary key default 1 check (id = 1),
  pendaftaran_buka boolean not null default true,
  buka_mulai timestamptz, -- jadwal buka; kosong = langsung ikut pendaftaran_buka
  updated_at timestamptz not null default now()
);
insert into public.tednas_pengaturan (id) values (1) on conflict (id) do nothing;

create sequence if not exists public.tednas_kode_seq;

create table if not exists public.tednas_tim (
  id uuid primary key default gen_random_uuid(),
  kode text not null unique,
  nama_tim text not null check (char_length(nama_tim) between 2 and 60),
  nama_kapten text not null check (char_length(nama_kapten) between 2 and 80),
  wa_kapten text not null unique check (wa_kapten ~ '^628[0-9]{7,12}$'),
  prov_kode text not null,
  provinsi text not null,
  kab_kode text not null,
  kabupaten text not null,
  kecamatan text not null default '',
  desa_kode text not null,
  desa text not null,
  status text not null default 'menunggu' check (status in ('menunggu','terverifikasi')),
  created_at timestamptz not null default now()
);
create index if not exists tednas_tim_prov on public.tednas_tim (prov_kode);
create index if not exists tednas_tim_kab on public.tednas_tim (kab_kode);
create index if not exists tednas_tim_waktu on public.tednas_tim (created_at desc);

create table if not exists public.tednas_match (
  id uuid primary key default gen_random_uuid(),
  fase text not null check (fase in ('provinsi','nasional')),
  prov_kode text,            -- null untuk fase nasional
  provinsi text,
  ronde int not null check (ronde > 0),
  label text not null default '',
  urut int not null default 0,  -- posisi di bagan
  bo int not null default 1 check (bo in (1,3,5)),
  tim_a uuid references public.tednas_tim(id) on delete set null,
  tim_b uuid references public.tednas_tim(id) on delete set null,
  skor_a int check (skor_a >= 0),
  skor_b int check (skor_b >= 0),
  pemenang uuid references public.tednas_tim(id) on delete set null,
  status text not null default 'terjadwal' check (status in ('terjadwal','selesai','bye')),
  jadwal timestamptz,
  tautan_live text,
  created_at timestamptz not null default now()
);
create index if not exists tednas_match_fase on public.tednas_match (fase, prov_kode, ronde);

create table if not exists public.tednas_galeri (
  id uuid primary key default gen_random_uuid(),
  jenis text not null check (jenis in ('foto','video','tautan')),
  judul text not null default '',
  url text not null,
  path text,                 -- terisi bila berkas diunggah ke bucket galeri
  created_at timestamptz not null default now()
);

-- ========== HAK ADMIN ==========
create or replace function public.tednas_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tednas_admin where user_id = auth.uid());
$$;

alter table public.tednas_admin enable row level security;
alter table public.tednas_pengaturan enable row level security;
alter table public.tednas_tim enable row level security;
alter table public.tednas_match enable row level security;
alter table public.tednas_galeri enable row level security;

drop policy if exists adm_baca on public.tednas_admin;
create policy adm_baca on public.tednas_admin for select to authenticated using (user_id = auth.uid());

drop policy if exists set_baca on public.tednas_pengaturan;
create policy set_baca on public.tednas_pengaturan for select to anon, authenticated using (true);
drop policy if exists set_ubah on public.tednas_pengaturan;
create policy set_ubah on public.tednas_pengaturan for update to authenticated
  using (public.tednas_is_admin()) with check (public.tednas_is_admin());

-- Tabel tim: admin saja. Publik lewat view + fungsi.
drop policy if exists tim_admin on public.tednas_tim;
create policy tim_admin on public.tednas_tim for all to authenticated
  using (public.tednas_is_admin()) with check (public.tednas_is_admin());

drop policy if exists match_baca on public.tednas_match;
create policy match_baca on public.tednas_match for select to anon, authenticated using (true);
drop policy if exists match_admin on public.tednas_match;
create policy match_admin on public.tednas_match for all to authenticated
  using (public.tednas_is_admin()) with check (public.tednas_is_admin());

drop policy if exists galeri_baca on public.tednas_galeri;
create policy galeri_baca on public.tednas_galeri for select to anon, authenticated using (true);
drop policy if exists galeri_admin on public.tednas_galeri;
create policy galeri_admin on public.tednas_galeri for all to authenticated
  using (public.tednas_is_admin()) with check (public.tednas_is_admin());

create table if not exists public.tednas_pemain (
  id uuid primary key default gen_random_uuid(),
  tim_id uuid not null references public.tednas_tim(id) on delete cascade,
  urutan int not null check (urutan between 1 and 6),
  nama text not null check (char_length(nama) between 2 and 80),
  dokumen_jenis text not null check (dokumen_jenis in ('KTP','KK','Suket RT/RW','Kartu Pelajar')),
  dokumen_path text not null unique,
  profil_ml_path text not null unique,
  izin_path text unique,
  follow_esports_path text unique,
  follow_ppdt_path text unique,
  unique (tim_id, urutan)
);
alter table public.tednas_pemain enable row level security;
revoke all on public.tednas_pemain from anon;
drop policy if exists pemain_admin on public.tednas_pemain;
create policy pemain_admin on public.tednas_pemain for all to authenticated
  using (public.tednas_is_admin()) with check (public.tednas_is_admin());


-- Peserta hanya desa di kabupaten: DKI Jakarta (31), kota (kode 71 ke atas), dan kelurahan (awalan 1) ditolak.
alter table public.tednas_tim drop constraint if exists tednas_tim_hanya_desa;
alter table public.tednas_tim add constraint tednas_tim_hanya_desa check (
  prov_kode <> '31' and substr(kab_kode, 4, 2)::int < 71 and substr(desa_kode, 10, 1) = '2');

-- ========== VIEW PUBLIK (tanpa WA, kapten, dan dokumen) ==========
drop view if exists public.tednas_match_publik;
drop view if exists public.tednas_tim_publik;
create view public.tednas_tim_publik as
  select id, kode, nama_tim, prov_kode, provinsi, kab_kode, kabupaten, kecamatan,
         desa_kode, desa, status, created_at
  from public.tednas_tim;

create view public.tednas_match_publik as
  select m.id, m.fase, m.prov_kode, m.provinsi, m.ronde, m.label, m.bo, m.urut,
         m.tim_a, m.tim_b, m.skor_a, m.skor_b, m.pemenang, m.status, m.jadwal, m.tautan_live,
         a.nama_tim as a_nama, a.desa as a_desa, a.kabupaten as a_kab,
         b.nama_tim as b_nama, b.desa as b_desa, b.kabupaten as b_kab
  from public.tednas_match m
  left join public.tednas_tim a on a.id = m.tim_a
  left join public.tednas_tim b on b.id = m.tim_b;

revoke all on public.tednas_tim from anon;
revoke all on public.tednas_admin from anon;
grant select on public.tednas_tim_publik, public.tednas_match_publik to anon, authenticated;

-- ========== FUNGSI PUBLIK ==========
create or replace function public.tednas_statistik()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'total', (select count(*) from public.tednas_tim),
    'terverifikasi', (select count(*) from public.tednas_tim where status = 'terverifikasi'),
    'kabupaten', (select count(distinct kab_kode) from public.tednas_tim),
    'provinsi', (select count(distinct prov_kode) from public.tednas_tim),
    'per_provinsi', coalesce((
      select json_agg(r order by r.jumlah desc, r.provinsi)
      from (select prov_kode, provinsi, count(*) as jumlah
            from public.tednas_tim group by prov_kode, provinsi) r), '[]'::json)
  );
$$;

drop function if exists public.tednas_daftar(text,text,text,text,text,text,text,text,text,text,text,text,text,text);
create or replace function public.tednas_daftar(
  p_nama_tim text, p_wa text,
  p_prov_kode text, p_provinsi text, p_kab_kode text, p_kabupaten text,
  p_kecamatan text, p_desa_kode text, p_desa text,
  p_pemain jsonb, p_captcha text
) returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  v_wa text := regexp_replace(coalesce(p_wa,''), '[^0-9]', '', 'g');
  v_kode text;
  v_secret text;
  v_jawab text;
  v_tim uuid;
  v_jumlah int := case when jsonb_typeof(p_pemain) = 'array' then jsonb_array_length(p_pemain) else 0 end;
  v_p jsonb;
  v_berkas text[] := '{}';
begin
  if not (select pendaftaran_buka from public.tednas_pengaturan where id = 1) then
    raise exception 'PENDAFTARAN_TUTUP';
  end if;
  if v_wa like '08%' then v_wa := '62' || substr(v_wa, 2); end if;
  if v_wa !~ '^628[0-9]{7,12}$' then raise exception 'WA_TIDAK_VALID'; end if;

  if coalesce(p_prov_kode,'') !~ '^[0-9]{2}$'
     or coalesce(p_kab_kode,'') !~ '^[0-9]{2}\.[0-9]{2}$'
     or coalesce(p_desa_kode,'') !~ '^[0-9]{2}\.[0-9]{2}\.[0-9]{2}\.[0-9]{4}$'
     or left(p_desa_kode, 5) <> p_kab_kode or left(p_kab_kode, 2) <> p_prov_kode then
    raise exception 'WILAYAH_TIDAK_VALID';
  end if;

  if v_jumlah not in (5, 6) then raise exception 'PEMAIN_TIDAK_LENGKAP'; end if;
  for v_p in select * from jsonb_array_elements(p_pemain) loop
    if char_length(trim(coalesce(v_p->>'nama',''))) not between 2 and 80 then
      raise exception 'PEMAIN_TIDAK_LENGKAP';
    end if;
    if coalesce(v_p->>'dokumen_jenis','') not in ('KTP','KK','Suket RT/RW','Kartu Pelajar')
       or coalesce(v_p->>'dokumen_path','') !~ '^dokumen/[^/]+\.(pdf|jpg|png)$'
       or not exists (select 1 from storage.objects
                      where bucket_id = 'tednas-dokumen' and name = v_p->>'dokumen_path') then
      raise exception 'DOKUMEN_TIDAK_ADA';
    end if;
    if coalesce(v_p->>'profil_ml_path','') !~ '^dokumen/[^/]+\.(jpg|png)$'
       or not exists (select 1 from storage.objects
                      where bucket_id = 'tednas-dokumen' and name = v_p->>'profil_ml_path') then
      raise exception 'PROFIL_ML_TIDAK_ADA';
    end if;
    if coalesce(v_p->>'follow_esports_path','') !~ '^dokumen/[^/]+\.(jpg|png)$'
       or coalesce(v_p->>'follow_ppdt_path','') !~ '^dokumen/[^/]+\.(jpg|png)$'
       or not exists (select 1 from storage.objects
                      where bucket_id = 'tednas-dokumen' and name = v_p->>'follow_esports_path')
       or not exists (select 1 from storage.objects
                      where bucket_id = 'tednas-dokumen' and name = v_p->>'follow_ppdt_path') then
      raise exception 'FOLLOW_TIDAK_ADA';
    end if;
    if nullif(v_p->>'izin_path','') is not null
       and (v_p->>'izin_path' !~ '^dokumen/[^/]+\.(pdf|jpg|png)$'
            or not exists (select 1 from storage.objects
                           where bucket_id = 'tednas-dokumen' and name = v_p->>'izin_path')) then
      raise exception 'IZIN_TIDAK_ADA';
    end if;
    v_berkas := v_berkas || (v_p->>'dokumen_path') || (v_p->>'profil_ml_path')
      || (v_p->>'follow_esports_path') || (v_p->>'follow_ppdt_path');
    if nullif(v_p->>'izin_path','') is not null then v_berkas := v_berkas || (v_p->>'izin_path'); end if;
  end loop;

  -- Satu berkas tidak boleh dipakai dua kali, baik di tim ini maupun tim lain.
  if (select count(distinct b) from unnest(v_berkas) b) <> cardinality(v_berkas)
     or exists (select 1 from public.tednas_pemain t
                where t.dokumen_path = any(v_berkas) or t.profil_ml_path = any(v_berkas) or t.izin_path = any(v_berkas)
                   or t.follow_esports_path = any(v_berkas) or t.follow_ppdt_path = any(v_berkas)) then
    raise exception 'DOKUMEN_TIDAK_ADA';
  end if;

  if exists (select 1 from public.tednas_tim where wa_kapten = v_wa) then
    raise exception 'WA_SUDAH_ADA';
  end if;

  select turnstile_secret into v_secret from public.tednas_rahasia where id = 1;
  if v_secret is null then raise exception 'CAPTCHA_BELUM_SIAP'; end if;
  if coalesce(p_captcha,'') = '' then raise exception 'CAPTCHA_GAGAL'; end if;
  select content into v_jawab from extensions.http_post(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    'secret=' || extensions.urlencode(v_secret) || '&response=' || extensions.urlencode(p_captcha),
    'application/x-www-form-urlencoded');
  if coalesce((v_jawab::json->>'success')::boolean, false) is not true then
    raise exception 'CAPTCHA_GAGAL';
  end if;

  v_kode := 'TED-' || lpad(nextval('public.tednas_kode_seq')::text, 5, '0');
  insert into public.tednas_tim (kode, nama_tim, nama_kapten, wa_kapten, prov_kode, provinsi,
    kab_kode, kabupaten, kecamatan, desa_kode, desa)
  values (v_kode, trim(p_nama_tim), trim(p_pemain->0->>'nama'), v_wa, p_prov_kode, left(p_provinsi,80),
    p_kab_kode, left(p_kabupaten,80), left(coalesce(p_kecamatan,''),80), p_desa_kode, left(p_desa,80))
  returning id into v_tim;

  insert into public.tednas_pemain (tim_id, urutan, nama, dokumen_jenis, dokumen_path, profil_ml_path,
    follow_esports_path, follow_ppdt_path, izin_path)
    select v_tim, u::int, trim(e->>'nama'), e->>'dokumen_jenis', e->>'dokumen_path', e->>'profil_ml_path',
      e->>'follow_esports_path', e->>'follow_ppdt_path', nullif(e->>'izin_path','')
    from jsonb_array_elements(p_pemain) with ordinality as x(e, u);

  return json_build_object('kode', v_kode);
exception
  when unique_violation then
    if sqlerrm like '%wa_kapten%' then raise exception 'WA_SUDAH_ADA'; end if;
    if sqlerrm like '%_path_%' then raise exception 'DOKUMEN_TIDAK_ADA'; end if;
    raise;
end;
$$;

grant execute on function public.tednas_statistik() to anon, authenticated;
grant execute on function public.tednas_daftar(text,text,text,text,text,text,text,text,text,jsonb,text) to anon, authenticated;

-- Jadwal buka pendaftaran (migrasi 6).
-- Penjaga di database: berlaku untuk semua jalur insert, jadi tednas_daftar tak perlu ditulis ulang.
create or replace function public.tednas_cek_jadwal_buka()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.tednas_pengaturan where id = 1 and buka_mulai is not null and now() < buka_mulai) then
    raise exception 'PENDAFTARAN_BELUM_DIBUKA';
  end if;
  return new;
end $$;

drop trigger if exists tednas_tim_jadwal_buka on public.tednas_tim;
create trigger tednas_tim_jadwal_buka before insert on public.tednas_tim
  for each row execute function public.tednas_cek_jadwal_buka();

-- ========== PENYIMPANAN BERKAS ==========
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tednas-dokumen', 'tednas-dokumen', false, 5242880,
        array['application/pdf','image/jpeg','image/png'])
on conflict (id) do update set public = false, file_size_limit = 5242880,
  allowed_mime_types = array['application/pdf','image/jpeg','image/png'];

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tednas-galeri', 'tednas-galeri', true, 52428800,
        array['image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime'])
on conflict (id) do update set public = true, file_size_limit = 52428800,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime'];

drop policy if exists tednas_dok_unggah on storage.objects;
create policy tednas_dok_unggah on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'tednas-dokumen' and (storage.foldername(name))[1] = 'dokumen');
drop policy if exists tednas_dok_admin_baca on storage.objects;
create policy tednas_dok_admin_baca on storage.objects for select to authenticated
  using (bucket_id = 'tednas-dokumen' and public.tednas_is_admin());
drop policy if exists tednas_dok_admin_hapus on storage.objects;
create policy tednas_dok_admin_hapus on storage.objects for delete to authenticated
  using (bucket_id = 'tednas-dokumen' and public.tednas_is_admin());

drop policy if exists tednas_gal_admin_tulis on storage.objects;
create policy tednas_gal_admin_tulis on storage.objects for insert to authenticated
  with check (bucket_id = 'tednas-galeri' and public.tednas_is_admin());
drop policy if exists tednas_gal_admin_hapus on storage.objects;
create policy tednas_gal_admin_hapus on storage.objects for delete to authenticated
  using (bucket_id = 'tednas-galeri' and public.tednas_is_admin());
drop policy if exists tednas_gal_baca on storage.objects;
create policy tednas_gal_baca on storage.objects for select to anon, authenticated
  using (bucket_id = 'tednas-galeri');
