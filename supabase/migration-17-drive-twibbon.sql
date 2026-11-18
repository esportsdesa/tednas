-- Migrasi 17 (18 Nov 2026): screenshot twibbon (migrasi 16, tednas_tim.twibbon_path) ikut dihitung "dipakai".
-- Tanpa ini, pemicu Apps Script `rapikan` → buangYatim() membuang twibbon yang masih di "Berkas Masuk/<tanggal>"
-- sebagai unggahan yatim setelah 7 hari: Code.gs sebelum versi 2026-11-18 tidak memindahkan twibbon ke folder tim.
-- Ketahuan sebelum ada yang terbuang (tim form v2 pertama: TED-00068, 18 Nov). Aman diulang.
create or replace function public.tednas_drive_dipakai(p_kunci text, p_paths text[])
returns text[] language plpgsql stable security definer set search_path = public as $$
begin
  if not public.tednas_drive_kunci_sah(p_kunci) then raise exception 'KUNCI_SALAH'; end if;
  return coalesce((select array_agg(x) from unnest(p_paths[1:500]) x where exists (
    select 1 from public.tednas_pemain p
    where x in (p.dokumen_path, p.profil_ml_path, p.follow_esports_path, p.follow_ppdt_path, p.izin_path))
    or exists (select 1 from public.tednas_tim t where t.twibbon_path = x)), '{}');
end $$;
grant execute on function public.tednas_drive_dipakai(text, text[]) to anon, authenticated;
