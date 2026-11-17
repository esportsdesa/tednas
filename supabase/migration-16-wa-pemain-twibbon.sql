-- Migrasi 16 (18 Nov 2026, user): untuk PENDAFTAR SELANJUTNYA
--   * "minta juga nomor wa setiap player" → tednas_pemain.wa (pemain 2–6; pemain 1 = kapten memakai tednas_tim.wa_kapten,
--     kolom wa pemain 1 selalu kosong supaya tidak ada dua sumber nomor kapten);
--   * "wajib download dan post foto/video dengan twibbon ... di story atau feed dengan tag @esportsdesa.official",
--     CUKUP 1 PER TIM (jawaban user) → tednas_tim.twibbon_path (screenshot post twibbon);
--   * keputusan panitia 18 Nov: "semua identitas atau surat yang menunjukkan nama, tanggal lahir, dan alamat atau domisili
--     boleh digunakan" → jenis identitas ditambah KIA, SIM, Lainnya.
-- Tim lama tidak diwajibkan: tednas_tim.form_versi = 1 (lama) / 2 (daftar sejak migrasi ini). Wajib WA pemain + twibbon
-- hanya untuk form_versi 2; tim lama boleh mengisinya lewat halaman ubah data.
-- Sidik AI tim lama TIDAK berubah (tidak memicu pemeriksaan ulang 60+ tim); twibbon ikut sidik hanya bila ada / form v2.
-- Jalankan SETELAH migrasi 15. Aman dijalankan ulang. Bila migrasi 13 atau 15 dijalankan ulang, jalankan ulang migrasi ini
-- (keduanya menimpa tednas_daftar / tednas_ubah_tim versi lama).

alter table public.tednas_pemain add column if not exists wa text;
alter table public.tednas_pemain drop constraint if exists tednas_pemain_wa_cek;
alter table public.tednas_pemain add constraint tednas_pemain_wa_cek check (wa is null or wa ~ '^628[0-9]{7,12}$');
alter table public.tednas_tim add column if not exists twibbon_path text;
alter table public.tednas_tim add column if not exists form_versi smallint not null default 1;
create unique index if not exists tednas_tim_twibbon_unik on public.tednas_tim (twibbon_path) where twibbon_path is not null;

alter table public.tednas_pemain drop constraint if exists tednas_pemain_dokumen_jenis_check;
alter table public.tednas_pemain add constraint tednas_pemain_dokumen_jenis_check
  check (dokumen_jenis in ('KTP','KK','Suket RT/RW','Kartu Pelajar','KIA','SIM','Lainnya'));

create or replace function public.tednas_jenis_dok_sah(p text)
returns boolean language sql immutable as $$
  select coalesce(p, '') in ('KTP','KK','Suket RT/RW','Kartu Pelajar','KIA','SIM','Lainnya');
$$;

-- Nomor WA → 628…; null bila kosong; 'X' bila bentuknya salah (pemanggil melempar galatnya sendiri).
create or replace function public.tednas_wa_bersih(p text)
returns text language plpgsql immutable as $$
declare v text := regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g');
begin
  if v = '' then return null; end if;
  if v like '08%' then v := '62' || substr(v, 2); end if;
  if v like '8%' then v := '62' || v; end if;
  return case when v ~ '^628[0-9]{7,12}$' then v else 'X' end;
end $$;

/* ── pendaftaran ─────────────────────────────────────────────────────── */
drop function if exists public.tednas_daftar(text,text,text,text,text,text,text,text,text,jsonb,text,int);
create or replace function public.tednas_daftar(
  p_nama_tim text, p_wa text,
  p_prov_kode text, p_provinsi text, p_kab_kode text, p_kabupaten text,
  p_kecamatan text, p_desa_kode text, p_desa text,
  p_pemain jsonb, p_captcha text, p_komunitas int default null, p_twibbon text default null
) returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  v_wa text := public.tednas_wa_bersih(p_wa);
  v_kode text;
  v_secret text;
  v_jawab text;
  v_tim uuid;
  v_jumlah int := case when jsonb_typeof(p_pemain) = 'array' then jsonb_array_length(p_pemain) else 0 end;
  v_p jsonb;
  v_u int := 0;
  v_berkas text[] := '{}';
  v_bersih jsonb := '[]'::jsonb;
  v_dok text; v_ml text; v_ig1 text; v_ig2 text; v_izin text; v_wap text; v_tw text;
  v_komunitas int;
