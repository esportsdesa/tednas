-- Migrasi 9: pemilik Google Drive pindah ke esportsdesa@gmail.com (15 Nov 2026).
-- Jalankan seluruh isi berkas ini di Supabase > SQL Editor SETELAH migration-8-drive.sql. Aman dijalankan ulang.
--
-- Web App Apps Script yang baru (akun esportsdesa) memakai KUNCI BARU. Saat dialihkan, kunci lama dipindah ke
-- drive_rahasia_lama dan HANYA dipakai untuk memeriksa tanda berkas: pendaftar yang halamannya masih memuat
-- alamat Web App lama tetap bisa mengirim pendaftaran (berkasnya disusulkan ke Drive baru oleh skrip pindah).
-- Semua pintu Apps Script (antre/selesai/hapus_selesai/dipakai/setel_url) tetap memakai tednas_drive_kunci_sah
-- yang HANYA menerima drive_rahasia → skrip lama di akun yanuar otomatis tidak bisa menyentuh antrean lagi.
--
-- Pengalihan (diisi terpisah, berisi rahasia — lihat deploy/drive/PINDAH-AKUN.md):
--   update tednas_rahasia set drive_rahasia_lama = <kunci lama>, drive_rahasia = <kunci baru>, drive_url = <URL baru>
-- Seminggu kemudian: update tednas_rahasia set drive_rahasia_lama = null.

alter table public.tednas_rahasia add column if not exists drive_rahasia_lama text;

create or replace function public.tednas_berkas_sah(p_path text, p_pdf boolean)
returns text language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_ext text := case when p_pdf then '(pdf|jpg|png)' else '(jpg|png)' end;
  v_inti text;
  v_tanda text;
  v_rahasia text;
  v_lama text;
begin
  if coalesce(p_path, '') = '' then return null; end if;
  if p_path ~ ('^dokumen/[^/]+\.' || v_ext || '$') then
    if exists (select 1 from storage.objects where bucket_id = 'tednas-dokumen' and name = p_path) then
      return p_path;
    end if;
    return null;
  end if;
  if p_path ~ ('^gdrive/[A-Za-z0-9_-]{10,100}\.' || v_ext || '~[0-9a-f]{64}$') then
    select drive_rahasia, drive_rahasia_lama into v_rahasia, v_lama from public.tednas_rahasia where id = 1;
    v_inti := split_part(p_path, '~', 1);
    v_tanda := split_part(p_path, '~', 2);
    if v_rahasia is not null and encode(extensions.hmac(v_inti, v_rahasia, 'sha256'), 'hex') = v_tanda then
      return v_inti;
    end if;
    if v_lama is not null and encode(extensions.hmac(v_inti, v_lama, 'sha256'), 'hex') = v_tanda then
      return v_inti;
    end if;
  end if;
  return null;
end $$;

revoke all on function public.tednas_berkas_sah(text, boolean) from public, anon, authenticated;
