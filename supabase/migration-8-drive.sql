-- Migrasi 8: penyimpanan di Google Drive (yanuarardaraja@gmail.com).
-- Jalankan seluruh isi berkas ini di Supabase > SQL Editor. Aman dijalankan ulang.
--
--  * BERKAS pendaftar (identitas, profil ML, bukti follow, izin) diunggah browser LANGSUNG ke Google Drive
--    lewat Web App Apps Script (deploy/drive/Code.gs), tidak lewat bucket Supabase. Web App mengembalikan
--    path "gdrive/<id berkas>.<ext>~<tanda HMAC>"; tednas_daftar() memeriksa tandanya lalu menyimpan
--    path tanpa tanda. Path lama "dokumen/..." (bucket Supabase) tetap diterima.
--  * DATA tim dikirim ke Web App SEKETIKA saat tersimpan/berubah/dihapus (pg_net, setelah commit) dan
--    ditulis ke Google Sheet. Bila pengiriman gagal, pemicu berkala di Apps Script menyusul lewat
--    kolom drive_versi > drive_tersalin. Pengiriman tidak pernah menggagalkan pendaftaran.
--  * Rahasia (drive_rahasia) dan alamat Web App (drive_url) disimpan di tednas_rahasia yang tidak
--    terbaca lewat API. Rahasia diisi TERPISAH (bukan di berkas ini) — lihat deploy/drive/PASANG.md.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_net with schema extensions;

alter table public.tednas_rahasia add column if not exists drive_rahasia text;
alter table public.tednas_rahasia add column if not exists drive_url text;
-- Salinan alamat Web App yang boleh dibaca publik (alamat ini memang dipakai browser untuk mengunggah).
alter table public.tednas_pengaturan add column if not exists drive_url text;

-- drive_versi naik tiap data tim berubah; drive_tersalin = versi yang sudah tertulis di Sheet;
-- drive_rapi > 0 = berkas tim sudah dipindah ke folder timnya di Drive.
alter table public.tednas_tim add column if not exists drive_versi int not null default 1;
alter table public.tednas_tim add column if not exists drive_tersalin int not null default 0;
alter table public.tednas_tim add column if not exists drive_rapi int not null default 0;
alter table public.tednas_tim add column if not exists drive_folder text;
alter table public.tednas_tim add column if not exists drive_pada timestamptz;
create index if not exists tednas_tim_drive_perlu on public.tednas_tim (created_at) where drive_tersalin < drive_versi;

-- Tim yang dihapus admin: ditandai "DIHAPUS" di Sheet, lalu baris antrean ini dibuang.
create table if not exists public.tednas_drive_hapus (
  kode text primary key,
  nama_tim text not null,
  waktu timestamptz not null default now()
);
alter table public.tednas_drive_hapus enable row level security;
revoke all on public.tednas_drive_hapus from anon, authenticated;

-- ========== PEMERIKSA BERKAS ==========
-- Path yang sah → path yang disimpan (tanpa tanda); tidak sah → null.
create or replace function public.tednas_berkas_sah(p_path text, p_pdf boolean)
returns text language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_ext text := case when p_pdf then '(pdf|jpg|png)' else '(jpg|png)' end;
  v_inti text;
  v_rahasia text;
begin
  if coalesce(p_path, '') = '' then return null; end if;
  if p_path ~ ('^dokumen/[^/]+\.' || v_ext || '$') then
    if exists (select 1 from storage.objects where bucket_id = 'tednas-dokumen' and name = p_path) then
      return p_path;
    end if;
    return null;
  end if;
  if p_path ~ ('^gdrive/[A-Za-z0-9_-]{10,100}\.' || v_ext || '~[0-9a-f]{64}$') then
    select drive_rahasia into v_rahasia from public.tednas_rahasia where id = 1;
    if v_rahasia is null then return null; end if;
    v_inti := split_part(p_path, '~', 1);
    if encode(extensions.hmac(v_inti, v_rahasia, 'sha256'), 'hex') = split_part(p_path, '~', 2) then
      return v_inti;
    end if;
  end if;
  return null;
end $$;

