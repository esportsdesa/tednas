-- Migrasi 12: KAPTEN MEMPERBAIKI BERKAS SENDIRI (permintaan 17 Nov 2026: "admin tinggal melakukan 1 klik").
-- Jalankan SETELAH migration-10-ai-periksa.sql. Aman dijalankan ulang.
--
--  * Admin menekan "WA Kapten" → tednas_kabari_kapten() memberi token tautan perbaikan tim itu (dan mencatat waktunya),
--    lalu WhatsApp admin terbuka dengan pesan siap kirim: catatan AI per pemain + tautan perbaiki.html#<kode>.<token>.
--  * Kapten membuka tautan → tednas_perbaiki_lihat() → mengganti nama pemain, jenis identitas, atau berkas →
--    tednas_perbaiki_simpan(). Berkas baru diunggah ke Web App Drive utama seperti saat mendaftar (path bertanda).
--  * Perubahan mengubah sidik AI → agen memeriksa ulang otomatis; lolos semua = langsung Terverifikasi
--    (aturan migrasi 10). Sheet & Drive cermin ikut diperbarui lewat drive_versi; drive_rapi = 0 supaya berkas baru
--    dipindah ke folder tim.
--  * Token = HMAC(id tim) dengan perbaiki_rahasia: tidak disimpan, tidak bisa ditebak dari kode tim. Hanya tim yang
--    masih Menunggu yang bisa diubah; yang sudah Terverifikasi terkunci.

alter table public.tednas_rahasia add column if not exists perbaiki_rahasia text not null
  default encode(extensions.gen_random_bytes(32), 'hex');
alter table public.tednas_tim add column if not exists kapten_dikabari timestamptz;  -- terakhir admin menekan "WA Kapten"
alter table public.tednas_tim add column if not exists perbaiki_pada timestamptz;    -- terakhir kapten menyimpan perbaikan

create or replace function public.tednas_perbaiki_token(p_tim uuid)
returns text language sql stable security definer set search_path = public, extensions as $$
  select left(encode(extensions.hmac('perbaiki:' || p_tim::text, r.perbaiki_rahasia, 'sha256'), 'hex'), 40)
  from public.tednas_rahasia r where r.id = 1;
$$;

-- kode + token → id tim; selain itu TAUTAN_TIDAK_SAH (pesan sama untuk kode salah dan token salah).
create or replace function public.tednas_perbaiki_tim(p_kode text, p_token text)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v_tim uuid;
begin
  select id into v_tim from public.tednas_tim where kode = upper(trim(coalesce(p_kode, '')));
  if v_tim is null or coalesce(p_token, '') !~ '^[0-9a-f]{40}$' or public.tednas_perbaiki_token(v_tim) is distinct from p_token then
    raise exception 'TAUTAN_TIDAK_SAH';
  end if;
  return v_tim;
end $$;

-- ========== ADMIN ==========
create or replace function public.tednas_kabari_kapten(p_tim uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v_pada timestamptz := now();
begin
  if not public.tednas_is_admin() then raise exception 'BUKAN_ADMIN'; end if;
  update public.tednas_tim set kapten_dikabari = v_pada where id = p_tim;
  if not found then raise exception 'TIM_TIDAK_ADA'; end if;
  return json_build_object('token', public.tednas_perbaiki_token(p_tim), 'pada', v_pada);
end $$;

-- ========== KAPTEN (lewat tautan) ==========
-- Hanya yang dibutuhkan halaman perbaikan: tanpa nomor WA, path berkas, NIK, atau alamat hasil bacaan AI.
-- Catatan AI hanya yang "cek"; ganda hanya yang membuat tim ini "cek", tanpa kode tim lain.
create or replace function public.tednas_perbaiki_lihat(p_kode text, p_token text)
returns json language plpgsql stable security definer set search_path = public as $$
declare v_tim uuid := public.tednas_perbaiki_tim(p_kode, p_token);
begin
  return (
    select json_build_object(
      'kode', t.kode, 'nama_tim', t.nama_tim, 'nama_kapten', t.nama_kapten, 'desa', t.desa, 'kabupaten', t.kabupaten,
      'provinsi', t.provinsi, 'status', t.status, 'perbaiki_pada', t.perbaiki_pada,
      'pemain', (select json_agg(json_build_object('urutan', p.urutan, 'nama', p.nama, 'dokumen_jenis', p.dokumen_jenis,
                   'ada_izin', p.izin_path is not null) order by p.urutan)
                 from public.tednas_pemain p where p.tim_id = t.id),
      'ai', case when a.tim_id is null then null else json_build_object(
        'akhir', a.akhir, 'pada', a.pada, 'segar', a.sidik = public.tednas_ai_sidik(t.id),
        'tim', coalesce((select json_agg(json_build_object('b', b->>'b', 't', b->>'t'))
                         from jsonb_array_elements(coalesce(a.rincian->'tim', '[]'::jsonb)) b where b->>'s' = 'cek'), '[]'::json),
        'pemain', coalesce((select json_agg(json_build_object('u', (p->>'u')::int,
                     'butir', (select coalesce(json_agg(json_build_object('b', b->>'b', 't', b->>'t')), '[]'::json)
                               from jsonb_array_elements(coalesce(p->'butir', '[]'::jsonb)) b where b->>'s' = 'cek')))
                   from jsonb_array_elements(coalesce(a.rincian->'pemain', '[]'::jsonb)) p), '[]'::json),
        'ganda', coalesce((select json_agg(json_build_object('u', (g->>'u')::int, 'jenis', g->>'jenis',
                     'u_lain', case when g->>'kode' = t.kode then (g->>'u_lain')::int end))
                   from jsonb_array_elements(a.ganda) g where (g->>'dulu')::boolean), '[]'::json)) end)
    from public.tednas_tim t left join public.tednas_ai a on a.tim_id = t.id
    where t.id = v_tim);
end $$;

-- p_pemain: [{urutan, nama?, dokumen_jenis?, dokumen_path?, profil_ml_path?, follow_esports_path?, follow_ppdt_path?,
--             izin_path?}] — hanya isian yang dikirim yang diubah. Path berkas wajib bertanda Web App Drive.
create or replace function public.tednas_perbaiki_simpan(p_kode text, p_token text, p_pemain jsonb)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  v_tim uuid := public.tednas_perbaiki_tim(p_kode, p_token);
  v_status text;
  v_p jsonb; v_u int; v_kolom text; v_path text; v_nama text;
  v_baru text[] := '{}';
  v_ubah int := 0;
  v_pesan constant jsonb := '{"dokumen_path":"DOKUMEN_TIDAK_ADA","profil_ml_path":"PROFIL_ML_TIDAK_ADA",
    "follow_esports_path":"FOLLOW_TIDAK_ADA","follow_ppdt_path":"FOLLOW_TIDAK_ADA","izin_path":"IZIN_TIDAK_ADA"}';
