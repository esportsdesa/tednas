-- Migrasi 14: JALUR DATA BERKUNCI untuk MZone dan dasbor monitoring (17 Nov 2026).
-- Jalankan SETELAH migration-13-komunitas.sql. Aman dijalankan ulang.
--
--  * MZone (arahan user 17 Nov: "untuk esports desa, daftarnya di esportsdesa.id. tapi langsung otomatis buatkan
--    akun di mzone. loginnya pake id ml aja"): MZone menarik semua tim lewat tednas_mzone_tim() dengan kuncinya
--    sendiri (mzone_rahasia), lalu mencatatnya sebagai peserta turnamen TEDNas di MZone. Pemain masuk MZone dengan
--    ID + Zone ML yang dibaca agen AI dari screenshot profil, dicocokkan dengan nomor WA kapten.
--  * Dasbor monitoring (kunci dasbor_rahasia): tednas_dasbor() memberi ringkasan per tim TANPA data pribadi
--    (tanpa nama pemain, NIK, nomor WA, atau isi catatan AI; catatan AI hanya kategorinya).
--  * Kedua kunci berbeda dari kunci Drive/cermin/AI, dan tidak bisa mengubah data apa pun.

alter table public.tednas_rahasia add column if not exists mzone_rahasia text not null
  default encode(extensions.gen_random_bytes(32), 'hex');
alter table public.tednas_rahasia add column if not exists dasbor_rahasia text not null
  default encode(extensions.gen_random_bytes(32), 'hex');

create or replace function public.tednas_kunci_jalur_sah(p_jalur text, p_kunci text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select case p_jalur when 'mzone' then mzone_rahasia when 'dasbor' then dasbor_rahasia end = p_kunci
                   from public.tednas_rahasia where id = 1), false)
     and coalesce(p_kunci, '') ~ '^[0-9a-f]{64}$';
$$;

-- "1644930996 (16955)" / "482913751(12045)" → {id, zone}; selain itu null.
create or replace function public.tednas_ml_pecah(p_ml text)
returns json language sql immutable as $$
  select case when m is null then null else json_build_object('id', m[1], 'zone', m[2]) end
  from (select regexp_match(coalesce(p_ml, ''), '^\s*([0-9]{5,12})\s*\(\s*([0-9]{1,6})\s*\)') as m) x;
$$;

-- ========== MZONE: semua tim (paging per kode), lengkap untuk peserta + klaim akun ==========
-- p_dari = kode terakhir halaman sebelumnya (kosong = dari awal). → {tim: [...], berikut: kode | null, total}
create or replace function public.tednas_mzone_tim(p_kunci text, p_dari text default '', p_batas int default 100)
returns json language plpgsql stable security definer set search_path = public as $$
declare v_batas int := least(greatest(coalesce(p_batas, 100), 1), 500);
begin
  if not public.tednas_kunci_jalur_sah('mzone', p_kunci) then raise exception 'KUNCI_SALAH'; end if;
  return (
    with hal as (
      select t.* from public.tednas_tim t where t.kode > coalesce(p_dari, '') order by t.kode limit v_batas)
    select json_build_object(
      'total', (select count(*) from public.tednas_tim),
      'berikut', case when (select count(*) from hal) = v_batas then (select max(kode) from hal) end,
      'tim', coalesce((select json_agg(json_build_object(
          'id', h.id, 'kode', h.kode, 'nama_tim', h.nama_tim, 'status', h.status, 'created_at', h.created_at,
          'prov_kode', h.prov_kode, 'provinsi', h.provinsi, 'kab_kode', h.kab_kode, 'kabupaten', h.kabupaten,
          'kecamatan', h.kecamatan, 'desa_kode', h.desa_kode, 'desa', h.desa,
          'nama_kapten', h.nama_kapten, 'wa_kapten', h.wa_kapten,
          'komunitas', (select json_build_object('id', k.id, 'nama', k.nama) from public.tednas_komunitas k where k.id = h.komunitas_id),
          'ai_selesai', a.tim_id is not null and a.sidik = public.tednas_ai_sidik(h.id) and a.akhir <> 'galat',
          'pemain', (select json_agg(json_build_object(
              'urutan', p.urutan, 'nama', p.nama,
              'ml', public.tednas_ml_pecah(r.d->>'ml'),
              'ml_nick', nullif(r.d->>'ml_nick', '')) order by p.urutan)
            from public.tednas_pemain p
            left join lateral (
              select x->'data' as d from jsonb_array_elements(coalesce(a.rincian->'pemain', '[]'::jsonb)) x
              where (x->>'u')::int = p.urutan limit 1) r on true
            where p.tim_id = h.id)
        ) order by h.kode)
        from hal h left join public.tednas_ai a on a.tim_id = h.id), '[]'::json)));
