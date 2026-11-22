-- Migrasi 20 (22 Nov 2026): MZone Community Clash — kompetisi antarkomunitas MZone untuk semua acara sampai Januari.
-- User: "buatin leaderboard juga buat ToT ... bukan cuman buat esports desa, tapi untuk semua acara kita sampai januari".
-- Bagian Esports Desa: 3 poin per tim TERVERIFIKASI yang mendaftar lewat tautan referal komunitas (esportsdesa.id/k/…).
-- MZone membaca jumlahnya untuk semua komunitas MZone sekaligus lewat RPC berkunci ini (kunci jalur mzone, migrasi 14);
-- periode (17 Nov 2026 – 31 Jan 2027) dikirim MZone (pengaturan ops). Hanya angka, tanpa data pribadi. Aman diulang.

create or replace function public.tednas_mzone_komunitas_papan(p_kunci text, p_dari timestamptz default null, p_sampai timestamptz default null)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.tednas_kunci_jalur_sah('mzone', p_kunci) then raise exception 'KUNCI_SALAH'; end if;
  return coalesce((select json_agg(x order by x.id) from (
      select k.id, k.mzone_id, k.nama, k.aktif, k.bawaan,
        count(t.id) filter (where t.status = 'terverifikasi') as terverifikasi,
        count(t.id) filter (where t.status <> 'terverifikasi') as menunggu
      from public.tednas_komunitas k
      left join public.tednas_tim t on t.komunitas_id = k.id
        and (p_dari is null or t.created_at >= p_dari) and (p_sampai is null or t.created_at < p_sampai)
      where k.mzone_id is not null
      group by k.id) x), '[]'::json);
end $$;
revoke all on function public.tednas_mzone_komunitas_papan(text, timestamptz, timestamptz) from public;
grant execute on function public.tednas_mzone_komunitas_papan(text, timestamptz, timestamptz) to anon, authenticated;