begin
  if not (select pendaftaran_buka from public.tednas_pengaturan where id = 1) then
    raise exception 'PENDAFTARAN_TUTUP';
  end if;
  if v_wa is null or v_wa = 'X' then raise exception 'WA_TIDAK_VALID'; end if;

  if coalesce(p_prov_kode,'') !~ '^[0-9]{2}$'
     or coalesce(p_kab_kode,'') !~ '^[0-9]{2}\.[0-9]{2}$'
     or coalesce(p_desa_kode,'') !~ '^[0-9]{2}\.[0-9]{2}\.[0-9]{2}\.[0-9]{4}$'
     or left(p_desa_kode, 5) <> p_kab_kode or left(p_kab_kode, 2) <> p_prov_kode then
    raise exception 'WILAYAH_TIDAK_VALID';
  end if;

  if v_jumlah not in (5, 6) then raise exception 'PEMAIN_TIDAK_LENGKAP'; end if;
  for v_p in select * from jsonb_array_elements(p_pemain) loop
    v_u := v_u + 1;
    if char_length(trim(coalesce(v_p->>'nama',''))) not between 2 and 80 then
      raise exception 'PEMAIN_TIDAK_LENGKAP';
    end if;
    if not public.tednas_jenis_dok_sah(v_p->>'dokumen_jenis') then raise exception 'DOKUMEN_TIDAK_ADA'; end if;
    -- Pemain 1 = kapten: nomornya p_wa. Pemain 2–6 wajib nomor WA sendiri.
    v_wap := null;
    if v_u > 1 then
      v_wap := public.tednas_wa_bersih(v_p->>'wa');
      if v_wap is null or v_wap = 'X' then raise exception 'WA_PEMAIN_TIDAK_VALID'; end if;
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
    v_bersih := v_bersih || jsonb_build_object('nama', trim(v_p->>'nama'), 'dokumen_jenis', v_p->>'dokumen_jenis', 'wa', v_wap,
      'dokumen_path', v_dok, 'profil_ml_path', v_ml, 'follow_esports_path', v_ig1, 'follow_ppdt_path', v_ig2, 'izin_path', v_izin);
  end loop;

  -- Bukti twibbon: satu screenshot per tim (post story/feed bertwibbon + tag @esportsdesa.official).
  v_tw := public.tednas_berkas_sah(p_twibbon, false);
  if v_tw is null then raise exception 'TWIBBON_TIDAK_ADA'; end if;
  v_berkas := v_berkas || v_tw;

  -- Satu berkas tidak boleh dipakai dua kali, baik di tim ini maupun tim lain.
  if (select count(distinct b) from unnest(v_berkas) b) <> cardinality(v_berkas)
     or exists (select 1 from public.tednas_pemain t
                where t.dokumen_path = any(v_berkas) or t.profil_ml_path = any(v_berkas) or t.izin_path = any(v_berkas)
                   or t.follow_esports_path = any(v_berkas) or t.follow_ppdt_path = any(v_berkas))
     or exists (select 1 from public.tednas_tim x where x.twibbon_path = any(v_berkas)) then
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

  -- Tautan komunitas (migrasi 13). Tanpa tautan, kode tak dikenal, atau komunitas nonaktif → komunitas bawaan (MZone Tour).
  select id into v_komunitas from public.tednas_komunitas where id = p_komunitas and aktif;
  if v_komunitas is null then
    select id into v_komunitas from public.tednas_komunitas where bawaan;
  end if;

  v_kode := 'TED-' || lpad(nextval('public.tednas_kode_seq')::text, 5, '0');
  insert into public.tednas_tim (kode, nama_tim, nama_kapten, wa_kapten, prov_kode, provinsi,
    kab_kode, kabupaten, kecamatan, desa_kode, desa, komunitas_id, twibbon_path, form_versi)
  values (v_kode, trim(p_nama_tim), v_bersih->0->>'nama', v_wa, p_prov_kode, left(p_provinsi,80),
    p_kab_kode, left(p_kabupaten,80), left(coalesce(p_kecamatan,''),80), p_desa_kode, left(p_desa,80), v_komunitas, v_tw, 2)
  returning id into v_tim;

  insert into public.tednas_pemain (tim_id, urutan, nama, dokumen_jenis, wa, dokumen_path, profil_ml_path,
    follow_esports_path, follow_ppdt_path, izin_path)
    select v_tim, u::int, e->>'nama', e->>'dokumen_jenis', nullif(e->>'wa',''), e->>'dokumen_path', e->>'profil_ml_path',
      e->>'follow_esports_path', e->>'follow_ppdt_path', nullif(e->>'izin_path','')
    from jsonb_array_elements(v_bersih) with ordinality as x(e, u);

  return json_build_object('kode', v_kode, 'komunitas', v_komunitas);