-- ========== PENDAFTARAN (sama dengan sebelumnya + path Google Drive) ==========
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
  v_bersih jsonb := '[]'::jsonb;
  v_dok text; v_ml text; v_ig1 text; v_ig2 text; v_izin text;
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
    if coalesce(v_p->>'dokumen_jenis','') not in ('KTP','KK','Suket RT/RW','Kartu Pelajar') then
      raise exception 'DOKUMEN_TIDAK_ADA';
    end if;
    v_dok := public.tednas_berkas_sah(v_p->>'dokumen_path', true);
    if v_dok is null then raise exception 'DOKUMEN_TIDAK_ADA'; end if;
    v_ml := public.tednas_berkas_sah(v_p->>'profil_ml_path', false);
    if v_ml is null then raise exception 'PROFIL_ML_TIDAK_ADA'; end if;
    v_ig1 := public.tednas_berkas_sah(v_p->>'follow_esports_path', false);
    v_ig2 := public.tednas_berkas_sah(v_p->>'follow_ppdt_path', false);
    if v_ig1 is null or v_ig2 is null then raise exception 'FOLLOW_TIDAK_ADA'; end if;
    v_izin := null;
    if nullif(v_p->>'izin_path','') is not null then
      v_izin := public.tednas_berkas_sah(v_p->>'izin_path', true);
      if v_izin is null then raise exception 'IZIN_TIDAK_ADA'; end if;
    end if;
    v_berkas := v_berkas || v_dok || v_ml || v_ig1 || v_ig2;
    if v_izin is not null then v_berkas := v_berkas || v_izin; end if;
    v_bersih := v_bersih || jsonb_build_object('nama', trim(v_p->>'nama'), 'dokumen_jenis', v_p->>'dokumen_jenis',
      'dokumen_path', v_dok, 'profil_ml_path', v_ml, 'follow_esports_path', v_ig1, 'follow_ppdt_path', v_ig2, 'izin_path', v_izin);
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
  values (v_kode, trim(p_nama_tim), v_bersih->0->>'nama', v_wa, p_prov_kode, left(p_provinsi,80),
    p_kab_kode, left(p_kabupaten,80), left(coalesce(p_kecamatan,''),80), p_desa_kode, left(p_desa,80))
  returning id into v_tim;

  insert into public.tednas_pemain (tim_id, urutan, nama, dokumen_jenis, dokumen_path, profil_ml_path,
    follow_esports_path, follow_ppdt_path, izin_path)
    select v_tim, u::int, e->>'nama', e->>'dokumen_jenis', e->>'dokumen_path', e->>'profil_ml_path',
      e->>'follow_esports_path', e->>'follow_ppdt_path', nullif(e->>'izin_path','')
    from jsonb_array_elements(v_bersih) with ordinality as x(e, u);

  return json_build_object('kode', v_kode);
exception
  when unique_violation then
    if sqlerrm like '%wa_kapten%' then raise exception 'WA_SUDAH_ADA'; end if;
    if sqlerrm like '%_path_%' then raise exception 'DOKUMEN_TIDAK_ADA'; end if;
    raise;
end;
$$;
grant execute on function public.tednas_daftar(text,text,text,text,text,text,text,text,text,jsonb,text) to anon, authenticated;

-- ========== KABAR KE GOOGLE DRIVE ==========
-- Satu tim lengkap dengan pemainnya (berisi nomor WA: hanya untuk Web App pemilik Drive).
create or replace function public.tednas_drive_paket(p_tim uuid)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'id', t.id, 'kode', t.kode, 'nama_tim', t.nama_tim, 'nama_kapten', t.nama_kapten, 'wa_kapten', t.wa_kapten,
    'prov_kode', t.prov_kode, 'provinsi', t.provinsi, 'kab_kode', t.kab_kode, 'kabupaten', t.kabupaten,
    'kecamatan', t.kecamatan, 'desa_kode', t.desa_kode, 'desa', t.desa, 'status', t.status, 'created_at', t.created_at,
    'versi', t.drive_versi, 'rapi', t.drive_rapi, 'folder', t.drive_folder,
    'pemain', coalesce((
      select json_agg(json_build_object('urutan', p.urutan, 'nama', p.nama, 'dokumen_jenis', p.dokumen_jenis,
        'dokumen_path', p.dokumen_path, 'profil_ml_path', p.profil_ml_path, 'follow_esports_path', p.follow_esports_path,
        'follow_ppdt_path', p.follow_ppdt_path, 'izin_path', p.izin_path) order by p.urutan)
      from public.tednas_pemain p where p.tim_id = t.id), '[]'::json))
  from public.tednas_tim t where t.id = p_tim;
$$;

