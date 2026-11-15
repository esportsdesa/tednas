-- Migrasi 10: AGEN AI PEMERIKSA BERKAS (permintaan 16 Nov 2026: "buat AI agen untuk verifikasi secara otomatis").
-- Jalankan SETELAH migration-8-drive.sql. Aman dijalankan ulang.
--
--  * Agen di server (agen-ai/agen.mjs) membaca berkas tiap tim, menilainya dengan model penglihatan lokal,
--    lalu menyimpan hasilnya di tednas_ai.
--  * Agen TIDAK mengubah status tim. Yang menekan "Verifikasi" tetap admin; tim yang lolos AI bisa
--    diverifikasi sekaligus lewat tednas_ai_verifikasi_lolos().
--  * Agen memakai kunci sendiri (ai_rahasia). Dengan kunci itu agen hanya bisa membaca antrean tim dan menulis
--    hasil AI. Ia tidak bisa mengubah tim, Sheet, atau alamat Web App.
--  * Tim diperiksa (ulang) bila:
--      - belum pernah diperiksa;
--      - isi tim atau berkasnya berubah (sidik);
--      - versi agen naik;
--      - hasil galat sudah lebih dari 30 menit;
--      - admin menekan "Periksa ulang" (baris tednas_ai dihapus).
--  * Ganda: bila NIK, ID Mobile Legends, atau berkas yang sama persis dipakai dua pemain (di tim mana pun),
--    kedua tim menjadi "cek".

alter table public.tednas_rahasia add column if not exists ai_rahasia text;

create table if not exists public.tednas_ai (
  tim_id uuid primary key references public.tednas_tim(id) on delete cascade,
  sidik text not null,                       -- tednas_ai_sidik() saat diperiksa
  versi int not null default 1,              -- versi agen yang memeriksa
  hasil text not null check (hasil in ('lolos','cek','galat')),  -- penilaian berkas tim ini saja
  akhir text not null check (akhir in ('lolos','cek','galat')),  -- hasil + ganda dengan tim lain
  ringkas text not null default '',
  rincian jsonb not null default '{}'::jsonb,
  ganda jsonb not null default '[]'::jsonb,
  model text not null default '',
  durasi_ms int,
  pada timestamptz not null default now()
);
create index if not exists tednas_ai_akhir on public.tednas_ai (akhir);

-- NIK (sudah di-HMAC oleh agen, bukan NIK asli), ID ML, dan sidik berkas per pemain, untuk mencari yang ganda.
create table if not exists public.tednas_ai_kunci (
  tim_id uuid not null references public.tednas_tim(id) on delete cascade,
  u int not null check (u between 1 and 6),
  jenis text not null check (jenis in ('nik','ml','berkas')),
  nilai text not null,
  primary key (tim_id, u, jenis, nilai)
);
create index if not exists tednas_ai_kunci_nilai on public.tednas_ai_kunci (jenis, nilai);

alter table public.tednas_ai enable row level security;
alter table public.tednas_ai_kunci enable row level security;
revoke all on public.tednas_ai from anon, authenticated;
revoke all on public.tednas_ai_kunci from anon, authenticated;
-- Admin hanya membaca hasil dan menghapusnya ("Periksa ulang"). Yang menulis hasil hanya agen, lewat RPC.
grant select, delete on public.tednas_ai to authenticated;
drop policy if exists ai_admin_baca on public.tednas_ai;
create policy ai_admin_baca on public.tednas_ai for select to authenticated using (public.tednas_is_admin());
drop policy if exists ai_admin_hapus on public.tednas_ai;
create policy ai_admin_hapus on public.tednas_ai for delete to authenticated using (public.tednas_is_admin());

-- Sidik isi tim yang dinilai AI: nama tim, wilayah, pemain, dan berkas. Status tidak ikut, supaya
-- menekan Verifikasi tidak membuat tim diperiksa ulang.
create or replace function public.tednas_ai_sidik(p_tim uuid)
returns text language sql stable security definer set search_path = public as $$
  select md5(json_build_array(t.nama_tim, t.kab_kode, t.kabupaten, t.kecamatan, t.desa_kode, t.desa,
    (select json_agg(json_build_array(p.urutan, p.nama, p.dokumen_jenis, p.dokumen_path, p.profil_ml_path,
       p.follow_esports_path, p.follow_ppdt_path, p.izin_path) order by p.urutan)
     from public.tednas_pemain p where p.tim_id = t.id))::text)
  from public.tednas_tim t where t.id = p_tim;
$$;

create or replace function public.tednas_ai_kunci_sah(p_kunci text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select ai_rahasia is not null and ai_rahasia = p_kunci from public.tednas_rahasia where id = 1), false);
$$;

