-- Migrasi 15: SEMUA DATA TIM BISA DIUBAH (permintaan 18 Nov 2026: "gapapa dong biarin aja semua data bisa diedit").
-- Jalankan SETELAH migration-12-perbaiki.sql. Aman dijalankan ulang. Fungsi migrasi 12 TIDAK diganti tanda tangannya
-- (supaya menjalankan ulang migrasi 12 tidak membuat dua fungsi yang bentrok); yang baru ditambahkan di samping:
--
--  * tednas_ubah_lihat(kode, token)  = tednas_perbaiki_lihat + nomor WA kapten & kode wilayah (tautan sudah pribadi:
--    HMAC per tim, dikirim ke WA kapten itu sendiri).
--  * tednas_ubah_tim(kode, token, p_pemain, p_tim) — kapten (atau admin lewat tautan yang sama) mengubah:
--      - tim: nama tim, nomor WA kapten, desa (provinsi/kabupaten/kecamatan/desa, aturan sama dengan pendaftaran);
--      - pemain 1–6: nama, jenis identitas, berkas (seperti migrasi 12);
--      - cadangan: {"urutan":6,"baru":true,...berkas lengkap} menambah, {"urutan":6,"hapus":true} menghapus.
--        Pemain inti 1–5 tidak bisa dihapus (diganti saja nama + berkasnya).
--    TANPA kunci status: tim terverifikasi juga bisa diubah. Perubahan mengubah sidik AI → agen memeriksa ulang; tim yang
--    diverifikasi AI kembali Menunggu bila ada catatan, tim yang diverifikasi admin tidak disentuh AI (aturan migrasi 10).
--  * tednas_perbaiki_simpan(kode, token, p_pemain) migrasi 12 kini pembungkus tednas_ubah_tim (tanpa kunci status).
--  * tednas_ubah_tautan(p_tim) — ADMIN: token tautan untuk tombol "Ubah data" tanpa mencatat "kapten dikabari".

create or replace function public.tednas_ubah_lihat(p_kode text, p_token text)
returns json language plpgsql stable security definer set search_path = public as $$
declare v_tim uuid := public.tednas_perbaiki_tim(p_kode, p_token);
begin
  return (select (public.tednas_perbaiki_lihat(p_kode, p_token)::jsonb || jsonb_build_object(
      'wa_kapten', t.wa_kapten, 'prov_kode', t.prov_kode, 'kab_kode', t.kab_kode, 'kecamatan', t.kecamatan, 'desa_kode', t.desa_kode))::json
    from public.tednas_tim t where t.id = v_tim);
end $$;

create or replace function public.tednas_ubah_tim(p_kode text, p_token text, p_pemain jsonb, p_tim jsonb default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  v_tim uuid := public.tednas_perbaiki_tim(p_kode, p_token);
  v_t jsonb := coalesce(p_tim, '{}'::jsonb);
  v_p jsonb; v_u int; v_kolom text; v_path text; v_nama text; v_wa text;
  v_baru text[] := '{}';
  v_ubah int := 0; v_baris int := 0;
  v_dok text; v_ml text; v_ig1 text; v_ig2 text; v_izin text;
  v_pesan constant jsonb := '{"dokumen_path":"DOKUMEN_TIDAK_ADA","profil_ml_path":"PROFIL_ML_TIDAK_ADA",
    "follow_esports_path":"FOLLOW_TIDAK_ADA","follow_ppdt_path":"FOLLOW_TIDAK_ADA","izin_path":"IZIN_TIDAK_ADA"}';
begin
  perform 1 from public.tednas_tim where id = v_tim for update;
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
    v_wa := regexp_replace(coalesce(v_t->>'wa', ''), '[^0-9]', '', 'g');
    if v_wa like '08%' then v_wa := '62' || substr(v_wa, 2); end if;
    if v_wa !~ '^628[0-9]{7,12}$' then raise exception 'WA_TIDAK_VALID'; end if;
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
      if coalesce(v_p->>'dokumen_jenis', '') not in ('KTP','KK','Suket RT/RW','Kartu Pelajar') then raise exception 'DOKUMEN_TIDAK_ADA'; end if;
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
      insert into public.tednas_pemain (tim_id, urutan, nama, dokumen_jenis, dokumen_path, profil_ml_path, follow_esports_path, follow_ppdt_path, izin_path)
        values (v_tim, 6, v_nama, v_p->>'dokumen_jenis', v_dok, v_ml, v_ig1, v_ig2, v_izin);
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
    -- Pemicu Drive hanya menangkap UPDATE pemain: tambah/hapus cadangan menaikkan versi sendiri supaya Sheet ikut berubah.
    update public.tednas_tim set perbaiki_pada = now(), drive_rapi = 0, drive_versi = drive_versi + (case when v_baris > 0 then 1 else 0 end)
      where id = v_tim;
  end if;
  return json_build_object('ok', true, 'diubah', v_ubah);
exception
  when unique_violation then raise exception 'DOKUMEN_TIDAK_ADA';
  when check_violation then raise exception 'WILAYAH_TIDAK_VALID';
end $$;

-- Fungsi migrasi 12 tetap ada (halaman lama/tes lama), kini tanpa kunci status.
create or replace function public.tednas_perbaiki_simpan(p_kode text, p_token text, p_pemain jsonb)
returns json language sql security definer set search_path = public as $$
  select public.tednas_ubah_tim(p_kode, p_token, p_pemain, null);
$$;

create or replace function public.tednas_ubah_tautan(p_tim uuid)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.tednas_is_admin() then raise exception 'BUKAN_ADMIN'; end if;
  if not exists (select 1 from public.tednas_tim where id = p_tim) then raise exception 'TIM_TIDAK_ADA'; end if;
  return json_build_object('token', public.tednas_perbaiki_token(p_tim));
end $$;

revoke all on function public.tednas_ubah_lihat(text, text) from public;
revoke all on function public.tednas_ubah_tim(text, text, jsonb, jsonb) from public;
revoke all on function public.tednas_ubah_tautan(uuid) from public, anon;
grant execute on function public.tednas_ubah_lihat(text, text) to anon, authenticated;            -- dijaga token
grant execute on function public.tednas_ubah_tim(text, text, jsonb, jsonb) to anon, authenticated; -- dijaga token
grant execute on function public.tednas_ubah_tautan(uuid) to authenticated;                        -- dijaga tednas_is_admin
