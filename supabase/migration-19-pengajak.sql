-- Migrasi 19 (21 Nov 2026): program PESERTA AJAK PESERTA — kode tim pengajak + papan peringkat di MZone.
-- User: "buatin leaderboard aja. trus referalnya ngga usah di create masing2, tapi pakae aja kode timnya yang ted ted itu".
--  * Pendaftar boleh mengisi kode tim (TED-xxxxx) yang mengajaknya; esportsdesa.id/r/<kode> mengisinya otomatis.
--  * Poin = jumlah tim yang menyebut kode itu dan sudah TERVERIFIKASI. Papan peringkatnya di MZone (arahan user 17 Nov:
--    papan skor hanya di MZone), dibaca lewat RPC berkunci tednas_mzone_pengajak (kunci jalur mzone, migrasi 14).
--  * Sidik AI tidak berubah (tednas_ai_sidik memakai kolom tertentu saja), jadi tim lama tidak diperiksa ulang.
-- Aman dijalankan ulang.

alter table public.tednas_tim add column if not exists pengajak_id uuid references public.tednas_tim(id) on delete set null;
create index if not exists tednas_tim_pengajak_idx on public.tednas_tim (pengajak_id) where pengajak_id is not null;
do $$ begin
  alter table public.tednas_tim add constraint tednas_tim_pengajak_bukan_diri check (pengajak_id is distinct from id);
exception when duplicate_object then null; end $$;

-- tednas_daftar: parameter ke-14 p_pengajak (versi 13 parameter dihapus supaya PostgREST tidak bingung memilih).
drop function if exists public.tednas_daftar(text,text,text,text,text,text,text,text,text,jsonb,text,int,text);
create or replace function public.tednas_daftar(
  p_nama_tim text, p_wa text,
  p_prov_kode text, p_provinsi text, p_kab_kode text, p_kabupaten text,
  p_kecamatan text, p_desa_kode text, p_desa text,
  p_pemain jsonb, p_captcha text, p_komunitas int default null, p_twibbon text default null,
  p_pengajak text default null
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
  v_pengajak uuid;
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

  -- Kode tim pengajak (migrasi 19): kode TED-xxxxx tim yang sudah terdaftar; kosong = tanpa pengajak. Dicek sebelum
  -- captcha supaya token captcha tidak terbuang bila kodenya salah ketik.
  if nullif(trim(coalesce(p_pengajak, '')), '') is not null then
    select id into v_pengajak from public.tednas_tim where kode = upper(trim(p_pengajak));
    if v_pengajak is null then raise exception 'PENGAJAK_TIDAK_ADA'; end if;
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
    kab_kode, kabupaten, kecamatan, desa_kode, desa, komunitas_id, twibbon_path, form_versi, pengajak_id)
  values (v_kode, trim(p_nama_tim), v_bersih->0->>'nama', v_wa, p_prov_kode, left(p_provinsi,80),
    p_kab_kode, left(p_kabupaten,80), left(coalesce(p_kecamatan,''),80), p_desa_kode, left(p_desa,80), v_komunitas, v_tw, 2, v_pengajak)
  returning id into v_tim;

  insert into public.tednas_pemain (tim_id, urutan, nama, dokumen_jenis, wa, dokumen_path, profil_ml_path,
    follow_esports_path, follow_ppdt_path, izin_path)
    select v_tim, u::int, e->>'nama', e->>'dokumen_jenis', nullif(e->>'wa',''), e->>'dokumen_path', e->>'profil_ml_path',
      e->>'follow_esports_path', e->>'follow_ppdt_path', nullif(e->>'izin_path','')
    from jsonb_array_elements(v_bersih) with ordinality as x(e, u);

  return json_build_object('kode', v_kode, 'komunitas', v_komunitas,
    'pengajak', (select kode from public.tednas_tim where id = v_pengajak));
exception
  when unique_violation then
    if sqlerrm like '%wa_kapten%' then raise exception 'WA_SUDAH_ADA'; end if;
    if sqlerrm like '%_path_%' or sqlerrm like '%twibbon%' then raise exception 'DOKUMEN_TIDAK_ADA'; end if;
    raise;
end;
$$;
revoke all on function public.tednas_daftar(text,text,text,text,text,text,text,text,text,jsonb,text,int,text,text) from public;
grant execute on function public.tednas_daftar(text,text,text,text,text,text,text,text,text,jsonb,text,int,text,text) to anon, authenticated;

-- Papan peringkat untuk MZone: tim yang punya minimal satu tim rujukan. Urut: terverifikasi terbanyak, lalu yang lebih
-- dulu mencapainya (waktu daftar tim rujukan terverifikasi terakhir), lalu kode. Tanpa data pribadi (tanpa nomor WA/nama
-- pemain). Nomor peringkat dibuat MZone.
create or replace function public.tednas_mzone_pengajak(p_kunci text)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.tednas_kunci_jalur_sah('mzone', p_kunci) then raise exception 'KUNCI_SALAH'; end if;
  return coalesce((select json_agg(json_build_object('kode', x.kode, 'nama_tim', x.nama_tim, 'desa', x.desa, 'kabupaten', x.kabupaten,
        'provinsi', x.provinsi, 'status', x.status, 'terverifikasi', x.terverifikasi, 'menunggu', x.menunggu, 'terakhir', x.terakhir)
      order by x.terverifikasi desc, x.terakhir nulls last, x.kode)
    from (select p.kode, p.nama_tim, p.desa, p.kabupaten, p.provinsi, p.status,
            count(*) filter (where t.status = 'terverifikasi') as terverifikasi,
            count(*) filter (where t.status <> 'terverifikasi') as menunggu,
            max(t.created_at) filter (where t.status = 'terverifikasi') as terakhir
          from public.tednas_tim t join public.tednas_tim p on p.id = t.pengajak_id
          group by p.id) x), '[]'::json);
end $$;
revoke all on function public.tednas_mzone_pengajak(text) from public;
grant execute on function public.tednas_mzone_pengajak(text) to anon, authenticated;