exception
  when unique_violation then
    if sqlerrm like '%wa_kapten%' then raise exception 'WA_SUDAH_ADA'; end if;
    if sqlerrm like '%_path_%' or sqlerrm like '%twibbon%' then raise exception 'DOKUMEN_TIDAK_ADA'; end if;
    raise;
end;
$$;
revoke all on function public.tednas_daftar(text,text,text,text,text,text,text,text,text,jsonb,text,int,text) from public;
grant execute on function public.tednas_daftar(text,text,text,text,text,text,text,text,text,jsonb,text,int,text) to anon, authenticated;

/* ── paket Drive / agen AI ───────────────────────────────────────────── */
-- Tambahan: twibbon_path, form_versi, wa per pemain (pemain 1 = wa_kapten). Apps Script lama mengabaikan isian baru.
create or replace function public.tednas_drive_paket(p_tim uuid)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'id', t.id, 'kode', t.kode, 'nama_tim', t.nama_tim, 'nama_kapten', t.nama_kapten, 'wa_kapten', t.wa_kapten,
    'prov_kode', t.prov_kode, 'provinsi', t.provinsi, 'kab_kode', t.kab_kode, 'kabupaten', t.kabupaten,
    'kecamatan', t.kecamatan, 'desa_kode', t.desa_kode, 'desa', t.desa, 'status', t.status, 'created_at', t.created_at,
    'versi', t.drive_versi, 'rapi', t.drive_rapi, 'folder', t.drive_folder,
    'twibbon_path', t.twibbon_path, 'form_versi', t.form_versi,
    'pemain', coalesce((
      select json_agg(json_build_object('urutan', p.urutan, 'nama', p.nama, 'dokumen_jenis', p.dokumen_jenis,
        'wa', case when p.urutan = 1 then t.wa_kapten else p.wa end,
        'dokumen_path', p.dokumen_path, 'profil_ml_path', p.profil_ml_path, 'follow_esports_path', p.follow_esports_path,
        'follow_ppdt_path', p.follow_ppdt_path, 'izin_path', p.izin_path) order by p.urutan)
      from public.tednas_pemain p where p.tim_id = t.id), '[]'::json))
  from public.tednas_tim t where t.id = p_tim;
$$;