-- Ganda satu tim dihitung ulang dari tednas_ai_kunci, lalu akhir = hasil + ganda.
create or replace function public.tednas_ai_ganda_hitung(p_tim uuid)
returns void language sql security definer set search_path = public as $$
  update public.tednas_ai a set ganda = g.ganda,
    akhir = case when a.hasil = 'galat' then 'galat' when a.hasil = 'lolos' and g.ganda = '[]'::jsonb then 'lolos' else 'cek' end
  from (select coalesce(jsonb_agg(jsonb_build_object('u', x.u, 'jenis', x.jenis, 'kode', x.kode, 'u_lain', x.u_lain)
                 order by x.u, x.jenis, x.kode, x.u_lain), '[]'::jsonb) as ganda
        from (select distinct k.u, k.jenis, t.kode, b.u as u_lain
              from public.tednas_ai_kunci k
              join public.tednas_ai_kunci b on b.jenis = k.jenis and b.nilai = k.nilai and not (b.tim_id = k.tim_id and b.u = k.u)
              join public.tednas_tim t on t.id = b.tim_id
              where k.tim_id = p_tim) x) g
  where a.tim_id = p_tim;
$$;

-- ========== PINTU UNTUK AGEN (berkunci ai_rahasia) ==========
-- Tim yang perlu diperiksa: yang masih menunggu verifikasi didahulukan, lalu urut waktu daftar.
create or replace function public.tednas_ai_antre(p_kunci text, p_versi int, p_batas int default 2)
returns json language plpgsql stable security definer set search_path = public as $$
declare v_batas int := least(greatest(coalesce(p_batas, 2), 1), 20);
begin
  if not public.tednas_ai_kunci_sah(p_kunci) then raise exception 'KUNCI_SALAH'; end if;
  return (
    with perlu as (
      select t.id, t.created_at, t.status = 'menunggu' as menunggu, s.sidik
      from public.tednas_tim t
      cross join lateral (select public.tednas_ai_sidik(t.id) as sidik) s
      left join public.tednas_ai a on a.tim_id = t.id
      where a.tim_id is null or a.sidik <> s.sidik or a.versi < coalesce(p_versi, 1)
         or (a.hasil = 'galat' and a.pada < now() - interval '30 minutes'))
    select json_build_object(
      'tim', coalesce((select json_agg(public.tednas_drive_paket(x.id)::jsonb || jsonb_build_object('sidik', x.sidik)
                         order by x.menunggu desc, x.created_at)
                       from (select * from perlu order by menunggu desc, created_at limit v_batas) x), '[]'::json),
      'sisa', (select count(*) from perlu)));
end $$;

-- p_identitas: [{u, nik, ml, sha: [..]}] (nik sudah di-HMAC agen). Tim yang berubah sejak diambil dari antrean
-- tidak disimpan (diperiksa ulang di putaran berikutnya).
create or replace function public.tednas_ai_simpan(p_kunci text, p_tim uuid, p_sidik text, p_versi int, p_hasil text,
  p_ringkas text, p_rincian jsonb, p_identitas jsonb, p_model text, p_durasi int default null)
returns json language plpgsql security definer set search_path = public as $$
declare v_terkait uuid[]; v_t uuid;
begin
  if not public.tednas_ai_kunci_sah(p_kunci) then raise exception 'KUNCI_SALAH'; end if;
  if p_hasil is null or p_hasil not in ('lolos','cek','galat') then raise exception 'HASIL_SALAH'; end if;
  if not exists (select 1 from public.tednas_tim where id = p_tim) then
    return json_build_object('ok', false, 'pesan', 'TIM_TIDAK_ADA');
  end if;
  if public.tednas_ai_sidik(p_tim) is distinct from p_sidik then
    return json_build_object('ok', false, 'pesan', 'TIM_BERUBAH');
  end if;

  -- Tim yang tadinya ganda dengan tim ini ikut dihitung ulang (bisa jadi sudah tidak ganda).
  select coalesce(array_agg(distinct b.tim_id), '{}') into v_terkait
    from public.tednas_ai_kunci k join public.tednas_ai_kunci b on b.jenis = k.jenis and b.nilai = k.nilai and b.tim_id <> k.tim_id
    where k.tim_id = p_tim;
  delete from public.tednas_ai_kunci where tim_id = p_tim;
  insert into public.tednas_ai_kunci (tim_id, u, jenis, nilai)
    select p_tim, (e->>'u')::int, x.jenis, left(x.nilai, 200)
    from jsonb_array_elements(case when jsonb_typeof(p_identitas) = 'array' then p_identitas else '[]'::jsonb end) e
    cross join lateral (
      select 'nik' as jenis, e->>'nik' as nilai
      union all select 'ml', e->>'ml'
      union all select 'berkas', s from jsonb_array_elements_text(case when jsonb_typeof(e->'sha') = 'array' then e->'sha' else '[]'::jsonb end) s) x
    where coalesce(e->>'u', '') ~ '^[1-6]$' and coalesce(x.nilai, '') <> ''
    on conflict do nothing;

  insert into public.tednas_ai (tim_id, sidik, versi, hasil, akhir, ringkas, rincian, model, durasi_ms, pada)
    values (p_tim, p_sidik, coalesce(p_versi, 1), p_hasil, p_hasil, left(coalesce(p_ringkas, ''), 500),
            coalesce(p_rincian, '{}'::jsonb), left(coalesce(p_model, ''), 80), p_durasi, now())
    on conflict (tim_id) do update set sidik = excluded.sidik, versi = excluded.versi, hasil = excluded.hasil,
      akhir = excluded.akhir, ringkas = excluded.ringkas, rincian = excluded.rincian, model = excluded.model,
      durasi_ms = excluded.durasi_ms, pada = excluded.pada;

  select coalesce(array_agg(distinct x), '{}') into v_terkait from (
    select unnest(v_terkait) as x
    union select b.tim_id from public.tednas_ai_kunci k
      join public.tednas_ai_kunci b on b.jenis = k.jenis and b.nilai = k.nilai and b.tim_id <> k.tim_id
      where k.tim_id = p_tim) y;
  perform public.tednas_ai_ganda_hitung(p_tim);
  foreach v_t in array v_terkait loop perform public.tednas_ai_ganda_hitung(v_t); end loop;
  return json_build_object('ok', true, 'akhir', (select akhir from public.tednas_ai where tim_id = p_tim),
    'ganda', (select ganda from public.tednas_ai where tim_id = p_tim), 'terkait', cardinality(v_terkait));