-- Kirim satu kabar ke Web App (pg_net: dikirim setelah commit, tidak menunggu jawaban).
-- Galat apa pun hanya menjadi peringatan: pendaftaran/ubah status tidak boleh gagal karena Drive.
create or replace function public.tednas_drive_kirim(p_isi jsonb)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_url text; v_kunci text;
begin
  select drive_url, drive_rahasia into v_url, v_kunci from public.tednas_rahasia where id = 1;
  if v_url is null or v_kunci is null then return; end if;
  perform net.http_post(url := v_url, body := p_isi || jsonb_build_object('kunci', v_kunci),
    headers := '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds := 60000);
exception when others then
  raise warning 'tednas_drive_kirim: %', sqlerrm;
end $$;

-- Versi naik hanya bila isi tim berubah (bukan kolom drive_* yang ditulis Apps Script).
create or replace function public.tednas_drive_versi()
returns trigger language plpgsql as $$
begin
  if (new.kode, new.nama_tim, new.nama_kapten, new.wa_kapten, new.prov_kode, new.provinsi, new.kab_kode,
      new.kabupaten, new.kecamatan, new.desa_kode, new.desa, new.status)
     is distinct from
     (old.kode, old.nama_tim, old.nama_kapten, old.wa_kapten, old.prov_kode, old.provinsi, old.kab_kode,
      old.kabupaten, old.kecamatan, old.desa_kode, old.desa, old.status) then
    new.drive_versi := old.drive_versi + 1;
  end if;
  return new;
end $$;
drop trigger if exists tednas_tim_drive_versi on public.tednas_tim;
create trigger tednas_tim_drive_versi before update on public.tednas_tim
  for each row execute function public.tednas_drive_versi();

-- Ditunda sampai commit: saat tednas_daftar() menyisipkan tim, pemainnya baru disisipkan sesudahnya.
create or replace function public.tednas_drive_kabar()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_paket json;
begin
  if tg_op = 'UPDATE' and new.drive_versi = old.drive_versi then return null; end if;
  v_paket := public.tednas_drive_paket(new.id);
  if v_paket is not null then
    perform public.tednas_drive_kirim(jsonb_build_object('aksi', 'tim', 'tim', v_paket));
  end if;
  return null;
end $$;
drop trigger if exists tednas_tim_drive_kabar on public.tednas_tim;
create constraint trigger tednas_tim_drive_kabar after insert or update on public.tednas_tim
  deferrable initially deferred for each row execute function public.tednas_drive_kabar();

-- Pemain diubah (mis. lewat Table Editor) → versi tim naik → Sheet ikut diperbarui.
create or replace function public.tednas_drive_pemain_ubah()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.tednas_tim set drive_versi = drive_versi + 1 where id in (select distinct tim_id from baru);
  return null;
end $$;
drop trigger if exists tednas_pemain_drive_ubah on public.tednas_pemain;
create trigger tednas_pemain_drive_ubah after update on public.tednas_pemain
  referencing new table as baru for each statement execute function public.tednas_drive_pemain_ubah();

create or replace function public.tednas_drive_hapus_kabar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.tednas_drive_hapus (kode, nama_tim) values (old.kode, old.nama_tim)
    on conflict (kode) do update set nama_tim = excluded.nama_tim, waktu = now();
  perform public.tednas_drive_kirim(jsonb_build_object('aksi', 'hapus', 'kode', old.kode));
  return old;
end $$;
drop trigger if exists tednas_tim_drive_hapus on public.tednas_tim;
create trigger tednas_tim_drive_hapus after delete on public.tednas_tim
  for each row execute function public.tednas_drive_hapus_kabar();

-- ========== PINTU UNTUK APPS SCRIPT (berkunci drive_rahasia) ==========
create or replace function public.tednas_drive_kunci_sah(p_kunci text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select drive_rahasia is not null and drive_rahasia = p_kunci from public.tednas_rahasia where id = 1), false);
$$;

-- p_jenis 'sheet': tim yang belum/berubah sejak tertulis di Sheet (+ antrean hapus).
-- p_jenis 'rapi' : tim yang sudah di Sheet tapi berkasnya belum dipindah ke folder tim.
create or replace function public.tednas_drive_antre(p_kunci text, p_jenis text, p_batas int default 20)
returns json language plpgsql stable security definer set search_path = public as $$
declare v_batas int := least(greatest(coalesce(p_batas, 20), 1), 100);
begin
  if not public.tednas_drive_kunci_sah(p_kunci) then raise exception 'KUNCI_SALAH'; end if;
  if p_jenis = 'sheet' then
    return json_build_object(
      'tim', coalesce((select json_agg(public.tednas_drive_paket(x.id) order by x.created_at) from (
        select id, created_at from public.tednas_tim where drive_tersalin < drive_versi order by created_at limit v_batas) x), '[]'::json),
      'sisa', (select count(*) from public.tednas_tim where drive_tersalin < drive_versi),
      'hapus', coalesce((select json_agg(json_build_object('kode', kode, 'nama_tim', nama_tim) order by waktu)
        from public.tednas_drive_hapus), '[]'::json));
  elsif p_jenis = 'rapi' then
    return json_build_object(
      'tim', coalesce((select json_agg(public.tednas_drive_paket(x.id) order by x.created_at) from (
        select id, created_at from public.tednas_tim where drive_rapi = 0 and drive_tersalin > 0 order by created_at limit v_batas) x), '[]'::json),
      'sisa', (select count(*) from public.tednas_tim where drive_rapi = 0 and drive_tersalin > 0));
  end if;
  raise exception 'JENIS_SALAH';