-- Sidik lama + akhiran hanya untuk tim yang punya twibbon / form v2 ⇒ sidik tim lama tetap, tidak ada pemeriksaan ulang massal.
create or replace function public.tednas_ai_sidik(p_tim uuid)
returns text language sql stable security definer set search_path = public as $$
  select md5(json_build_array(t.nama_tim, t.prov_kode, t.kab_kode, t.kabupaten, t.kecamatan, t.desa_kode, t.desa,
    (select json_agg(json_build_array(p.urutan, p.nama, p.dokumen_jenis, p.dokumen_path, p.profil_ml_path,
       p.follow_esports_path, p.follow_ppdt_path, p.izin_path) order by p.urutan)
     from public.tednas_pemain p where p.tim_id = t.id))::text
    || case when t.twibbon_path is not null or t.form_versi >= 2 then '|tw:' || coalesce(t.twibbon_path, '') || '|v' || t.form_versi else '' end)
  from public.tednas_tim t where t.id = p_tim;
$$;

-- Versi Drive naik juga bila twibbon berganti.
create or replace function public.tednas_drive_versi()
returns trigger language plpgsql as $$
begin
  if (new.kode, new.nama_tim, new.nama_kapten, new.wa_kapten, new.prov_kode, new.provinsi, new.kab_kode,
      new.kabupaten, new.kecamatan, new.desa_kode, new.desa, new.status, new.twibbon_path)
     is distinct from
     (old.kode, old.nama_tim, old.nama_kapten, old.wa_kapten, old.prov_kode, old.provinsi, old.kab_kode,
      old.kabupaten, old.kecamatan, old.desa_kode, old.desa, old.status, old.twibbon_path) then
    new.drive_versi := old.drive_versi + 1;
  end if;
  return new;
end $$;

/* ── halaman ubah data ───────────────────────────────────────────────── */
create or replace function public.tednas_ubah_lihat(p_kode text, p_token text)
returns json language plpgsql stable security definer set search_path = public as $$
declare v_tim uuid := public.tednas_perbaiki_tim(p_kode, p_token);
begin
  return (select (public.tednas_perbaiki_lihat(p_kode, p_token)::jsonb || jsonb_build_object(
      'wa_kapten', t.wa_kapten, 'prov_kode', t.prov_kode, 'kab_kode', t.kab_kode, 'kecamatan', t.kecamatan, 'desa_kode', t.desa_kode,
      'form_versi', t.form_versi, 'ada_twibbon', t.twibbon_path is not null,
      'pemain', (select jsonb_agg(jsonb_build_object('urutan', p.urutan, 'nama', p.nama, 'dokumen_jenis', p.dokumen_jenis,
                   'ada_izin', p.izin_path is not null, 'wa', case when p.urutan = 1 then t.wa_kapten else p.wa end) order by p.urutan)
                 from public.tednas_pemain p where p.tim_id = t.id)))::json
    from public.tednas_tim t where t.id = v_tim);
end $$;

-- = migrasi 15 + wa pemain (pemain 2–6; wajib untuk tim form v2, tidak bisa dikosongkan), twibbon_path tim, jenis
--   identitas baru. Pemain 1 tetap memakai nomor WA kapten (p_tim.wa).
create or replace function public.tednas_ubah_tim(p_kode text, p_token text, p_pemain jsonb, p_tim jsonb default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  v_tim uuid := public.tednas_perbaiki_tim(p_kode, p_token);
  v_t jsonb := coalesce(p_tim, '{}'::jsonb);
  v_p jsonb; v_u int; v_kolom text; v_path text; v_nama text; v_wa text; v_wap text;
  v_baru text[] := '{}';
  v_ubah int := 0; v_baris int := 0;
  v_dok text; v_ml text; v_ig1 text; v_ig2 text; v_izin text;
  v_versi smallint;
  v_pesan constant jsonb := '{"dokumen_path":"DOKUMEN_TIDAK_ADA","profil_ml_path":"PROFIL_ML_TIDAK_ADA",
    "follow_esports_path":"FOLLOW_TIDAK_ADA","follow_ppdt_path":"FOLLOW_TIDAK_ADA","izin_path":"IZIN_TIDAK_ADA"}';
