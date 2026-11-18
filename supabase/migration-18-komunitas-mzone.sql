-- Migrasi 18 (18 Nov 2026): komunitas di MZone membuat tautan referal Esports Desa SENDIRI.
-- Permintaan user: "di halaman komunitas bikinin fitur buat komunitas biar mereka bisa bikin kode referal buat
-- kemendes" → pengurus (owner/admin) komunitas di MZone (Kelola komunitas → Referal Esports Desa) menekan satu
-- tombol; MZone memanggil RPC ini dengan kunci jalurnya (mzone_rahasia, migrasi 14). Hasilnya komunitas biasa di
-- tednas_komunitas (tautan esportsdesa.id/k/<id>, sama dengan buatan admin), ditandai mzone_id = id komunitas MZone:
--  * satu komunitas MZone = satu tautan (indeks unik); menekan lagi hanya memperbarui nama/kota/PIC;
--  * komunitas penyelenggara turnamen TEDNas di MZone (MZONETOUR) memakai komunitas BAWAAN (MZone Tour, /k/1),
--    bukan membuat yang baru, supaya hitungannya tidak terbelah;
--  * admin esportsdesa.id tetap bisa menonaktifkan/mengubah dari tab Komunitas; nonaktif TIDAK dinyalakan ulang dari MZone;
--  * yang dikembalikan hanya angka (tanpa nama tim/pemain/nomor WA).
-- Jalankan SETELAH migrasi 16 (tednas_wa_bersih). Aman diulang.

alter table public.tednas_komunitas add column if not exists mzone_id uuid;
create unique index if not exists tednas_komunitas_mzone on public.tednas_komunitas (mzone_id) where mzone_id is not null;

-- p_buat = false: hanya membaca (null bila komunitas MZone ini belum punya tautan).
create or replace function public.tednas_mzone_komunitas(
  p_kunci text, p_mzone_id uuid, p_buat boolean default false, p_bawaan boolean default false,
  p_nama text default '', p_kota text default '', p_provinsi text default '', p_pic_nama text default '', p_pic_wa text default ''
) returns json language plpgsql security definer set search_path = public as $$
declare v_id int; v_wa text; v_nama text := trim(regexp_replace(coalesce(p_nama, ''), '\s+', ' ', 'g'));
begin
  if not public.tednas_kunci_jalur_sah('mzone', p_kunci) then raise exception 'KUNCI_SALAH'; end if;
  if p_mzone_id is null then raise exception 'KOMUNITAS_TIDAK_SAH'; end if;
  select id into v_id from public.tednas_komunitas where mzone_id = p_mzone_id;
  if p_buat then
    if char_length(v_nama) not between 2 and 80 then raise exception 'NAMA_TIDAK_SAH'; end if;
    v_wa := public.tednas_wa_bersih(p_pic_wa);
    if v_wa is null or v_wa = 'X' then v_wa := ''; end if;
    if v_id is null and p_bawaan then
      update public.tednas_komunitas set mzone_id = p_mzone_id where bawaan and mzone_id is null returning id into v_id;
    end if;
    if v_id is null then
      insert into public.tednas_komunitas (nama, kota, provinsi, pic_nama, pic_wa, mzone_id)
        values (v_nama, left(coalesce(p_kota, ''), 80), left(coalesce(p_provinsi, ''), 80), left(coalesce(p_pic_nama, ''), 80), v_wa, p_mzone_id)
        on conflict (mzone_id) where mzone_id is not null do nothing
        returning id into v_id;
      if v_id is null then select id into v_id from public.tednas_komunitas where mzone_id = p_mzone_id; end if; -- dua klik bersamaan
    else
      update public.tednas_komunitas set
          nama = case when bawaan then nama else v_nama end,
          kota = case when bawaan then kota else left(coalesce(p_kota, ''), 80) end,
          provinsi = case when bawaan then provinsi else left(coalesce(p_provinsi, ''), 80) end,
          pic_nama = case when p_pic_nama <> '' then left(p_pic_nama, 80) else pic_nama end,
          pic_wa = case when v_wa <> '' then v_wa else pic_wa end
        where id = v_id;
    end if;
  end if;
  if v_id is null then return null; end if;
  return (select json_build_object('id', k.id, 'nama', k.nama, 'aktif', k.aktif, 'bawaan', k.bawaan, 'dibuat', k.created_at,
      'mendaftar', count(t.id),
      'terverifikasi', count(t.id) filter (where t.status = 'terverifikasi'),
      'menunggu', count(t.id) filter (where t.status = 'menunggu'))
    from public.tednas_komunitas k left join public.tednas_tim t on t.komunitas_id = k.id
    where k.id = v_id group by k.id);
end $$;
revoke all on function public.tednas_mzone_komunitas(text, uuid, boolean, boolean, text, text, text, text, text) from public;
grant execute on function public.tednas_mzone_komunitas(text, uuid, boolean, boolean, text, text, text, text, text) to anon, authenticated;