end $$;

-- ========== DASBOR: ringkasan per tim tanpa data pribadi ==========
create or replace function public.tednas_ai_kategori(p_b text, p_t text)
returns text language sql immutable as $$
  select case
    when p_t ~ 'penyimpanan lama' then 'berkas_lama'
    when p_t ~ 'sama persis' then 'berkas_dobel'
    when p_b = 'profil_ml' and p_t ~ 'ID akun' then 'ml_id'
    when p_b = 'profil_ml' then 'ml_bukan_profil'
    when p_b = 'izin' then 'izin'
    when p_b like 'follow%' and p_t ~ 'tidak diunggah' then 'follow_kosong'
    when p_b like 'follow%' and p_t ~ 'BELUM' then 'follow_belum'
    when p_b like 'follow%' then 'follow_salah'
    when p_t ~ 'tanpa alamat|domisili tidak bisa dipastikan' then 'alamat'
    when p_t ~ 'Tanggal lahir' then 'tgl_lahir'
    when p_t ~ 'buram' then 'foto_buram'
    when p_t ~ '^Nama' then 'nama'
    when p_t ~ '^Umur' then 'umur'
    when p_t ~ '^Domisili di' then 'domisili'
    when p_t ~ 'bukan dokumen identitas' then 'bukan_identitas'
    when p_b = 'nama_tim' then 'nama_tim'
    else 'lain' end;
$$;

create or replace function public.tednas_dasbor(p_kunci text)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.tednas_kunci_jalur_sah('dasbor', p_kunci) then raise exception 'KUNCI_SALAH'; end if;
  return json_build_object(
    'pada', now(),
    'pengaturan', (select json_build_object('pendaftaran_buka', pendaftaran_buka) from public.tednas_pengaturan where id = 1),
    'komunitas', coalesce((select json_agg(json_build_object('id', k.id, 'nama', k.nama, 'kota', k.kota, 'provinsi', k.provinsi,
        'aktif', k.aktif, 'bawaan', k.bawaan) order by k.id) from public.tednas_komunitas k), '[]'::json),
    'tim', coalesce((select json_agg(json_build_object(
        'kode', t.kode, 'nama_tim', t.nama_tim, 'status', t.status, 'status_oleh', t.status_oleh, 'created_at', t.created_at,
        'prov_kode', t.prov_kode, 'provinsi', t.provinsi, 'kab_kode', t.kab_kode, 'kabupaten', t.kabupaten,
        'kecamatan', t.kecamatan, 'desa_kode', t.desa_kode, 'desa', t.desa, 'komunitas_id', t.komunitas_id,
        'pemain', (select count(*) from public.tednas_pemain p where p.tim_id = t.id),
        'kapten_dikabari', t.kapten_dikabari, 'perbaiki_pada', t.perbaiki_pada,
        'ai', case when a.tim_id is null then null else json_build_object(
          'akhir', a.akhir, 'pada', a.pada, 'segar', a.sidik = public.tednas_ai_sidik(t.id),
          'menunggu_model_besar', coalesce((a.rincian->>'tunggu')::int, 0),
          'kategori', coalesce((select json_object_agg(k, n) from (
              select public.tednas_ai_kategori(x->>'b', x->>'t') k, count(*) n
              from jsonb_array_elements(coalesce(a.rincian->'pemain', '[]'::jsonb)) p, jsonb_array_elements(p->'butir') x
              where x->>'s' = 'cek' group by 1
              union all
              select 'ganda', count(*) from jsonb_array_elements(a.ganda) g where (g->>'dulu')::boolean having count(*) > 0) z), '{}'::json)) end
      ) order by t.created_at)
      from public.tednas_tim t left join public.tednas_ai a on a.tim_id = t.id), '[]'::json));
end $$;

revoke all on function public.tednas_kunci_jalur_sah(text, text) from public, anon, authenticated;
revoke all on function public.tednas_ml_pecah(text) from public, anon, authenticated;
revoke all on function public.tednas_ai_kategori(text, text) from public, anon, authenticated;
revoke all on function public.tednas_mzone_tim(text, text, int) from public;
revoke all on function public.tednas_dasbor(text) from public;
-- Pintu MZone & dasbor: terbuka untuk anon, dijaga kuncinya masing-masing.
grant execute on function public.tednas_mzone_tim(text, text, int) to anon, authenticated;
grant execute on function public.tednas_dasbor(text) to anon, authenticated;