begin
  select form_versi into v_versi from public.tednas_tim where id = v_tim for update;
  if p_pemain is null then p_pemain := '[]'::jsonb; end if;
  if jsonb_typeof(p_pemain) is distinct from 'array' or jsonb_array_length(p_pemain) > 6
     or jsonb_typeof(v_t) is distinct from 'object' or (jsonb_array_length(p_pemain) = 0 and v_t = '{}'::jsonb) then
    raise exception 'ISIAN_TIDAK_SAH';
  end if;

  -- ── data tim ──
  if v_t ? 'nama_tim' then
    v_nama := trim(coalesce(v_t->>'nama_tim', ''));
    if char_length(v_nama) not between 2 and 60 then raise exception 'NAMA_TIM_TIDAK_VALID'; end if;
    update public.tednas_tim set nama_tim = v_nama where id = v_tim and nama_tim is distinct from v_nama;
    v_ubah := v_ubah + (case when found then 1 else 0 end);
  end if;
  if v_t ? 'wa' then
    v_wa := public.tednas_wa_bersih(v_t->>'wa');
    if v_wa is null or v_wa = 'X' then raise exception 'WA_TIDAK_VALID'; end if;
    if exists (select 1 from public.tednas_tim where wa_kapten = v_wa and id <> v_tim) then raise exception 'WA_SUDAH_ADA'; end if;
    update public.tednas_tim set wa_kapten = v_wa where id = v_tim and wa_kapten is distinct from v_wa;
    v_ubah := v_ubah + (case when found then 1 else 0 end);
  end if;
  if v_t ? 'desa_kode' then
    if coalesce(v_t->>'prov_kode', '') !~ '^[0-9]{2}$' or coalesce(v_t->>'kab_kode', '') !~ '^[0-9]{2}\.[0-9]{2}$'
       or coalesce(v_t->>'desa_kode', '') !~ '^[0-9]{2}\.[0-9]{2}\.[0-9]{2}\.[0-9]{4}$'
       or left(v_t->>'desa_kode', 5) <> v_t->>'kab_kode' or left(v_t->>'kab_kode', 2) <> v_t->>'prov_kode'
       or char_length(trim(coalesce(v_t->>'provinsi', ''))) < 2 or char_length(trim(coalesce(v_t->>'kabupaten', ''))) < 2
       or char_length(trim(coalesce(v_t->>'kecamatan', ''))) < 2 or char_length(trim(coalesce(v_t->>'desa', ''))) < 2 then
      raise exception 'WILAYAH_TIDAK_VALID';
    end if;
    update public.tednas_tim set prov_kode = v_t->>'prov_kode', provinsi = trim(v_t->>'provinsi'), kab_kode = v_t->>'kab_kode',
        kabupaten = trim(v_t->>'kabupaten'), kecamatan = trim(v_t->>'kecamatan'), desa_kode = v_t->>'desa_kode', desa = trim(v_t->>'desa')
      where id = v_tim and (prov_kode, kab_kode, kecamatan, desa_kode, desa) is distinct from
        (v_t->>'prov_kode', v_t->>'kab_kode', trim(v_t->>'kecamatan'), v_t->>'desa_kode', trim(v_t->>'desa'));
    v_ubah := v_ubah + (case when found then 1 else 0 end);
  end if;
  if nullif(v_t->>'twibbon_path', '') is not null then
    v_path := public.tednas_berkas_sah(v_t->>'twibbon_path', false);
    if v_path is null or v_path !~ '^gdrive/' then raise exception 'TWIBBON_TIDAK_ADA'; end if;
    v_baru := v_baru || v_path;
    update public.tednas_tim set twibbon_path = v_path where id = v_tim and twibbon_path is distinct from v_path;
    v_ubah := v_ubah + (case when found then 1 else 0 end);
  end if;

  -- ── pemain ──
  for v_p in select * from jsonb_array_elements(p_pemain) loop
    v_u := case when coalesce(v_p->>'urutan', '') ~ '^[1-6]$' then (v_p->>'urutan')::int end;
    if v_u is null then raise exception 'PEMAIN_TIDAK_ADA'; end if;

    if coalesce((v_p->>'hapus')::boolean, false) then
      if v_u <> 6 then raise exception 'HANYA_CADANGAN'; end if;
      delete from public.tednas_pemain where tim_id = v_tim and urutan = 6;
      if not found then raise exception 'PEMAIN_TIDAK_ADA'; end if;
      v_ubah := v_ubah + 1; v_baris := v_baris + 1;
      continue;
    end if;

    if coalesce((v_p->>'baru')::boolean, false) then
      if v_u <> 6 then raise exception 'HANYA_CADANGAN'; end if;
      if exists (select 1 from public.tednas_pemain where tim_id = v_tim and urutan = 6) then raise exception 'CADANGAN_SUDAH_ADA'; end if;
      v_nama := trim(coalesce(v_p->>'nama', ''));
      if char_length(v_nama) not between 2 and 80 then raise exception 'PEMAIN_TIDAK_LENGKAP'; end if;
      if not public.tednas_jenis_dok_sah(v_p->>'dokumen_jenis') then raise exception 'DOKUMEN_TIDAK_ADA'; end if;
      v_wap := public.tednas_wa_bersih(v_p->>'wa');
      if v_wap = 'X' or (v_wap is null and v_versi >= 2) then raise exception 'WA_PEMAIN_TIDAK_VALID'; end if;
      v_dok := public.tednas_berkas_sah(v_p->>'dokumen_path', true);
      if v_dok is null or v_dok !~ '^gdrive/' then raise exception 'DOKUMEN_TIDAK_ADA'; end if;
      v_ml := public.tednas_berkas_sah(v_p->>'profil_ml_path', false);
      if v_ml is null or v_ml !~ '^gdrive/' then raise exception 'PROFIL_ML_TIDAK_ADA'; end if;
      v_ig1 := public.tednas_berkas_sah(v_p->>'follow_esports_path', false);
      v_ig2 := public.tednas_berkas_sah(v_p->>'follow_ppdt_path', false);
      if v_ig1 is null or v_ig2 is null or v_ig1 !~ '^gdrive/' or v_ig2 !~ '^gdrive/' then raise exception 'FOLLOW_TIDAK_ADA'; end if;
      v_izin := null;
      if nullif(v_p->>'izin_path', '') is not null then
        v_izin := public.tednas_berkas_sah(v_p->>'izin_path', true);
        if v_izin is null or v_izin !~ '^gdrive/' then raise exception 'IZIN_TIDAK_ADA'; end if;
      end if;
      insert into public.tednas_pemain (tim_id, urutan, nama, dokumen_jenis, wa, dokumen_path, profil_ml_path, follow_esports_path, follow_ppdt_path, izin_path)
        values (v_tim, 6, v_nama, v_p->>'dokumen_jenis', v_wap, v_dok, v_ml, v_ig1, v_ig2, v_izin);
      v_baru := v_baru || v_dok || v_ml || v_ig1 || v_ig2;
      if v_izin is not null then v_baru := v_baru || v_izin; end if;
      v_ubah := v_ubah + 1; v_baris := v_baris + 1;
      continue;
    end if;

    if not exists (select 1 from public.tednas_pemain where tim_id = v_tim and urutan = v_u) then raise exception 'PEMAIN_TIDAK_ADA'; end if;
    if v_p ? 'nama' then
      v_nama := trim(coalesce(v_p->>'nama', ''));
      if char_length(v_nama) not between 2 and 80 then raise exception 'PEMAIN_TIDAK_LENGKAP'; end if;
      update public.tednas_pemain set nama = v_nama where tim_id = v_tim and urutan = v_u and nama is distinct from v_nama;
      v_ubah := v_ubah + (case when found then 1 else 0 end);
      if v_u = 1 then update public.tednas_tim set nama_kapten = v_nama where id = v_tim and nama_kapten is distinct from v_nama; end if;
    end if;
    -- Nomor WA pemain 2–6 (pemain 1 = nomor kapten di data tim; isian wa pemain 1 diabaikan).
    if v_p ? 'wa' and v_u > 1 then
      v_wap := public.tednas_wa_bersih(v_p->>'wa');
      if v_wap = 'X' or (v_wap is null and v_versi >= 2) then raise exception 'WA_PEMAIN_TIDAK_VALID'; end if;
      update public.tednas_pemain set wa = v_wap where tim_id = v_tim and urutan = v_u and wa is distinct from v_wap;
      v_ubah := v_ubah + (case when found then 1 else 0 end);
    end if;
    if v_p ? 'dokumen_jenis' then
      if not public.tednas_jenis_dok_sah(v_p->>'dokumen_jenis') then raise exception 'DOKUMEN_TIDAK_ADA'; end if;
      update public.tednas_pemain set dokumen_jenis = v_p->>'dokumen_jenis'
        where tim_id = v_tim and urutan = v_u and dokumen_jenis is distinct from v_p->>'dokumen_jenis';
      v_ubah := v_ubah + (case when found then 1 else 0 end);
    end if;
    foreach v_kolom in array array['dokumen_path','profil_ml_path','follow_esports_path','follow_ppdt_path','izin_path'] loop
      continue when nullif(v_p->>v_kolom, '') is null;
      v_path := public.tednas_berkas_sah(v_p->>v_kolom, v_kolom in ('dokumen_path','izin_path'));
      if v_path is null or v_path !~ '^gdrive/' then raise exception '%', v_pesan->>v_kolom; end if;
      v_baru := v_baru || v_path;
      execute format('update public.tednas_pemain set %I = $1 where tim_id = $2 and urutan = $3', v_kolom) using v_path, v_tim, v_u;
      v_ubah := v_ubah + 1;
    end loop;
  end loop;

  -- Satu berkas hanya boleh dipakai sekali di seluruh pendaftaran (berkas pemain + bukti twibbon tim).
  if exists (select 1 from unnest(v_baru) b
             where (select count(*) from public.tednas_pemain x
                    cross join lateral (values (x.dokumen_path), (x.profil_ml_path), (x.follow_esports_path),
                                               (x.follow_ppdt_path), (x.izin_path)) v(p)
                    where v.p = b)
                 + (select count(*) from public.tednas_tim x where x.twibbon_path = b) > 1) then
    raise exception 'DOKUMEN_TIDAK_ADA';
  end if;

  if v_ubah > 0 then
    -- Pemicu Drive hanya menangkap UPDATE pemain: tambah/hapus cadangan menaikkan versi sendiri supaya Sheet ikut berubah.
    update public.tednas_tim set perbaiki_pada = now(), drive_rapi = 0, drive_versi = drive_versi + (case when v_baris > 0 then 1 else 0 end)
      where id = v_tim;
  end if;
  return json_build_object('ok', true, 'diubah', v_ubah);
exception
  when unique_violation then raise exception 'DOKUMEN_TIDAK_ADA';
  when check_violation then
    if sqlerrm like '%wa_cek%' then raise exception 'WA_PEMAIN_TIDAK_VALID'; end if;
    if sqlerrm like '%dokumen_jenis%' then raise exception 'DOKUMEN_TIDAK_ADA'; end if;
    raise exception 'WILAYAH_TIDAK_VALID';
end $$;

revoke all on function public.tednas_jenis_dok_sah(text) from public;
revoke all on function public.tednas_wa_bersih(text) from public;
grant execute on function public.tednas_jenis_dok_sah(text) to anon, authenticated;
grant execute on function public.tednas_wa_bersih(text) to anon, authenticated;
