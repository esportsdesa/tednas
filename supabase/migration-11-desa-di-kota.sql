-- Desa di wilayah kota boleh mendaftar (permintaan panitia, 16 Nov 2026): 820 desa di 19 kota,
-- mis. Gampong di Banda Aceh, Desa di Kota Batu, Negeri di Ambon. DKI Jakarta dan kelurahan tetap ditolak.
alter table public.tednas_tim drop constraint if exists tednas_tim_hanya_desa;
alter table public.tednas_tim add constraint tednas_tim_hanya_desa check (
  prov_kode <> '31' and substr(desa_kode, 10, 1) = '2');