end $$;

create or replace function public.tednas_drive_selesai(p_kunci text, p_jenis text, p_tim uuid, p_versi int, p_folder text default null)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not public.tednas_drive_kunci_sah(p_kunci) then raise exception 'KUNCI_SALAH'; end if;
  if p_jenis = 'sheet' then
    update public.tednas_tim set drive_tersalin = greatest(drive_tersalin, least(p_versi, drive_versi)), drive_pada = now()
      where id = p_tim;
  elsif p_jenis = 'rapi' then
    update public.tednas_tim set drive_rapi = greatest(coalesce(p_versi, 1), 1),
      drive_folder = coalesce(left(nullif(p_folder, ''), 300), drive_folder) where id = p_tim;
  else
    raise exception 'JENIS_SALAH';
  end if;
  return json_build_object('ok', true);
end $$;

create or replace function public.tednas_drive_hapus_selesai(p_kunci text, p_kode text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not public.tednas_drive_kunci_sah(p_kunci) then raise exception 'KUNCI_SALAH'; end if;
  delete from public.tednas_drive_hapus where kode = p_kode;
  return json_build_object('ok', true);
end $$;

-- Mana dari path ini yang dipakai pemain (berkas di folder Masuk yang tak dipakai = dibuang Apps Script).
create or replace function public.tednas_drive_dipakai(p_kunci text, p_paths text[])
returns text[] language plpgsql stable security definer set search_path = public as $$
begin
  if not public.tednas_drive_kunci_sah(p_kunci) then raise exception 'KUNCI_SALAH'; end if;
  return coalesce((select array_agg(x) from unnest(p_paths[1:500]) x where exists (
    select 1 from public.tednas_pemain p
    where x in (p.dokumen_path, p.profil_ml_path, p.follow_esports_path, p.follow_ppdt_path, p.izin_path))), '{}');
end $$;

-- Web App mendaftarkan alamatnya sendiri (dipanggil Apps Script setelah di-deploy).
create or replace function public.tednas_drive_setel_url(p_kunci text, p_url text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not public.tednas_drive_kunci_sah(p_kunci) then raise exception 'KUNCI_SALAH'; end if;
  if coalesce(p_url, '') !~ '^https://script\.google\.com/macros/s/[A-Za-z0-9_-]{20,200}/exec$' then raise exception 'URL_SALAH'; end if;
  update public.tednas_rahasia set drive_url = p_url where id = 1;
  update public.tednas_pengaturan set drive_url = p_url where id = 1;
  return json_build_object('ok', true);
end $$;

-- Fungsi bantu TIDAK boleh dipanggil lewat API (paket berisi nomor WA; kirim membawa rahasia).
revoke all on function public.tednas_berkas_sah(text, boolean) from public, anon, authenticated;
revoke all on function public.tednas_drive_paket(uuid) from public, anon, authenticated;
revoke all on function public.tednas_drive_kirim(jsonb) from public, anon, authenticated;
revoke all on function public.tednas_drive_kunci_sah(text) from public, anon, authenticated;
revoke all on function public.tednas_drive_kabar() from public, anon, authenticated;
revoke all on function public.tednas_drive_hapus_kabar() from public, anon, authenticated;
revoke all on function public.tednas_drive_pemain_ubah() from public, anon, authenticated;
-- Pintu Apps Script: terbuka untuk anon, dijaga drive_rahasia.
grant execute on function public.tednas_drive_antre(text, text, int) to anon, authenticated;
grant execute on function public.tednas_drive_selesai(text, text, uuid, int, text) to anon, authenticated;
grant execute on function public.tednas_drive_hapus_selesai(text, text) to anon, authenticated;
grant execute on function public.tednas_drive_dipakai(text, text[]) to anon, authenticated;
grant execute on function public.tednas_drive_setel_url(text, text) to anon, authenticated;