begin
  select status into v_status from public.tednas_tim where id = v_tim for update;
  if v_status <> 'menunggu' then raise exception 'SUDAH_TERVERIFIKASI'; end if;
  if jsonb_typeof(p_pemain) is distinct from 'array' or jsonb_array_length(p_pemain) not between 1 and 6 then
    raise exception 'ISIAN_TIDAK_SAH';
  end if;

  for v_p in select * from jsonb_array_elements(p_pemain) loop
    v_u := case when coalesce(v_p->>'urutan', '') ~ '^[1-6]$' then (v_p->>'urutan')::int end;
    if v_u is null or not exists (select 1 from public.tednas_pemain where tim_id = v_tim and urutan = v_u) then
      raise exception 'PEMAIN_TIDAK_ADA';
    end if;
    if v_p ? 'nama' then
      v_nama := trim(coalesce(v_p->>'nama', ''));
      if char_length(v_nama) not between 2 and 80 then raise exception 'PEMAIN_TIDAK_LENGKAP'; end if;
      update public.tednas_pemain set nama = v_nama where tim_id = v_tim and urutan = v_u and nama is distinct from v_nama;
      v_ubah := v_ubah + (case when found then 1 else 0 end);
      if v_u = 1 then update public.tednas_tim set nama_kapten = v_nama where id = v_tim and nama_kapten is distinct from v_nama; end if;
    end if;
    if v_p ? 'dokumen_jenis' then
      if coalesce(v_p->>'dokumen_jenis', '') not in ('KTP','KK','Suket RT/RW','Kartu Pelajar') then raise exception 'DOKUMEN_TIDAK_ADA'; end if;
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

  -- Satu berkas hanya boleh dipakai sekali di seluruh pendaftaran (sama dengan tednas_daftar).
  if exists (select 1 from unnest(v_baru) b
             where (select count(*) from public.tednas_pemain x
                    cross join lateral (values (x.dokumen_path), (x.profil_ml_path), (x.follow_esports_path),
                                               (x.follow_ppdt_path), (x.izin_path)) v(p)
                    where v.p = b) > 1) then
    raise exception 'DOKUMEN_TIDAK_ADA';
  end if;

  if v_ubah > 0 then
    update public.tednas_tim set perbaiki_pada = now(), drive_rapi = 0 where id = v_tim;
  end if;
  return json_build_object('ok', true, 'diubah', v_ubah);
exception
  when unique_violation then raise exception 'DOKUMEN_TIDAK_ADA';
end $$;

revoke all on function public.tednas_perbaiki_token(uuid) from public, anon, authenticated;
revoke all on function public.tednas_perbaiki_tim(text, text) from public, anon, authenticated;
revoke all on function public.tednas_kabari_kapten(uuid) from public, anon;
revoke all on function public.tednas_perbaiki_lihat(text, text) from public;
revoke all on function public.tednas_perbaiki_simpan(text, text, jsonb) from public;
grant execute on function public.tednas_kabari_kapten(uuid) to authenticated;   -- dijaga tednas_is_admin
grant execute on function public.tednas_perbaiki_lihat(text, text) to anon, authenticated;   -- dijaga token
grant execute on function public.tednas_perbaiki_simpan(text, text, jsonb) to anon, authenticated;
