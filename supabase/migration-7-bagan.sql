-- Migrasi 7: urutan posisi pertandingan di bagan (bracket).
-- Pemenang pertandingan urut 0 dan 1 bertemu di ronde berikutnya, begitu seterusnya.
-- Jalankan SEBELUM deploy kode bagan.

alter table public.tednas_match add column if not exists urut int not null default 0;

drop view if exists public.tednas_match_publik;
create view public.tednas_match_publik as
  select m.id, m.fase, m.prov_kode, m.provinsi, m.ronde, m.label, m.bo, m.urut,
         m.tim_a, m.tim_b, m.skor_a, m.skor_b, m.pemenang, m.status, m.jadwal, m.tautan_live,
         a.nama_tim as a_nama, a.desa as a_desa, a.kabupaten as a_kab,
         b.nama_tim as b_nama, b.desa as b_desa, b.kabupaten as b_kab
  from public.tednas_match m
  left join public.tednas_tim a on a.id = m.tim_a
  left join public.tednas_tim b on b.id = m.tim_b;

grant select on public.tednas_match_publik to anon, authenticated;
