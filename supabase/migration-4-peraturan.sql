-- Menyesuaikan peraturan resmi: satu desa boleh lebih dari satu tim, KK sebagai identitas,
-- dan surat izin orang tua/wali untuk pemain di bawah 17 tahun.
alter table public.tednas_tim drop constraint if exists tednas_tim_desa_kode_key;
alter table public.tednas_pemain add column if not exists izin_path text unique;
alter table public.tednas_pemain drop constraint if exists tednas_pemain_dokumen_jenis_check;
alter table public.tednas_pemain add constraint tednas_pemain_dokumen_jenis_check
  check (dokumen_jenis in ('KTP','KK','Suket RT/RW','Kartu Pelajar'));

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
    if nullif(v_p->>'izin_path','') is not null
       and (v_p->>'izin_path' !~ '^dokumen/[^/]+\.(pdf|jpg|png)$'
            or not exists (select 1 from storage.objects
                           where bucket_id = 'tednas-dokumen' and name = v_p->>'izin_path')) then
      raise exception 'IZIN_TIDAK_ADA';
    end if;
    v_berkas := v_berkas || (v_p->>'dokumen_path') || (v_p->>'profil_ml_path');
    if nullif(v_p->>'izin_path','') is not null then v_berkas := v_berkas || (v_p->>'izin_path'); end if;
  end loop;

  -- Satu berkas tidak boleh dipakai dua kali, baik di tim ini maupun tim lain.
  if (select count(distinct b) from unnest(v_berkas) b) <> cardinality(v_berkas)
     or exists (select 1 from public.tednas_pemain t
                where t.dokumen_path = any(v_berkas) or t.profil_ml_path = any(v_berkas) or t.izin_path = any(v_berkas)) then
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

  insert into public.tednas_pemain (tim_id, urutan, nama, dokumen_jenis, dokumen_path, profil_ml_path, izin_path)
    select v_tim, u::int, trim(e->>'nama'), e->>'dokumen_jenis', e->>'dokumen_path', e->>'profil_ml_path', nullif(e->>'izin_path','')
    from jsonb_array_elements(p_pemain) with ordinality as x(e, u);

  return json_build_object('kode', v_kode);
exception
  when unique_violation then
    if sqlerrm like '%wa_kapten%' then raise exception 'WA_SUDAH_ADA'; end if;
    if sqlerrm like '%_path_%' then raise exception 'DOKUMEN_TIDAK_ADA'; end if;
    raise;
end;
$$;
