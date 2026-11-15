-- Migrasi 9: CERMIN — salinan penuh data & berkas pendaftar di Google Drive akun kedua (esportsdesa@gmail.com,
-- permintaan Kemendes 15 Nov 2026). Jalankan SETELAH migration-8-drive.sql. Aman dijalankan ulang.
--
--  * Drive UTAMA (drive_url/drive_rahasia, akun yanuarardaraja@gmail.com) tidak berubah: unggahan pendaftar,
--    Sheet utama, halaman admin.
--  * Tiap kabar tim/hapus kini dikirim juga ke Web App CERMIN (cermin_url, membawa cermin_rahasia). Web App cermin
--    menyalin berkas tim dari Drive utama (folder utama dibagikan ke akun cermin sebagai Pelihat) ke Drive-nya
--    sendiri dan menulis Sheet-nya sendiri.
--  * Bila kabar ke cermin gagal, pemicu Apps Script cermin menyusul lewat cermin_tersalin < drive_versi.
--  * Kunci cermin TERPISAH dari kunci utama: Web App cermin tidak bisa menyentuh antrean / alamat utama.
--  * Rahasia & alamat diisi terpisah (lihat deploy/drive/CERMIN.md).

alter table public.tednas_rahasia add column if not exists cermin_url text;
alter table public.tednas_rahasia add column if not exists cermin_rahasia text;

alter table public.tednas_tim add column if not exists cermin_tersalin int not null default 0;
alter table public.tednas_tim add column if not exists cermin_folder text;
alter table public.tednas_tim add column if not exists cermin_pada timestamptz;
create index if not exists tednas_tim_cermin_perlu on public.tednas_tim (created_at) where cermin_tersalin < drive_versi;

create table if not exists public.tednas_cermin_hapus (
  kode text primary key,
  nama_tim text not null,
  waktu timestamptz not null default now()
);
alter table public.tednas_cermin_hapus enable row level security;
revoke all on public.tednas_cermin_hapus from anon, authenticated;

-- Kabar ke Web App utama DAN cermin (masing-masing dengan kuncinya). Galat apa pun hanya peringatan.
create or replace function public.tednas_drive_kirim(p_isi jsonb)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare r record;
begin
  select drive_url, drive_rahasia, cermin_url, cermin_rahasia into r from public.tednas_rahasia where id = 1;
  if r.drive_url is not null and r.drive_rahasia is not null then
    perform net.http_post(url := r.drive_url, body := p_isi || jsonb_build_object('kunci', r.drive_rahasia),
      headers := '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds := 60000);
  end if;
  if r.cermin_url is not null and r.cermin_rahasia is not null then
    perform net.http_post(url := r.cermin_url, body := p_isi || jsonb_build_object('kunci', r.cermin_rahasia),
      headers := '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds := 60000);
  end if;
exception when others then
  raise warning 'tednas_drive_kirim: %', sqlerrm;
end $$;

-- Tim dihapus: antrean hapus utama + (bila cermin terpasang) antrean hapus cermin, lalu kabar.
create or replace function public.tednas_drive_hapus_kabar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.tednas_drive_hapus (kode, nama_tim) values (old.kode, old.nama_tim)
    on conflict (kode) do update set nama_tim = excluded.nama_tim, waktu = now();
  if exists (select 1 from public.tednas_rahasia where id = 1 and cermin_rahasia is not null) then
    insert into public.tednas_cermin_hapus (kode, nama_tim) values (old.kode, old.nama_tim)
      on conflict (kode) do update set nama_tim = excluded.nama_tim, waktu = now();
  end if;
  perform public.tednas_drive_kirim(jsonb_build_object('aksi', 'hapus', 'kode', old.kode));
  return old;
end $$;

-- ========== PINTU UNTUK APPS SCRIPT CERMIN (berkunci cermin_rahasia) ==========
create or replace function public.tednas_cermin_kunci_sah(p_kunci text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select cermin_rahasia is not null and cermin_rahasia = p_kunci from public.tednas_rahasia where id = 1), false);
$$;

create or replace function public.tednas_cermin_antre(p_kunci text, p_batas int default 5)
returns json language plpgsql stable security definer set search_path = public as $$
declare v_batas int := least(greatest(coalesce(p_batas, 5), 1), 50);
begin
  if not public.tednas_cermin_kunci_sah(p_kunci) then raise exception 'KUNCI_SALAH'; end if;
  return json_build_object(
    'tim', coalesce((select json_agg(public.tednas_drive_paket(x.id) order by x.created_at) from (
      select id, created_at from public.tednas_tim where cermin_tersalin < drive_versi order by created_at limit v_batas) x), '[]'::json),
    'sisa', (select count(*) from public.tednas_tim where cermin_tersalin < drive_versi),
    'hapus', coalesce((select json_agg(json_build_object('kode', kode, 'nama_tim', nama_tim) order by waktu)
      from public.tednas_cermin_hapus), '[]'::json));
end $$;

create or replace function public.tednas_cermin_selesai(p_kunci text, p_tim uuid, p_versi int, p_folder text default null)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not public.tednas_cermin_kunci_sah(p_kunci) then raise exception 'KUNCI_SALAH'; end if;
  update public.tednas_tim set cermin_tersalin = greatest(cermin_tersalin, least(p_versi, drive_versi)),
    cermin_folder = coalesce(left(nullif(p_folder, ''), 300), cermin_folder), cermin_pada = now()
    where id = p_tim;
  return json_build_object('ok', true);
end $$;

create or replace function public.tednas_cermin_hapus_selesai(p_kunci text, p_kode text)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not public.tednas_cermin_kunci_sah(p_kunci) then raise exception 'KUNCI_SALAH'; end if;
  delete from public.tednas_cermin_hapus where kode = p_kode;
  return json_build_object('ok', true);
end $$;

revoke all on function public.tednas_drive_kirim(jsonb) from public, anon, authenticated;
revoke all on function public.tednas_drive_hapus_kabar() from public, anon, authenticated;
revoke all on function public.tednas_cermin_kunci_sah(text) from public, anon, authenticated;
revoke all on function public.tednas_cermin_antre(text, int) from public;
revoke all on function public.tednas_cermin_selesai(text, uuid, int, text) from public;
revoke all on function public.tednas_cermin_hapus_selesai(text, text) from public;
grant execute on function public.tednas_cermin_antre(text, int) to anon, authenticated;
grant execute on function public.tednas_cermin_selesai(text, uuid, int, text) to anon, authenticated;
grant execute on function public.tednas_cermin_hapus_selesai(text, text) to anon, authenticated;