end $$;

-- Tim yang dihapus meninggalkan catatan ganda di tim lain: dibersihkan agen secara berkala.
create or replace function public.tednas_ai_segarkan(p_kunci text)
returns json language plpgsql security definer set search_path = public as $$
declare v_t uuid; n int := 0;
begin
  if not public.tednas_ai_kunci_sah(p_kunci) then raise exception 'KUNCI_SALAH'; end if;
  for v_t in select tim_id from public.tednas_ai where ganda <> '[]'::jsonb loop
    perform public.tednas_ai_ganda_hitung(v_t); n := n + 1;
  end loop;
  return json_build_object('ok', true, 'dihitung', n);
end $$;

-- ========== UNTUK HALAMAN ADMIN ==========
create or replace function public.tednas_ai_statistik()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.tednas_is_admin() then raise exception 'BUKAN_ADMIN'; end if;
  return (
    select json_build_object(
      'lolos', count(*) filter (where s.segar and a.akhir = 'lolos' and t.status = 'menunggu'),
      'cek', count(*) filter (where s.segar and a.akhir = 'cek' and t.status = 'menunggu'),
      'galat', count(*) filter (where s.segar and a.akhir = 'galat' and t.status = 'menunggu'),
      'antre', count(*) filter (where not s.segar))
    from public.tednas_tim t
    left join public.tednas_ai a on a.tim_id = t.id
    cross join lateral (select coalesce(a.sidik = public.tednas_ai_sidik(t.id), false) as segar) s);
end $$;

-- Verifikasi sekaligus: hanya tim yang masih menunggu, lolos AI, dan tidak berubah sejak diperiksa.
create or replace function public.tednas_ai_verifikasi_lolos(p_ids uuid[])
returns json language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.tednas_is_admin() then raise exception 'BUKAN_ADMIN'; end if;
  if cardinality(p_ids) > 50 then raise exception 'TERLALU_BANYAK'; end if;
  update public.tednas_tim t set status = 'terverifikasi'
    from public.tednas_ai a
    where a.tim_id = t.id and t.id = any (p_ids) and t.status = 'menunggu' and a.akhir = 'lolos'
      and a.sidik = public.tednas_ai_sidik(t.id);
  get diagnostics n = row_count;
  return json_build_object('ok', true, 'diverifikasi', n);
end $$;

revoke all on function public.tednas_ai_sidik(uuid) from public, anon, authenticated;
revoke all on function public.tednas_ai_kunci_sah(text) from public, anon, authenticated;
revoke all on function public.tednas_ai_ganda_hitung(uuid) from public, anon, authenticated;
revoke all on function public.tednas_ai_antre(text, int, int) from public;
revoke all on function public.tednas_ai_simpan(text, uuid, text, int, text, text, jsonb, jsonb, text, int) from public;
revoke all on function public.tednas_ai_segarkan(text) from public;
revoke all on function public.tednas_ai_statistik() from public, anon;
revoke all on function public.tednas_ai_verifikasi_lolos(uuid[]) from public, anon;
-- Pintu agen: terbuka untuk anon, dijaga ai_rahasia.
grant execute on function public.tednas_ai_antre(text, int, int) to anon, authenticated;
grant execute on function public.tednas_ai_simpan(text, uuid, text, int, text, text, jsonb, jsonb, text, int) to anon, authenticated;
grant execute on function public.tednas_ai_segarkan(text) to anon, authenticated;
-- Admin (dijaga tednas_is_admin di dalam fungsi).
grant execute on function public.tednas_ai_statistik() to authenticated;
grant execute on function public.tednas_ai_verifikasi_lolos(uuid[]) to authenticated;
