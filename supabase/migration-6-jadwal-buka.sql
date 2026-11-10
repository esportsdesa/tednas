-- Migrasi 6: jadwal buka pendaftaran.
-- Pendaftaran baru diterima bila pendaftaran_buka = true DAN waktu sekarang sudah lewat buka_mulai.
-- buka_mulai kosong berarti tidak ada jadwal (langsung mengikuti pendaftaran_buka).
-- Jalankan sekali di Supabase SQL Editor SEBELUM deploy kode yang membacanya.

alter table public.tednas_pengaturan add column if not exists buka_mulai timestamptz;

update public.tednas_pengaturan set buka_mulai = '2026-11-11 00:00:00+07' where id = 1;

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
