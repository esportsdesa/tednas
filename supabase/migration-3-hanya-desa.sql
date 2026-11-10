-- Peserta hanya desa di kabupaten: DKI Jakarta (31), kota (kode 71 ke atas), dan kelurahan (awalan 1) ditolak.
-- NOT VALID: baris lama tidak diperiksa, pendaftaran baru diperiksa.
alter table public.tednas_tim drop constraint if exists tednas_tim_hanya_desa;
alter table public.tednas_tim add constraint tednas_tim_hanya_desa check (
  prov_kode <> '31' and substr(kab_kode, 4, 2)::int < 71 and substr(desa_kode, 10, 1) = '2') not valid;
