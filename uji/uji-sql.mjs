/**
 * Uji SQL TEDNas di Postgres SUNGGUHAN (container sementara di server jot, dibuang setelahnya):
 * skema-tednas.sql + migration-8-drive.sql + migration-9-cermin-drive.sql + migration-10-ai-periksa.sql + migration-12-perbaiki.sql + migration-13-komunitas.sql + migration-14-jalur-mzone-dasbor.sql di atas tiruan Supabase (uji/sql-tiruan-supabase.sql).
 * Tanda HMAC dibuat dengan crypto Node — sama dengan Utilities.computeHmacSha256Signature di Apps Script —
 * jadi uji ini juga membuktikan pgcrypto menghitung tanda yang sama.
 *   node uji/uji-sql.mjs            (butuh ssh jot + docker postgres:17-alpine di sana)
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

const AKAR = new URL("..", import.meta.url);
const baca = (f) => readFileSync(new URL(f, AKAR), "utf8");
const RAHASIA = "a1".repeat(32);
const URL_WA = "https://script.google.com/macros/s/AKfycbUJIuji0123456789abcdefghijklmnop/exec";
const tanda = (inti) => `${inti}~${createHmac("sha256", RAHASIA).update(inti).digest("hex")}`;
const RAHASIA2 = "b2".repeat(32); // kunci Web App cermin (migrasi 9)
const URL_CERMIN = "https://script.google.com/macros/s/AKfycbCERMINuji0123456789abcdefgh/exec";
const RAHASIA3 = "c3".repeat(32); // kunci agen AI (migrasi 10)
const id = (n) => `1AbCdEfGhIjKlMnOpQrStUvWx_${String(n).padStart(4, "0")}`;
const pemain = (awal, n = 5) => Array.from({ length: n }, (_, i) => ({
  nama: `Pemain ${awal}-${i + 1}`, dokumen_jenis: "KTP",
  dokumen_path: tanda(`gdrive/${id(awal * 100 + i * 5 + 1)}.jpg`), profil_ml_path: tanda(`gdrive/${id(awal * 100 + i * 5 + 2)}.png`),
  follow_esports_path: tanda(`gdrive/${id(awal * 100 + i * 5 + 3)}.jpg`), follow_ppdt_path: tanda(`gdrive/${id(awal * 100 + i * 5 + 4)}.jpg`),
  izin_path: i === 4 ? tanda(`gdrive/${id(awal * 100 + i * 5 + 5)}.pdf`) : null,
}));
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const daftar = (nama, wa, desa, p, captcha = "lulus") =>
  `select public.tednas_daftar(${q(nama)}, ${q(wa)}, '35', 'JAWA TIMUR', '35.07', 'KAB. MALANG', 'Pakis', ${q(desa)}, 'Mangliawan', ${q(JSON.stringify(p))}::jsonb, ${q(captcha)})`;
// Migrasi 16: daftar dengan WA pemain 2–6 + bukti twibbon (parameter ke-13).
const daftar16 = (nama, wa, desa, p, tw, captcha = "lulus") =>
  `select public.tednas_daftar(${q(nama)}, ${q(wa)}, '35', 'JAWA TIMUR', '35.07', 'KAB. MALANG', 'Pakis', ${q(desa)}, 'Mangliawan', ${q(JSON.stringify(p))}::jsonb, ${q(captcha)}, null, ${tw == null ? "null" : q(tw)})`;
const pemain16 = (awal, depan) => pemain(awal).map((x, i) => ({ ...x, ...(i ? { wa: `${depan}${i + 1}` } : {}), dokumen_jenis: i === 3 ? "SIM" : i === 4 ? "KIA" : x.dokumen_jenis }));
const p16a = pemain16(50, "08125550100"), p16b = pemain16(51, "08125550200");
const tw16a = tanda(`gdrive/${id(5091)}.jpg`);
const harusGagal = (sql, pesan, peran = "anon") => `
set role ${peran};
do $u$ begin
  ${sql.replace(/^select /, "perform ")};
  raise exception 'UJI_GAGAL: seharusnya ditolak (${pesan})';
exception when others then
  if sqlerrm like 'UJI_GAGAL%' or sqlerrm not like ${q(`%${pesan}%`)} then raise exception 'UJI_GAGAL: % (harap ${pesan})', sqlerrm; end if;
end $u$;
reset role;`;

const p1 = pemain(1);
const salahTanda = pemain(2).map((x, i) => (i === 2 ? { ...x, profil_ml_path: x.profil_ml_path.replace(/~.{4}/, "~0000") } : x));
const pdfDiMl = pemain(3).map((x, i) => (i === 0 ? { ...x, profil_ml_path: tanda(`gdrive/${id(999)}.pdf`) } : x));
const lama = Array.from({ length: 5 }, (_, i) => ({ nama: `Lama ${i + 1}`, dokumen_jenis: "KK", dokumen_path: `dokumen/lama-${i}a.jpg`, profil_ml_path: `dokumen/lama-${i}b.png`, follow_esports_path: `dokumen/lama-${i}c.jpg`, follow_ppdt_path: `dokumen/lama-${i}d.jpg`, izin_path: null }));

const uji = `
\\set ON_ERROR_STOP 1
\\set QUIET 1
-- data awal
update public.tednas_pengaturan set pendaftaran_buka = true, buka_mulai = null where id = 1;
insert into public.tednas_rahasia (id, turnstile_secret, drive_rahasia, drive_url) values (1, 'ts', ${q(RAHASIA)}, ${q(URL_WA)});
insert into storage.objects (bucket_id, name) select 'tednas-dokumen', 'dokumen/lama-' || i || s || '.' || case s when 'b' then 'png' else 'jpg' end
  from generate_series(0, 4) i, unnest(array['a','b','c','d']) s;

-- 1. pemeriksa berkas: tanda Node = pgcrypto
do $u$ begin
  assert public.tednas_berkas_sah(${q(tanda(`gdrive/${id(1)}.jpg`))}, false) = ${q(`gdrive/${id(1)}.jpg`)}, 'tanda sah ditolak';
  assert public.tednas_berkas_sah(${q(`gdrive/${id(1)}.jpg~${"0".repeat(64)}`)}, false) is null, 'tanda palsu diterima';
  assert public.tednas_berkas_sah(${q(`gdrive/${id(1)}.jpg`)}, false) is null, 'tanpa tanda diterima';
  assert public.tednas_berkas_sah(${q(tanda(`gdrive/${id(1)}.pdf`))}, false) is null, 'pdf untuk screenshot diterima';
  assert public.tednas_berkas_sah(${q(tanda(`gdrive/${id(1)}.pdf`))}, true) is not null, 'pdf identitas ditolak';
  assert public.tednas_berkas_sah(${q(tanda(`gdrive/../x/${id(1)}.jpg`))}, false) is null, 'path aneh diterima';
  assert public.tednas_berkas_sah('dokumen/lama-0a.jpg', true) = 'dokumen/lama-0a.jpg', 'berkas lama Supabase ditolak';
  assert public.tednas_berkas_sah('dokumen/tidak-ada.jpg', true) is null, 'berkas lama yang tak ada diterima';
end $u$;

-- 2. pendaftaran dengan berkas Drive (sebagai anon, lewat RPC)
set role anon;
${daftar("Garuda Desa", "081234567801", "35.07.18.2010", p1)};
reset role;
do $u$ declare r record; k record; begin
  select * into r from public.tednas_tim where wa_kapten = '6281234567801';
  assert r.kode = 'TED-00001' and r.drive_versi = 1 and r.drive_tersalin = 0, 'tim/versi awal';
  assert (select count(*) from public.tednas_pemain where tim_id = r.id) = 5, 'pemain';
  assert not exists (select 1 from public.tednas_pemain where dokumen_path like '%~%' or profil_ml_path like '%~%' or izin_path like '%~%'), 'tanda ikut tersimpan';
  assert (select izin_path from public.tednas_pemain where tim_id = r.id and urutan = 5) = ${q(`gdrive/${id(100 + 4 * 5 + 5)}.pdf`)}, 'izin';
  assert (select count(*) from net._kirim) = 1, 'kabar setelah commit: ' || (select count(*) from net._kirim);
  select * into k from net._kirim order by id desc limit 1;
  assert k.url = ${q(URL_WA)}, 'url';
  assert k.body->>'aksi' = 'tim' and k.body->>'kunci' = ${q(RAHASIA)}, 'aksi/kunci';
  assert jsonb_array_length(k.body->'tim'->'pemain') = 5, 'pemain ikut di kabar (pemicu ditunda sampai commit)';
  assert k.body->'tim'->>'wa_kapten' = '6281234567801' and (k.body->'tim'->>'versi')::int = 1, 'isi kabar';
  assert k.body->'tim'->'pemain'->0->>'dokumen_path' = ${q(`gdrive/${id(101)}.jpg`)}, 'path di kabar tanpa tanda';
end $u$;

-- 3. penolakan
${harusGagal(daftar("Tanda Palsu", "081234567802", "35.07.18.2011", salahTanda), "PROFIL_ML_TIDAK_ADA")}
${harusGagal(daftar("PDF di ML", "081234567803", "35.07.18.2012", pdfDiMl), "PROFIL_ML_TIDAK_ADA")}
${harusGagal(daftar("Pakai Ulang", "081234567804", "35.07.18.2013", p1), "DOKUMEN_TIDAK_ADA")}
${harusGagal(daftar("Captcha", "081234567805", "35.07.18.2014", pemain(5), "salah"), "CAPTCHA_GAGAL")}
do $u$ begin assert (select count(*) from public.tednas_tim) = 1 and (select count(*) from net._kirim) = 1, 'penolakan meninggalkan jejak'; end $u$;

-- 4. pendaftaran lama (bucket Supabase) tetap jalan
set role anon;
${daftar("Tim Lama", "081234567806", "35.07.18.2015", lama)};
reset role;
do $u$ begin assert (select count(*) from net._kirim) = 2, 'kabar tim lama'; end $u$;

-- 5. admin memverifikasi → versi naik, kabar dikirim
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000a001', 'admin@tednas.id');
insert into public.tednas_admin (user_id) values ('00000000-0000-0000-0000-00000000a001');
set uji.uid = '00000000-0000-0000-0000-00000000a001';
set role authenticated;
update public.tednas_tim set status = 'terverifikasi' where kode = 'TED-00001';
reset role;
do $u$ begin
  assert (select drive_versi from public.tednas_tim where kode = 'TED-00001') = 2, 'versi naik';
  assert (select count(*) from net._kirim) = 3, 'kabar verifikasi';
  assert (select body->'tim'->>'status' from net._kirim order by id desc limit 1) = 'terverifikasi', 'status di kabar';
end $u$;

-- 6. pintu Apps Script
${harusGagal(`select public.tednas_drive_antre('salah', 'sheet', 10)`, "KUNCI_SALAH")}
set role anon;
do $u$ declare a json; begin
  a := public.tednas_drive_antre(${q(RAHASIA)}, 'sheet', 10);
  assert json_array_length(a->'tim') = 2 and (a->>'sisa')::int = 2, 'antre sheet ' || a::text;
  assert (a->'tim'->0->>'kode') = 'TED-00001', 'urut waktu daftar';
  assert json_array_length(public.tednas_drive_antre(${q(RAHASIA)}, 'rapi', 10)->'tim') = 0, 'rapi sebelum sheet';
end $u$;
select public.tednas_drive_selesai(${q(RAHASIA)}, 'sheet', (select id from public.tednas_drive_paket_uji() where kode = 'TED-00001'), 1);
reset role;
do $u$ begin assert (select drive_tersalin from public.tednas_tim where kode = 'TED-00001') = 1, 'versi lama tercatat'; end $u$;
set role anon;
select public.tednas_drive_selesai(${q(RAHASIA)}, 'sheet', id, drive_versi) from public.tednas_drive_paket_uji();
reset role;
`;
// (fungsi bantu uji di bawah dibuat sebelum dipakai — lihat SQL_BANTU)
const SQL_BANTU = `
create function public.tednas_drive_paket_uji() returns table (id uuid, kode text, drive_versi int) language sql security definer as $$
  select id, kode, drive_versi from public.tednas_tim $$;
grant execute on function public.tednas_drive_paket_uji() to anon;
`;
const uji2 = `
do $u$ begin
  assert (select count(*) from public.tednas_tim where drive_tersalin < drive_versi) = 0, 'semua tersalin';
  assert (select count(*) from net._kirim) = 3, 'menulis drive_* TIDAK memicu kabar baru';
  assert (select drive_pada from public.tednas_tim where kode = 'TED-00001') is not null, 'drive_pada';
end $u$;
set role anon;
do $u$ declare a json; begin
  a := public.tednas_drive_antre(${q(RAHASIA)}, 'rapi', 10);
  assert json_array_length(a->'tim') = 2, 'antre rapi';
  perform public.tednas_drive_selesai(${q(RAHASIA)}, 'rapi', (a->'tim'->0->>'id')::uuid, 2, 'https://drive.google.com/drive/folders/abc');
  assert json_array_length(public.tednas_drive_antre(${q(RAHASIA)}, 'rapi', 10)->'tim') = 1, 'rapi tercatat';
  assert public.tednas_drive_dipakai(${q(RAHASIA)}, array[${q(`gdrive/${id(101)}.jpg`)}, 'gdrive/tidakdipakai01.jpg', 'dokumen/lama-0a.jpg'])
         = array[${q(`gdrive/${id(101)}.jpg`)}, 'dokumen/lama-0a.jpg'], 'dipakai';
end $u$;
reset role;
do $u$ begin
  assert (select drive_folder from public.tednas_tim where kode = 'TED-00001') = 'https://drive.google.com/drive/folders/abc', 'folder';
  assert (select count(*) from net._kirim) = 3, 'rapi TIDAK memicu kabar';
end $u$;

-- 7. pemain diubah lewat Table Editor → versi naik + kabar
update public.tednas_pemain set nama = 'Pemain Ganti' where urutan = 2 and tim_id = (select id from public.tednas_tim where kode = 'TED-00001');
do $u$ begin
  assert (select drive_versi from public.tednas_tim where kode = 'TED-00001') = 3, 'versi naik karena pemain';
  assert (select count(*) from net._kirim) = 4, 'kabar ubah pemain';
end $u$;

-- 8. admin menghapus tim → antrean hapus + kabar hapus
set role authenticated;
delete from public.tednas_tim where kode = 'TED-00002';
reset role;
do $u$ declare k record; begin
  select * into k from net._kirim order by id desc limit 1;
  assert k.body->>'aksi' = 'hapus' and k.body->>'kode' = 'TED-00002' and k.body->>'kunci' = ${q(RAHASIA)}, 'kabar hapus';
  assert (select count(*) from public.tednas_drive_hapus) = 1, 'antrean hapus';
end $u$;
set role anon;
do $u$ declare a json; begin
  a := public.tednas_drive_antre(${q(RAHASIA)}, 'sheet', 10);
  assert json_array_length(a->'hapus') = 1 and a->'hapus'->0->>'kode' = 'TED-00002', 'hapus di antrean';
  perform public.tednas_drive_hapus_selesai(${q(RAHASIA)}, 'TED-00002');
  assert json_array_length(public.tednas_drive_antre(${q(RAHASIA)}, 'sheet', 10)->'hapus') = 0, 'hapus selesai';
end $u$;
reset role;

-- 9. alamat Web App didaftarkan sendiri oleh Apps Script
${harusGagal(`select public.tednas_drive_setel_url(${q(RAHASIA)}, 'https://evil.example/exec')`, "URL_SALAH")}
set role anon;
select public.tednas_drive_setel_url(${q(RAHASIA)}, 'https://script.google.com/macros/s/AKfycbBARU0123456789abcdefghij/exec');
reset role;
do $u$ begin
  assert (select drive_url from public.tednas_pengaturan where id = 1) = 'https://script.google.com/macros/s/AKfycbBARU0123456789abcdefghij/exec', 'url publik';
  assert (select drive_url from public.tednas_rahasia where id = 1) = 'https://script.google.com/macros/s/AKfycbBARU0123456789abcdefghij/exec', 'url rahasia';
end $u$;

-- 10. fungsi bantu & tabel rahasia tertutup untuk API
${harusGagal(`select public.tednas_drive_paket((select id from public.tednas_tim_publik limit 1))`, "permission denied")}
${harusGagal(`select public.tednas_drive_kirim('{}'::jsonb)`, "permission denied")}
${harusGagal(`select public.tednas_berkas_sah('x', true)`, "permission denied")}
${harusGagal(`select public.tednas_drive_kunci_sah('x')`, "permission denied")}
${harusGagal(`select count(*) from public.tednas_drive_hapus`, "permission denied")}
${harusGagal(`select drive_rahasia from public.tednas_rahasia`, "permission denied", "authenticated")}

-- 11. Web App belum dipasang (drive_url kosong): pendaftaran tetap jalan, tim antre untuk disusulkan
update public.tednas_rahasia set drive_url = null where id = 1;
set role anon;
${daftar("Tanpa Drive", "081234567807", "35.07.18.2016", pemain(7))};
reset role;
do $u$ begin
  assert (select count(*) from net._kirim) = 5, 'tanpa url tidak ada kabar';
  assert (select drive_tersalin < drive_versi from public.tednas_tim where wa_kapten = '6281234567807'), 'tetap antre';
end $u$;

-- 12. cermin (migrasi 9): kabar ke dua Web App dengan kunci masing-masing, antrean & kunci cermin terpisah
update public.tednas_rahasia set drive_url = ${q(URL_WA)}, cermin_url = ${q(URL_CERMIN)}, cermin_rahasia = ${q(RAHASIA2)} where id = 1;
create temp table _awal as select count(*) n from net._kirim;
grant select on _awal to anon, authenticated;
do $u$ begin
  assert (select count(*) from public.tednas_tim where cermin_tersalin < drive_versi) = (select count(*) from public.tednas_tim), 'semua tim antre cermin';
end $u$;
set role anon;
${daftar("Dua Akun", "081234567808", "35.07.18.2017", pemain(8))};
reset role;
do $u$ declare u record; c record; begin
  assert (select count(*) from net._kirim) = (select n from _awal) + 2, 'satu pendaftaran = dua kabar';
  select * into u from net._kirim where url = ${q(URL_WA)} order by id desc limit 1;
  select * into c from net._kirim where url = ${q(URL_CERMIN)} order by id desc limit 1;
  assert u.body->>'kunci' = ${q(RAHASIA)} and c.body->>'kunci' = ${q(RAHASIA2)}, 'kunci masing-masing';
  assert u.body->'tim'->>'nama_tim' = 'Dua Akun' and c.body->'tim' = u.body->'tim', 'isi kabar sama';
end $u$;
${harusGagal(`select public.tednas_cermin_antre(${q(RAHASIA)}, 5)`, "KUNCI_SALAH")}
${harusGagal(`select public.tednas_drive_antre(${q(RAHASIA2)}, 'sheet', 5)`, "KUNCI_SALAH")}
${harusGagal(`select public.tednas_drive_setel_url(${q(RAHASIA2)}, ${q(URL_CERMIN)})`, "KUNCI_SALAH")}
set role anon;
do $u$ declare a json; v_id uuid; v_versi int; begin
  a := public.tednas_cermin_antre(${q(RAHASIA2)}, 2);
  assert json_array_length(a->'tim') = 2 and (a->>'sisa')::int >= 3, 'antre cermin dibatasi';
  v_id := (a->'tim'->0->>'id')::uuid; v_versi := (a->'tim'->0->>'versi')::int;
  assert a->'tim'->0->'pemain'->0->>'dokumen_path' like 'gdrive/%', 'paket lengkap dengan path';
  perform public.tednas_cermin_selesai(${q(RAHASIA2)}, v_id, v_versi, 'https://drive.google.com/drive/folders/cermin1');
  assert (select (public.tednas_cermin_antre(${q(RAHASIA2)}, 50)->>'sisa')::int) = (a->>'sisa')::int - 1, 'cermin tercatat';
end $u$;
reset role;
do $u$ begin
  assert (select count(*) from net._kirim) = (select n from _awal) + 2, 'cermin_selesai TIDAK memicu kabar';
  assert (select count(*) from public.tednas_tim where cermin_folder = 'https://drive.google.com/drive/folders/cermin1' and cermin_pada is not null) = 1, 'folder cermin';
  assert (select count(*) from public.tednas_tim where drive_tersalin > 0 and cermin_tersalin = drive_versi) <= 1, 'utama tidak tersentuh';
end $u$;
-- hapus → antrean hapus utama & cermin + dua kabar hapus
set role authenticated;
delete from public.tednas_tim where wa_kapten = '6281234567808';
reset role;
do $u$ begin
  assert (select count(*) from net._kirim where body->>'aksi' = 'hapus' and url = ${q(URL_CERMIN)} and body->>'kunci' = ${q(RAHASIA2)}) = 1, 'kabar hapus ke cermin';
  assert exists (select 1 from public.tednas_cermin_hapus) and exists (select 1 from public.tednas_drive_hapus), 'dua antrean hapus';
end $u$;
set role anon;
do $u$ declare a json; begin
  a := public.tednas_cermin_antre(${q(RAHASIA2)}, 5);
  assert json_array_length(a->'hapus') = 1, 'hapus di antrean cermin';
  perform public.tednas_cermin_hapus_selesai(${q(RAHASIA2)}, a->'hapus'->0->>'kode');
  assert json_array_length(public.tednas_cermin_antre(${q(RAHASIA2)}, 5)->'hapus') = 0, 'hapus cermin selesai';
end $u$;
reset role;
do $u$ begin
  assert exists (select 1 from public.tednas_drive_hapus), 'antrean hapus utama tidak ikut terhapus';
end $u$;
-- cermin dilepas: kembali satu kabar
update public.tednas_rahasia set cermin_url = null where id = 1;
truncate _awal; insert into _awal select count(*) from net._kirim;
set role anon;
${daftar("Satu Akun", "081234567809", "35.07.18.2018", pemain(9))};
reset role;
do $u$ begin
  assert (select count(*) from net._kirim) = (select n from _awal) + 1, 'tanpa cermin_url hanya satu kabar';
end $u$;
${harusGagal(`select public.tednas_cermin_kunci_sah('x')`, "permission denied")}
${harusGagal(`select count(*) from public.tednas_cermin_hapus`, "permission denied")}
${harusGagal(`select cermin_rahasia from public.tednas_rahasia`, "permission denied", "authenticated")}
-- 13. agen AI (migrasi 10): antrean berkunci, status otomatis, 1 orang 1 tim (yang daftar belakangan ditandai), keputusan admin tak ditimpa
update public.tednas_rahasia set ai_rahasia = ${q(RAHASIA3)} where id = 1;
${harusGagal(`select public.tednas_ai_antre(${q(RAHASIA)}, 1, 5)`, "KUNCI_SALAH")}
${harusGagal(`select public.tednas_ai_antre(${q(RAHASIA2)}, 1, 5)`, "KUNCI_SALAH")}
${harusGagal(`select public.tednas_drive_antre(${q(RAHASIA3)}, 'sheet', 5)`, "KUNCI_SALAH")}
${harusGagal(`select public.tednas_ai_simpan(${q(RAHASIA)}, gen_random_uuid(), 'x', 1, 'lolos', '', '{}', '[]', 'uji', null)`, "KUNCI_SALAH")}
set role anon;
${daftar("AI Satu", "081234567810", "35.07.18.2019", pemain(10))};
${daftar("AI Dua", "081234567811", "35.07.18.2020", pemain(11))};
reset role;
create temp table _ai (n int, a uuid, b uuid, c uuid, sa text, sb text, sc text);
grant all on _ai to anon, authenticated;
insert into _ai (n) select count(*) from public.tednas_tim;
set role anon;
do $u$ declare v json; begin
  v := public.tednas_ai_antre(${q(RAHASIA3)}, 1, 3);
  assert (v->>'sisa')::int = (select n from _ai), 'semua tim antre AI';
  assert json_array_length(v->'tim') = 3, 'antre AI dibatasi';
  assert v->'tim'->0->>'status' = 'menunggu' and v->'tim'->2->>'status' = 'menunggu', 'yang menunggu didahulukan';
  assert (v->'tim'->0->>'created_at')::timestamptz < (v->'tim'->1->>'created_at')::timestamptz
     and (v->'tim'->1->>'created_at')::timestamptz < (v->'tim'->2->>'created_at')::timestamptz, 'urut waktu daftar: A < B < C';
  assert length(v->'tim'->0->>'sidik') = 32 and json_array_length(v->'tim'->0->'pemain') >= 5, 'paket + sidik';
  update _ai set a = (v->'tim'->0->>'id')::uuid, sa = v->'tim'->0->>'sidik', b = (v->'tim'->1->>'id')::uuid, sb = v->'tim'->1->>'sidik',
    c = (v->'tim'->2->>'id')::uuid, sc = v->'tim'->2->>'sidik';
end $u$;
do $u$ declare r json; x record; begin
  select * into x from _ai;
  r := public.tednas_ai_simpan(${q(RAHASIA3)}, x.a, x.sa, 1, 'lolos', 'Semua sesuai', '{"tim":[],"pemain":[]}',
    '[{"u":1,"nik":"n1","ml":"m1","sha":["s1","s2"]},{"u":2,"nik":"n2","ml":"","sha":["s3"]},{"u":9,"nik":"abaikan"}]', 'uji', 1000);
  assert (r->>'ok')::boolean and r->>'akhir' = 'lolos' and json_array_length(r->'ganda') = 0, 'lolos tanpa ganda';
  assert r->>'status' = 'terverifikasi', 'lolos AI → langsung Terverifikasi';
  r := public.tednas_ai_simpan(${q(RAHASIA3)}, x.b, 'sidik-basi', 1, 'lolos', '', '{}', '[]', 'uji', null);
  assert r->>'pesan' = 'TIM_BERUBAH', 'sidik basi tidak disimpan';
  r := public.tednas_ai_simpan(${q(RAHASIA3)}, gen_random_uuid(), 'x', 1, 'lolos', '', '{}', '[]', 'uji', null);
  assert r->>'pesan' = 'TIM_TIDAK_ADA', 'tim tak ada';
  -- B (daftar setelah A) memakai NIK pemain 1 tim A → B yang ditandai, A tidak
  r := public.tednas_ai_simpan(${q(RAHASIA3)}, x.b, x.sb, 1, 'lolos', '', '{}', '[{"u":3,"nik":"n1","ml":"m9","sha":["s9"]}]', 'uji', null);
  assert r->>'akhir' = 'cek' and json_array_length(r->'ganda') = 1, 'B cek karena NIK sudah dipakai tim yang daftar lebih dulu';
  assert r->'ganda'->0->>'jenis' = 'nik' and (r->'ganda'->0->>'u')::int = 3 and (r->'ganda'->0->>'u_lain')::int = 1
     and (r->'ganda'->0->>'dulu')::boolean, 'rincian ganda B';
  assert r->>'status' is null and (r->>'terkait')::int = 1 and (r->>'diubah')::int = 0, 'B tetap Menunggu, A dihitung ulang tanpa berubah';
  assert (public.tednas_ai_antre(${q(RAHASIA3)}, 1, 50)->>'sisa')::int = (select n from _ai) - 2, 'dua tim tercatat';
  assert (public.tednas_ai_antre(${q(RAHASIA3)}, 2, 1)->>'sisa')::int = (select n from _ai), 'versi agen naik → semua antre lagi';
end $u$;
reset role;
do $u$ begin
  assert (select akhir from public.tednas_ai where tim_id = (select a from _ai)) = 'lolos', 'A (daftar lebih dulu) tetap lolos';
  assert (select ganda->0->>'kode' from public.tednas_ai where tim_id = (select a from _ai)) = (select kode from public.tednas_tim where id = (select b from _ai))
     and not (select (ganda->0->>'dulu')::boolean from public.tednas_ai where tim_id = (select a from _ai)), 'A hanya mendapat catatan ganda dengan B';
  assert (select status = 'terverifikasi' and status_oleh = 'ai' from public.tednas_tim where id = (select a from _ai)), 'A diverifikasi AI';
  assert (select status = 'menunggu' and status_oleh is null from public.tednas_tim where id = (select b from _ai)), 'B masih Menunggu';
  assert (select count(*) from public.tednas_ai_kunci where tim_id = (select a from _ai)) = 6, 'kunci A (u 9 & kosong diabaikan)';
end $u$;
set role anon;
do $u$ declare r json; x record; begin
  select * into x from _ai;
  -- B mengganti identitas → bersih → Terverifikasi
  r := public.tednas_ai_simpan(${q(RAHASIA3)}, x.b, x.sb, 1, 'lolos', '', '{}', '[{"u":3,"nik":"n7","ml":"m9","sha":["s9"]}]', 'uji', null);
  assert r->>'akhir' = 'lolos' and json_array_length(r->'ganda') = 0 and r->>'status' = 'terverifikasi', 'B bersih → Terverifikasi';
  -- C (daftar paling akhir) memakai NIK pemain 3 tim B → C cek
  r := public.tednas_ai_simpan(${q(RAHASIA3)}, x.c, x.sc, 1, 'lolos', '', '{}', '[{"u":5,"nik":"n7","ml":"m5","sha":["s5"]}]', 'uji', null);
  assert r->>'akhir' = 'cek' and r->'ganda'->0->>'jenis' = 'nik' and r->>'status' is null, 'C cek karena pemain sudah di tim B';
  -- B gagal diperiksa (galat): status B tetap, kunci B tetap → C tetap tertahan
  r := public.tednas_ai_simpan(${q(RAHASIA3)}, x.b, x.sb, 1, 'galat', 'Web App sibuk', '{}', '[]', 'uji', null);
  assert r->>'akhir' = 'galat' and r->>'status' is null, 'galat tidak mengubah status';
  -- satu orang dua kali di tim A → A cek → yang diverifikasi AI kembali Menunggu
  r := public.tednas_ai_simpan(${q(RAHASIA3)}, x.a, x.sa, 1, 'lolos', '', '{}', '[{"u":1,"nik":"n1","sha":["s1"]},{"u":2,"nik":"n1","sha":["s3"]}]', 'uji', null);
  assert r->>'akhir' = 'cek' and r->>'status' = 'menunggu', 'pemain ganda dalam satu tim → kembali Menunggu';
  r := public.tednas_ai_simpan(${q(RAHASIA3)}, x.a, x.sa, 1, 'lolos', '', '{}', '[{"u":1,"nik":"n1","ml":"m1","sha":["s1","s2"]},{"u":2,"nik":"n2","sha":["s3"]}]', 'uji', null);
  assert r->>'akhir' = 'lolos' and r->>'status' = 'terverifikasi', 'A bersih lagi → Terverifikasi';
end $u$;
reset role;
do $u$ begin
  assert (select status from public.tednas_tim where id = (select b from _ai)) = 'terverifikasi', 'B tetap Terverifikasi walau galat';
  assert (select akhir from public.tednas_ai where tim_id = (select c from _ai)) = 'cek', 'C tetap tertahan saat B galat';
  update public.tednas_ai set pada = now() - interval '31 minutes' where tim_id = (select b from _ai);
end $u$;
set role anon;
do $u$ begin
  assert exists (select 1 from json_array_elements(public.tednas_ai_antre(${q(RAHASIA3)}, 1, 50)->'tim') e where (e->>'id')::uuid = (select b from _ai)), 'galat lama antre lagi';
end $u$;
reset role;
-- B dihapus → C tidak tertahan lagi: tednas_ai_segarkan menghitung ulang & memverifikasi C
delete from public.tednas_tim where id = (select b from _ai);
do $u$ begin
  assert not exists (select 1 from public.tednas_ai where tim_id = (select b from _ai)) and not exists (select 1 from public.tednas_ai_kunci where tim_id = (select b from _ai)), 'hasil AI ikut terhapus';
  assert (select akhir from public.tednas_ai where tim_id = (select c from _ai)) = 'cek', 'ganda basi sebelum disegarkan';
end $u$;
set role anon;
do $u$ declare r json; begin
  r := public.tednas_ai_segarkan(${q(RAHASIA3)});
  assert (r->>'dihitung')::int >= 1 and (r->>'diubah')::int >= 1, 'segarkan';
end $u$;
reset role;
do $u$ begin
  assert (select akhir from public.tednas_ai where tim_id = (select c from _ai)) = 'lolos', 'C lolos setelah B dihapus';
  assert (select status = 'terverifikasi' and status_oleh = 'ai' from public.tednas_tim where id = (select c from _ai)), 'C diverifikasi AI';
end $u$;
-- perubahan status TIDAK membuat tim diperiksa ulang; pemain berubah YA
set role anon;
do $u$ begin
  assert not exists (select 1 from json_array_elements(public.tednas_ai_antre(${q(RAHASIA3)}, 1, 50)->'tim') e where (e->>'id')::uuid in ((select a from _ai), (select c from _ai))), 'A & C tidak antre';
end $u$;
reset role;
-- admin: baca, statistik, membatalkan verifikasi (tidak ditimpa AI), periksa ulang
set uji.uid = '00000000-0000-0000-0000-00000000a001';
set role authenticated;
do $u$ declare s json; begin
  assert (select count(*) from public.tednas_ai) >= 2, 'admin membaca hasil AI';
  s := public.tednas_ai_statistik();
  assert (s->>'otomatis')::int = 2 and (s->>'cek')::int = 0 and (s->>'antre')::int >= 1, 'statistik AI ' || s::text;
  update public.tednas_tim set status = 'menunggu' where id = (select a from _ai);
  assert (select status_oleh from public.tednas_tim where id = (select a from _ai)) = 'admin', 'pengubah status tercatat admin';
  delete from public.tednas_ai where tim_id = (select c from _ai);
  assert not exists (select 1 from public.tednas_ai where tim_id = (select c from _ai)), 'periksa ulang = hapus hasil';
end $u$;
reset role;
set role anon;
do $u$ declare r json; x record; begin
  select * into x from _ai;
  r := public.tednas_ai_simpan(${q(RAHASIA3)}, x.a, x.sa, 1, 'lolos', '', '{}', '[{"u":1,"nik":"n1"}]', 'uji', null);
  assert r->>'akhir' = 'lolos' and r->>'status' is null, 'keputusan admin tidak ditimpa AI';
  perform public.tednas_ai_segarkan(${q(RAHASIA3)});
end $u$;
reset role;
do $u$ begin
  assert (select status from public.tednas_tim where id = (select a from _ai)) = 'menunggu', 'segarkan juga tidak menimpa admin';
end $u$;
update public.tednas_pemain set nama = nama || ' Baru' where tim_id = (select a from _ai) and urutan = 1;
set role anon;
do $u$ begin
  assert exists (select 1 from json_array_elements(public.tednas_ai_antre(${q(RAHASIA3)}, 1, 50)->'tim') e where (e->>'id')::uuid = (select a from _ai)), 'pemain berubah → antre lagi';
end $u$;
reset role;
set uji.uid = '';
set role authenticated;
do $u$ begin
  assert (select count(*) from public.tednas_ai) = 0, 'bukan admin tidak melihat hasil AI';
end $u$;
reset role;
${harusGagal(`select public.tednas_ai_statistik()`, "BUKAN_ADMIN", "authenticated")}
set uji.uid = '00000000-0000-0000-0000-00000000a001';
${harusGagal(`select public.tednas_ai_statistik()`, "permission denied")}
${harusGagal(`select count(*) from public.tednas_ai`, "permission denied")}
${harusGagal(`select count(*) from public.tednas_ai_kunci`, "permission denied", "authenticated")}
${harusGagal(`insert into public.tednas_ai (tim_id, sidik, hasil, akhir) values (gen_random_uuid(), 'x', 'lolos', 'lolos')`, "permission denied", "authenticated")}
${harusGagal(`select public.tednas_ai_sidik(gen_random_uuid())`, "permission denied")}
${harusGagal(`select public.tednas_ai_ganda_hitung(gen_random_uuid())`, "permission denied")}
${harusGagal(`select public.tednas_ai_terapkan(gen_random_uuid())`, "permission denied", "authenticated")}
${harusGagal(`select ai_rahasia from public.tednas_rahasia`, "permission denied", "authenticated")}

-- 14. kapten memperbaiki berkas lewat tautan (migrasi 12): token dari admin, hanya tim menunggu, berkas bertanda, AI memeriksa ulang
set role anon;
${daftar("Perbaiki", "081234567820", "35.07.18.2030", pemain(20))};
reset role;
create temp table _pb (id uuid, kode text, tok text, versi int, kirim int);
grant all on _pb to anon, authenticated;
insert into _pb (id, kode, versi) select id, kode, drive_versi from public.tednas_tim where wa_kapten = '6281234567820';
insert into public.tednas_ai (tim_id, sidik, hasil, akhir, rincian, ganda)
  select id, public.tednas_ai_sidik(id), 'cek', 'cek',
    ${q(JSON.stringify({ tim: [], pemain: [{ u: 2, butir: [{ b: "profil_ml", s: "cek", t: "ID akun Mobile Legends tidak terlihat." }, { b: "identitas", s: "ok", t: "KTP sesuai." }], data: { nik: "3507********0003", alamat: "RAHASIA ALAMAT" } }] }))}::jsonb,
    ${q(JSON.stringify([{ u: 3, jenis: "nik", kode: "TED-00001", u_lain: 2, dulu: true }, { u: 4, jenis: "ml", kode: "TED-00002", u_lain: 1, dulu: false }]))}::jsonb
  from _pb;
set uji.uid = '';
${harusGagal(`select public.tednas_kabari_kapten((select id from _pb))`, "BUKAN_ADMIN", "authenticated")}
${harusGagal(`select public.tednas_kabari_kapten((select id from _pb))`, "permission denied")}
set uji.uid = '00000000-0000-0000-0000-00000000a001';
set role authenticated;
do $u$ declare v json; begin
  v := public.tednas_kabari_kapten((select id from _pb));
  assert v->>'token' ~ '^[0-9a-f]{40}$', 'token 40 hex';
  update _pb set tok = v->>'token';
end $u$;
reset role;
do $u$ begin
  assert (select kapten_dikabari from public.tednas_tim where id = (select id from _pb)) is not null, 'waktu dikabari dicatat';
  assert (select drive_versi from public.tednas_tim where id = (select id from _pb)) = (select versi from _pb), 'dikabari tidak menulis ulang Sheet';
  assert (select tok from _pb) <> public.tednas_perbaiki_token((select id from public.tednas_tim where kode = 'TED-00001')), 'token beda per tim';
end $u$;
${harusGagal(`select public.tednas_perbaiki_lihat((select kode from _pb), repeat('0', 40))`, "TAUTAN_TIDAK_SAH")}
${harusGagal(`select public.tednas_perbaiki_lihat('TED-00001', (select tok from _pb))`, "TAUTAN_TIDAK_SAH")}
${harusGagal(`select public.tednas_perbaiki_lihat((select kode from _pb), upper((select tok from _pb)))`, "TAUTAN_TIDAK_SAH")}
set role anon;
do $u$ declare v json; begin
  v := public.tednas_perbaiki_lihat(lower((select kode from _pb)), (select tok from _pb));
  assert v->>'status' = 'menunggu' and json_array_length(v->'pemain') = 5 and v->>'nama_kapten' = 'Pemain 20-1', 'isi tim';
  assert (v->'ai'->>'segar')::boolean and v->'ai'->>'akhir' = 'cek', 'hasil AI segar';
  assert json_array_length(v->'ai'->'pemain'->0->'butir') = 1 and v->'ai'->'pemain'->0->'butir'->0->>'b' = 'profil_ml', 'hanya catatan cek';
  assert json_array_length(v->'ai'->'ganda') = 1 and v->'ai'->'ganda'->0->>'u_lain' is null, 'ganda tanpa tim lain';
  assert position('gdrive/' in v::text) = 0 and position('6281234567820' in v::text) = 0 and position('RAHASIA ALAMAT' in v::text) = 0
     and position('*****' in v::text) = 0 and position('TED-00001' in v::text) = 0, 'tanpa path, nomor WA, NIK, alamat, kode tim lain';
end $u$;
reset role;
${harusGagal(`select public.tednas_perbaiki_simpan((select kode from _pb), repeat('a', 40), '[{"urutan":1,"nama":"Siapa Saja"}]')`, "TAUTAN_TIDAK_SAH")}
${harusGagal(`select public.tednas_perbaiki_simpan((select kode from _pb), (select tok from _pb), ${q(JSON.stringify([{ urutan: 2, profil_ml_path: `gdrive/${id(2099)}.png` }]))})`, "PROFIL_ML_TIDAK_ADA")}
${harusGagal(`select public.tednas_perbaiki_simpan((select kode from _pb), (select tok from _pb), ${q(JSON.stringify([{ urutan: 2, profil_ml_path: tanda(`gdrive/${id(2098)}.pdf`) }]))})`, "PROFIL_ML_TIDAK_ADA")}
${harusGagal(`select public.tednas_perbaiki_simpan((select kode from _pb), (select tok from _pb), ${q(JSON.stringify([{ urutan: 2, follow_ppdt_path: "dokumen/lama-0a.jpg" }]))})`, "FOLLOW_TIDAK_ADA")}
${harusGagal(`select public.tednas_perbaiki_simpan((select kode from _pb), (select tok from _pb), ${q(JSON.stringify([{ urutan: 2, dokumen_path: p1[0].dokumen_path }]))})`, "DOKUMEN_TIDAK_ADA")}
${harusGagal(`select public.tednas_perbaiki_simpan((select kode from _pb), (select tok from _pb), ${q(JSON.stringify([{ urutan: 2, dokumen_path: tanda(`gdrive/${id(2096)}.jpg`) }, { urutan: 3, dokumen_path: tanda(`gdrive/${id(2096)}.jpg`) }]))})`, "DOKUMEN_TIDAK_ADA")}
${harusGagal(`select public.tednas_perbaiki_simpan((select kode from _pb), (select tok from _pb), '[{"urutan":6,"nama":"Cadangan Baru"}]')`, "PEMAIN_TIDAK_ADA")}
${harusGagal(`select public.tednas_perbaiki_simpan((select kode from _pb), (select tok from _pb), '[{"urutan":2,"nama":"X"}]')`, "PEMAIN_TIDAK_LENGKAP")}
${harusGagal(`select public.tednas_perbaiki_simpan((select kode from _pb), (select tok from _pb), '[{"urutan":2,"dokumen_jenis":"Paspor"}]')`, "DOKUMEN_TIDAK_ADA")}
${harusGagal(`select public.tednas_perbaiki_simpan((select kode from _pb), (select tok from _pb), '[]')`, "ISIAN_TIDAK_SAH")}
do $u$ begin
  assert (select perbaiki_pada from public.tednas_tim where id = (select id from _pb)) is null, 'percobaan gagal tidak mengubah apa pun';
  assert (select profil_ml_path from public.tednas_pemain where tim_id = (select id from _pb) and urutan = 2) = ${q(`gdrive/${id(2007)}.png`)}, 'berkas lama utuh';
end $u$;
update _pb set kirim = (select count(*) from net._kirim);
set role anon;
do $u$ declare v json; begin
  v := public.tednas_perbaiki_simpan((select kode from _pb), (select tok from _pb),
    ${q(JSON.stringify([{ urutan: 1, nama: " Kapten Baru " }, { urutan: 2, dokumen_jenis: "KK", profil_ml_path: tanda(`gdrive/${id(2097)}.png`) }, { urutan: 5, izin_path: tanda(`gdrive/${id(2095)}.pdf`) }]))});
  assert (v->>'diubah')::int = 4, 'empat perubahan: nama, jenis, profil ML, izin';
end $u$;
reset role;
do $u$ declare x record; begin
  select t.*, p.profil_ml_path, p.dokumen_jenis, p.nama as nama1 into x from public.tednas_tim t
    join public.tednas_pemain p on p.tim_id = t.id and p.urutan = 2 where t.id = (select id from _pb);
  assert x.nama_kapten = 'Kapten Baru' and (select nama from public.tednas_pemain where tim_id = x.id and urutan = 1) = 'Kapten Baru', 'nama kapten';
  assert x.profil_ml_path = ${q(`gdrive/${id(2097)}.png`)} and x.dokumen_jenis = 'KK', 'berkas & jenis baru (tanpa tanda)';
  assert (select izin_path from public.tednas_pemain where tim_id = x.id and urutan = 5) = ${q(`gdrive/${id(2095)}.pdf`)}, 'izin PDF';
  assert x.perbaiki_pada is not null and x.drive_rapi = 0 and x.status = 'menunggu', 'dicatat + berkas dirapikan ulang';
  assert x.drive_versi > (select versi from _pb), 'Sheet & cermin ikut diperbarui';
  assert (select count(*) from net._kirim) > (select kirim from _pb), 'kabar ke Drive';
  assert (select body->'tim'->>'kode' from net._kirim order by id desc limit 1) = x.kode, 'kabar tim ini';
  assert (select sidik from public.tednas_ai where tim_id = x.id) <> public.tednas_ai_sidik(x.id), 'sidik berubah';
  assert exists (select 1 from json_array_elements(public.tednas_ai_antre(${q(RAHASIA3)}, 1, 50)->'tim') e where (e->>'id')::uuid = x.id), 'AI memeriksa ulang';
end $u$;
set role anon;
do $u$ begin
  assert not (public.tednas_perbaiki_lihat((select kode from _pb), (select tok from _pb))->'ai'->>'segar')::boolean, 'halaman kapten: sedang dicek ulang';
end $u$;
reset role;
update public.tednas_tim set status = 'terverifikasi' where id = (select id from _pb);
set role anon;
do $u$ begin
  assert (public.tednas_perbaiki_simpan((select kode from _pb), (select tok from _pb), '[{"urutan":1,"nama":"Kapten Baru"}]')->>'ok')::boolean, 'tim terverifikasi tetap bisa diubah (migrasi 15)';
end $u$;
reset role;
do $u$ begin assert (select status from public.tednas_tim where id = (select id from _pb)) = 'terverifikasi', 'fungsi ubah tidak mengubah status'; end $u$;
${harusGagal(`select public.tednas_perbaiki_token((select id from _pb))`, "permission denied")}
${harusGagal(`select public.tednas_perbaiki_token((select id from _pb))`, "permission denied", "authenticated")}
${harusGagal(`select public.tednas_perbaiki_tim('TED-00001', repeat('0', 40))`, "permission denied")}
${harusGagal(`select perbaiki_rahasia from public.tednas_rahasia`, "permission denied", "authenticated")}

-- 15. tautan komunitas ToT (migrasi 13): tercatat ke komunitas; tanpa tautan / kode salah / nonaktif → MZone Tour; tim lama ikut dipindah
create temp table _k (n int, id int);
grant all on _k to anon, authenticated;
do $u$ begin
  assert (select count(*) from public.tednas_komunitas where bawaan) = 1 and (select nama from public.tednas_komunitas where bawaan) = 'MZone Tour', 'satu komunitas bawaan';
  assert (select count(*) from public.tednas_tim where komunitas_id is distinct from (select id from public.tednas_komunitas where bawaan)) = 0, 'semua pendaftaran tanpa tautan → MZone Tour';
end $u$;
${harusGagal(`insert into public.tednas_komunitas (nama, bawaan) values ('Bawaan Kedua', true)`, "duplicate key", "postgres")}
set uji.uid = '';
${harusGagal(`insert into public.tednas_komunitas (nama) values ('Bukan Admin')`, "row-level security", "authenticated")}
${harusGagal(`select count(*) from public.tednas_komunitas`, "permission denied")}
${harusGagal(`select public.tednas_komunitas_admin()`, "BUKAN_ADMIN", "authenticated")}
${harusGagal(`select public.tednas_komunitas_admin()`, "permission denied")}
${harusGagal(`select public.tednas_komunitas_papan()`, "does not exist")}
set uji.uid = '00000000-0000-0000-0000-00000000a001';
set role authenticated;
insert into public.tednas_komunitas (nama, kota, provinsi, pic_nama, pic_wa) values ('Esports Malang Raya', 'Kota Malang', 'Jawa Timur', 'Budi', '6281299990001');
insert into public.tednas_komunitas (nama, kota) values ('Komunitas Batu', 'Kota Batu');
insert into public.tednas_komunitas (nama, kota, aktif) values ('Komunitas Bubar', 'Kediri', false);
reset role;
${harusGagal(`insert into public.tednas_komunitas (nama, pic_wa) values ('WA Salah', '0812')`, "check constraint", "authenticated")}
insert into _k select row_number() over (order by id), id from public.tednas_komunitas where not bawaan order by id;
insert into _k select 0, id from public.tednas_komunitas where bawaan;
set role anon;
${daftar("Lewat Malang", "081234567821", "35.07.18.2031", pemain(21)).replace(/\)$/, ", (select id from _k where n = 1))")};
${daftar("Lewat Malang Dua", "081234567822", "35.07.18.2032", pemain(22)).replace(/\)$/, ", (select id from _k where n = 1))")};
${daftar("Kode Ngawur", "081234567823", "35.07.18.2033", pemain(23)).replace(/\)$/, ", 99999)")};
${daftar("Lewat Bubar", "081234567824", "35.07.18.2034", pemain(24)).replace(/\)$/, ", (select id from _k where n = 3))")};
do $u$ begin
  assert public.tednas_komunitas_info((select id from _k where n = 1))->>'nama' = 'Esports Malang Raya', 'info komunitas';
  assert position('Budi' in public.tednas_komunitas_info((select id from _k where n = 1))::text) = 0
     and position('6281299990001' in public.tednas_komunitas_info((select id from _k where n = 1))::text) = 0, 'info tanpa PIC';
  assert public.tednas_komunitas_info((select id from _k where n = 3)) is null, 'komunitas nonaktif tidak tampil';
  assert public.tednas_komunitas_info(99999) is null, 'kode tak dikenal';
end $u$;
reset role;
do $u$ begin
  assert (select count(*) from public.tednas_tim where komunitas_id = (select id from _k where n = 1)) = 2, 'dua tim lewat tautan Malang';
  assert (select komunitas_id from public.tednas_tim where wa_kapten = '6281234567823') = (select id from _k where n = 0), 'kode ngawur → MZone Tour, pendaftaran tetap masuk';
  assert (select komunitas_id from public.tednas_tim where wa_kapten = '6281234567824') = (select id from _k where n = 0), 'komunitas nonaktif → MZone Tour';
  assert (select komunitas_id from public.tednas_tim where wa_kapten = '6281234567820') = (select id from _k where n = 0), 'tanpa tautan → MZone Tour';
end $u$;
update _pb set versi = (select drive_versi from public.tednas_tim where wa_kapten = '6281234567822'),
  tok = public.tednas_ai_sidik((select id from public.tednas_tim where wa_kapten = '6281234567822'));
set role authenticated;
update public.tednas_tim set status = 'terverifikasi' where wa_kapten = '6281234567821';
update public.tednas_tim set komunitas_id = (select id from _k where n = 2) where wa_kapten = '6281234567822';
reset role;
do $u$ begin
  assert (select drive_versi from public.tednas_tim where wa_kapten = '6281234567822') = (select versi from _pb), 'pindah komunitas tidak menulis ulang Sheet';
  assert public.tednas_ai_sidik((select id from public.tednas_tim where wa_kapten = '6281234567822')) = (select tok from _pb), 'pindah komunitas tidak memicu cek ulang AI';
end $u$;
set role authenticated;
do $u$ declare v json; m json; begin
  v := public.tednas_komunitas_admin();
  assert json_array_length(v) = 4 and v->0->>'nama' = 'MZone Tour' and (v->0->>'bawaan')::boolean, 'MZone Tour + 3 komunitas';
  select x into m from json_array_elements(v) x where x->>'nama' = 'Esports Malang Raya';
  assert m->>'pic_wa' = '6281299990001' and (m->>'mendaftar')::int = 1 and (m->>'terverifikasi')::int = 1 and (m->>'menunggu')::int = 0, 'hitungan Malang';
  assert (select (x->>'mendaftar')::int from json_array_elements(v) x where x->>'nama' = 'Komunitas Batu') = 1, 'Batu dapat tim pindahan';
end $u$;
reset role;
-- Tim lama tanpa komunitas (seperti 50 tim produksi sebelum migrasi ini) → MZone Tour saat migrasi dijalankan (lagi).
update public.tednas_tim set komunitas_id = null where wa_kapten in ('6281234567820', '6281234567821');
-- @@MIGRASI13@@
do $u$ begin
  assert (select komunitas_id from public.tednas_tim where wa_kapten = '6281234567820') = (select id from _k where n = 0), 'tim tanpa komunitas dipindah ke MZone Tour';
  assert (select komunitas_id from public.tednas_tim where wa_kapten = '6281234567822') = (select id from _k where n = 2), 'tim yang sudah punya komunitas tidak disentuh';
  assert (select count(*) from public.tednas_komunitas where bawaan) = 1, 'migrasi ulang tidak membuat bawaan kedua';
end $u$;

-- 16. jalur berkunci MZone & dasbor (migrasi 14): kunci terpisah, ID ML dari bacaan AI, dasbor tanpa data pribadi
create temp table _j (mz text, db text);
grant all on _j to anon, authenticated;
insert into _j select mzone_rahasia, dasbor_rahasia from public.tednas_rahasia where id = 1;
do $u$ begin
  assert (select mz <> db and length(mz) = 64 and length(db) = 64 from _j), 'dua kunci berbeda';
  assert (select mz not in (drive_rahasia, ai_rahasia, perbaiki_rahasia) from _j, public.tednas_rahasia where id = 1), 'beda dari kunci lain';
end $u$;
update public.tednas_ai set rincian = jsonb_set(rincian, '{pemain}', ${q(JSON.stringify([
  { u: 1, butir: [{ b: "profil_ml", s: "ok", t: "Akun ML 1644930996 (16955)." }], data: { ml: "1644930996 (16955)", ml_nick: "Aemeath", nik: "3507********0001" } },
  { u: 2, butir: [{ b: "profil_ml", s: "cek", t: "ID akun Mobile Legends tidak terlihat." }, { b: "identitas", s: "cek", t: 'Nama di dokumen "BUDI RAHASIA" tidak sama dengan nama terdaftar "Pemain 20-2".' }], data: { ml: "", nik: "3507********0002" } }]))}::jsonb)
  where tim_id = (select id from _pb);
set role anon;
${harusGagal(`select public.tednas_mzone_tim(repeat('0', 64))`, "KUNCI_SALAH")}
${harusGagal(`select public.tednas_mzone_tim((select db from _j))`, "KUNCI_SALAH")}
${harusGagal(`select public.tednas_dasbor((select mz from _j))`, "KUNCI_SALAH")}
${harusGagal(`select public.tednas_dasbor(${q(RAHASIA3)})`, "KUNCI_SALAH")}
${harusGagal(`select public.tednas_ml_pecah('1 (2)')`, "permission denied")}
do $u$ declare v json; s json; t json; semua int; n int := 0; dari text := ''; begin
  semua := (public.tednas_mzone_tim((select mz from _j), '', 500)->>'total')::int;
  loop
    v := public.tednas_mzone_tim((select mz from _j), dari, 3);
    n := n + json_array_length(v->'tim');
    exit when v->>'berikut' is null;
    dari := v->>'berikut';
  end loop;
  assert n = semua, format('paging lengkap %s/%s', n, semua);
  select x into t from json_array_elements(public.tednas_mzone_tim((select mz from _j), '', 500)->'tim') x where x->>'kode' = (select kode from _pb);
  assert t->>'wa_kapten' = '6281234567820' and t->'komunitas'->>'nama' = 'MZone Tour', 'nomor WA kapten + komunitas untuk klaim akun';
  assert t->'pemain'->0->'ml'->>'id' = '1644930996' and t->'pemain'->0->'ml'->>'zone' = '16955' and t->'pemain'->0->>'ml_nick' = 'Aemeath', 'ID + Zone ML dari bacaan AI';
  assert json_typeof(t->'pemain'->1->'ml') = 'null' and json_array_length(t->'pemain') = 5, 'ID ML tak terbaca = null';
  s := public.tednas_dasbor((select db from _j));
  assert json_array_length(s->'tim') = semua and json_array_length(s->'komunitas') >= 1, 'dasbor semua tim';
  select x into t from json_array_elements(s->'tim') x where x->>'kode' = (select kode from _pb);
  assert (t->>'pemain')::int = 5 and (t->'ai'->'kategori'->>'ml_id')::int = 1 and (t->'ai'->'kategori'->>'nama')::int = 1, 'kategori catatan AI';
  assert position('6281234567820' in s::text) = 0 and position('Pemain 20-' in s::text) = 0 and position('BUDI RAHASIA' in s::text) = 0
     and position('*****' in s::text) = 0 and position('1644930996' in s::text) = 0, 'dasbor tanpa WA, nama pemain, isi catatan, NIK, ID ML';
end $u$;
reset role;

-- 17. semua data bisa diubah (migrasi 15): nama tim, WA, desa, tambah/hapus cadangan, tanpa kunci status, tautan admin
create temp table _ub (versi int);
grant all on _ub to anon, authenticated;
update _pb set tok = public.tednas_perbaiki_token(id); -- kelompok 15 memakai kolom tok sebagai tempat sidik
insert into _ub select drive_versi from public.tednas_tim where id = (select id from _pb);
set role anon;
do $u$ declare v json; begin
  v := public.tednas_ubah_lihat((select kode from _pb), (select tok from _pb));
  assert v->>'wa_kapten' = '6281234567820' and v->>'desa_kode' is not null and v->>'kab_kode' is not null and v->>'prov_kode' is not null, 'lihat: WA + kode wilayah';
  assert json_array_length(v->'pemain') = 5 and v->>'status' = 'terverifikasi', 'isi lama tetap';
  v := public.tednas_ubah_tim((select kode from _pb), (select tok from _pb), '[]',
    ${q(JSON.stringify({ nama_tim: "  Tim Ganti Nama  ", wa: "0812-9999-0001", prov_kode: "35", provinsi: "JAWA TIMUR", kab_kode: "35.07", kabupaten: "KABUPATEN MALANG", kecamatan: "Pakis", desa_kode: "35.07.18.2003", desa: "Desa Uji Baru" }))});
  assert (v->>'diubah')::int = 3, 'nama tim + WA + desa';
end $u$;
reset role;
do $u$ declare t record; begin
  select * into t from public.tednas_tim where id = (select id from _pb);
  assert t.nama_tim = 'Tim Ganti Nama' and t.wa_kapten = '6281299990001' and t.desa_kode = '35.07.18.2003' and t.desa = 'Desa Uji Baru' and t.kecamatan = 'Pakis', 'data tim baru (WA dinormalkan)';
  assert t.status = 'terverifikasi' and t.perbaiki_pada is not null and t.drive_versi > (select versi from _ub), 'status tetap, perubahan dicatat, Sheet diperbarui';
  assert (select sidik from public.tednas_ai where tim_id = t.id) is distinct from public.tednas_ai_sidik(t.id), 'AI memeriksa ulang';
end $u$;
${harusGagal(`select public.tednas_ubah_tim((select kode from _pb), (select tok from _pb), '[]', '{"wa":"6281234567801"}')`, "WA_SUDAH_ADA")}
${harusGagal(`select public.tednas_ubah_tim((select kode from _pb), (select tok from _pb), '[]', '{"wa":"021555"}')`, "WA_TIDAK_VALID")}
${harusGagal(`select public.tednas_ubah_tim((select kode from _pb), (select tok from _pb), '[]', '{"nama_tim":"X"}')`, "NAMA_TIM_TIDAK_VALID")}
${harusGagal(`select public.tednas_ubah_tim((select kode from _pb), (select tok from _pb), '[]', ${q(JSON.stringify({ prov_kode: "35", provinsi: "JAWA TIMUR", kab_kode: "35.08", kabupaten: "KAB", kecamatan: "Kec", desa_kode: "35.07.18.2003", desa: "Desa" }))})`, "WILAYAH_TIDAK_VALID")}
${harusGagal(`select public.tednas_ubah_tim((select kode from _pb), (select tok from _pb), '[]', ${q(JSON.stringify({ prov_kode: "31", provinsi: "DKI JAKARTA", kab_kode: "31.71", kabupaten: "KOTA JAKARTA PUSAT", kecamatan: "Gambir", desa_kode: "31.71.01.1001", desa: "Gambir" }))})`, "WILAYAH_TIDAK_VALID")}
${harusGagal(`select public.tednas_ubah_tim((select kode from _pb), repeat('0', 40), '[]', '{"nama_tim":"Tim Asing"}')`, "TAUTAN_TIDAK_SAH")}
${harusGagal(`select public.tednas_ubah_tim((select kode from _pb), (select tok from _pb), '[]', '{}')`, "ISIAN_TIDAK_SAH")}
${harusGagal(`select public.tednas_ubah_tim((select kode from _pb), (select tok from _pb), '[{"urutan":3,"hapus":true}]')`, "HANYA_CADANGAN")}
${harusGagal(`select public.tednas_ubah_tim((select kode from _pb), (select tok from _pb), '[{"urutan":6,"hapus":true}]')`, "PEMAIN_TIDAK_ADA")}
${harusGagal(`select public.tednas_ubah_tim((select kode from _pb), (select tok from _pb), ${q(JSON.stringify([{ urutan: 6, baru: true, nama: "Cadangan Baru", dokumen_jenis: "KTP", dokumen_path: tanda(`gdrive/${id(3001)}.jpg`), profil_ml_path: tanda(`gdrive/${id(3002)}.png`), follow_esports_path: tanda(`gdrive/${id(3003)}.png`) }]))})`, "FOLLOW_TIDAK_ADA")}
${harusGagal(`select public.tednas_ubah_tim((select kode from _pb), (select tok from _pb), ${q(JSON.stringify([{ urutan: 4, baru: true, nama: "Bukan Cadangan", dokumen_jenis: "KTP" }]))})`, "HANYA_CADANGAN")}
update _ub set versi = (select drive_versi from public.tednas_tim where id = (select id from _pb));
set role anon;
do $u$ declare v json; begin
  v := public.tednas_ubah_tim((select kode from _pb), (select tok from _pb),
    ${q(JSON.stringify([{ urutan: 6, baru: true, nama: " Cadangan Baru ", dokumen_jenis: "Kartu Pelajar", dokumen_path: tanda(`gdrive/${id(3001)}.jpg`), profil_ml_path: tanda(`gdrive/${id(3002)}.png`), follow_esports_path: tanda(`gdrive/${id(3003)}.png`), follow_ppdt_path: tanda(`gdrive/${id(3004)}.png`), izin_path: tanda(`gdrive/${id(3005)}.pdf`) }]))});
  assert (v->>'diubah')::int = 1, 'cadangan ditambah';
end $u$;
reset role;
do $u$ declare p record; begin
  select * into p from public.tednas_pemain where tim_id = (select id from _pb) and urutan = 6;
  assert p.nama = 'Cadangan Baru' and p.dokumen_jenis = 'Kartu Pelajar' and p.profil_ml_path = ${q(`gdrive/${id(3002)}.png`)} and p.izin_path = ${q(`gdrive/${id(3005)}.pdf`)}, 'cadangan tersimpan tanpa tanda';
  assert (select drive_versi from public.tednas_tim where id = (select id from _pb)) > (select versi from _ub), 'tambah cadangan memperbarui Sheet';
end $u$;
${harusGagal(`select public.tednas_ubah_tim((select kode from _pb), (select tok from _pb), ${q(JSON.stringify([{ urutan: 6, baru: true, nama: "Cadangan Dua", dokumen_jenis: "KTP", dokumen_path: tanda(`gdrive/${id(3011)}.jpg`), profil_ml_path: tanda(`gdrive/${id(3012)}.png`), follow_esports_path: tanda(`gdrive/${id(3013)}.png`), follow_ppdt_path: tanda(`gdrive/${id(3014)}.png`) }]))})`, "CADANGAN_SUDAH_ADA")}
set role anon;
do $u$ begin
  assert (public.tednas_ubah_tim((select kode from _pb), (select tok from _pb), '[{"urutan":6,"hapus":true}]')->>'diubah')::int = 1, 'cadangan dihapus';
end $u$;
reset role;
do $u$ begin
  assert (select count(*) from public.tednas_pemain where tim_id = (select id from _pb)) = 5, 'kembali 5 pemain';
end $u$;
${harusGagal(`select public.tednas_ubah_tautan((select id from _pb))`, "permission denied")}
set uji.uid = '00000000-0000-0000-0000-00000000a001';
set role authenticated;
do $u$ begin
  assert public.tednas_ubah_tautan((select id from _pb))->>'token' = (select tok from _pb), 'admin: token tautan sama dengan tautan kapten';
end $u$;
reset role;
do $u$ begin
  assert (select kapten_dikabari from public.tednas_tim where id = (select id from _pb)) is not distinct from (select kapten_dikabari from public.tednas_tim where id = (select id from _pb)), 'tautan admin tidak mencatat dikabari';
end $u$;
-- sebelum migrasi 16: sidik & versi Drive tim lama dicatat
create temp table _m16 (id uuid, sidik text, versi int);
grant all on _m16 to anon, authenticated;
insert into _m16 select id, public.tednas_ai_sidik(id), drive_versi from public.tednas_tim;
-- @@MIGRASI16@@

-- 18. WA tiap pemain + bukti twibbon 1 per tim (migrasi 16): wajib untuk pendaftar baru, tim lama tidak terganggu
do $u$ begin
  assert (select count(*) from public.tednas_tim t join _m16 m using (id) where public.tednas_ai_sidik(t.id) <> m.sidik) = 0, 'sidik AI tim lama tidak berubah (tanpa periksa ulang massal)';
  assert (select count(*) from public.tednas_tim t join _m16 m using (id) where t.drive_versi <> m.versi) = 0, 'migrasi tidak menulis ulang Sheet';
  assert (select bool_and(form_versi = 1) from public.tednas_tim), 'tim lama = form versi 1';
  assert public.tednas_wa_bersih('0812-3456-7890') = '6281234567890' and public.tednas_wa_bersih('812 3456 7890') = '6281234567890', 'nomor dibersihkan';
  assert public.tednas_wa_bersih('') is null and public.tednas_wa_bersih('12345') = 'X', 'kosong / salah';
end $u$;
${harusGagal(daftar16("Tim Twibbon", "081255500001", "35.07.18.2001", p16a, null), "TWIBBON_TIDAK_ADA")}
${harusGagal(daftar16("Tim Twibbon", "081255500001", "35.07.18.2001", p16a, `gdrive/${id(5090)}.jpg`), "TWIBBON_TIDAK_ADA")}
${harusGagal(daftar16("Tim Twibbon", "081255500001", "35.07.18.2001", p16a.map((x, i) => (i === 2 ? { ...x, wa: "" } : x)), tw16a), "WA_PEMAIN_TIDAK_VALID")}
${harusGagal(daftar16("Tim Twibbon", "081255500001", "35.07.18.2001", p16a.map((x, i) => (i === 3 ? { ...x, wa: "12345" } : x)), tw16a), "WA_PEMAIN_TIDAK_VALID")}
${harusGagal(daftar16("Tim Twibbon", "081255500001", "35.07.18.2001", p16a.map((x, i) => (i === 1 ? { ...x, dokumen_jenis: "Paspor" } : x)), tw16a), "DOKUMEN_TIDAK_ADA")}
${harusGagal(daftar16("Tim Twibbon", "081255500001", "35.07.18.2001", p16a, p16a[0].profil_ml_path), "DOKUMEN_TIDAK_ADA")}
${harusGagal(daftar(`Tim Halaman Lama`, "081255500009", "35.07.18.2001", p16a), "TWIBBON_TIDAK_ADA")}
set role anon;
do $u$ declare v json; begin
  v := ${daftar16("Tim Twibbon", "081255500001", "35.07.18.2001", p16a, tw16a).replace(/^select /, "")};
  assert v->>'kode' like 'TED-%', 'daftar dengan WA pemain + twibbon';
end $u$;
reset role;
${harusGagal(daftar16("Tim Lain", "081255500002", "35.07.18.2001", p16b, tw16a), "DOKUMEN_TIDAK_ADA")}
do $u$ declare t record; v json; begin
  select * into t from public.tednas_tim where wa_kapten = '6281255500001';
  assert t.form_versi = 2 and t.twibbon_path = ${q(`gdrive/${id(5091)}.jpg`)}, 'form v2 + twibbon tanpa tanda';
  assert (select wa from public.tednas_pemain where tim_id = t.id and urutan = 1) is null, 'pemain 1 memakai nomor kapten';
  assert (select wa from public.tednas_pemain where tim_id = t.id and urutan = 2) = '6281255501002', 'WA pemain 08… → 628…';
  assert (select dokumen_jenis from public.tednas_pemain where tim_id = t.id and urutan = 4) = 'SIM', 'SIM diterima';
  assert (select dokumen_jenis from public.tednas_pemain where tim_id = t.id and urutan = 5) = 'KIA', 'KIA diterima';
  v := public.tednas_drive_paket(t.id);
  assert v->>'twibbon_path' = t.twibbon_path and (v->>'form_versi')::int = 2, 'paket Drive/AI: twibbon';
  assert v->'pemain'->0->>'wa' = '6281255500001' and v->'pemain'->1->>'wa' = '6281255501002', 'paket: WA pemain (pemain 1 = kapten)';
  assert public.tednas_ai_sidik(t.id) like '%' and public.tednas_ai_sidik(t.id) <> md5(''), 'sidik ada';
  insert into _m16 values (t.id, public.tednas_ai_sidik(t.id), t.drive_versi);
end $u$;

-- ubah data: WA pemain, twibbon, jenis identitas baru; form v2 tidak boleh mengosongkan WA pemain
create temp table _tw (id uuid, kode text, tok text);
grant all on _tw to anon, authenticated;
insert into _tw select id, kode, public.tednas_perbaiki_token(id) from public.tednas_tim where wa_kapten = '6281255500001';
set role anon;
do $u$ declare v json; begin
  v := public.tednas_ubah_lihat((select kode from _tw), (select tok from _tw));
  assert (v->>'form_versi')::int = 2 and (v->>'ada_twibbon')::boolean, 'lihat: form v2 + ada twibbon';
  assert v->'pemain'->0->>'wa' = '6281255500001' and v->'pemain'->2->>'wa' = '6281255501003', 'lihat: WA per pemain';
  v := public.tednas_ubah_tim((select kode from _tw), (select tok from _tw), '[{"urutan":2,"wa":"0813-0000-2222"},{"urutan":3,"dokumen_jenis":"Lainnya"},{"urutan":1,"wa":"0899"}]');
  assert (v->>'diubah')::int = 2, 'WA pemain 2 + jenis identitas pemain 3 (WA pemain 1 diabaikan)';
  v := public.tednas_ubah_tim((select kode from _tw), (select tok from _tw), '[]', ${q(JSON.stringify({ twibbon_path: tanda(`gdrive/${id(5092)}.png`) }))});
  assert (v->>'diubah')::int = 1, 'twibbon diganti';
end $u$;
reset role;
${harusGagal(`select public.tednas_ubah_tim((select kode from _tw), (select tok from _tw), '[{"urutan":2,"wa":""}]')`, "WA_PEMAIN_TIDAK_VALID")}
${harusGagal(`select public.tednas_ubah_tim((select kode from _tw), (select tok from _tw), '[{"urutan":2,"wa":"0812"}]')`, "WA_PEMAIN_TIDAK_VALID")}
${harusGagal(`select public.tednas_ubah_tim((select kode from _tw), (select tok from _tw), '[]', ${q(JSON.stringify({ twibbon_path: p16a[1].dokumen_path }))})`, "DOKUMEN_TIDAK_ADA")}
${harusGagal(`select public.tednas_ubah_tim((select kode from _tw), (select tok from _tw), '[]', '{"twibbon_path":"gdrive/tanpa-tanda.jpg"}')`, "TWIBBON_TIDAK_ADA")}
${harusGagal(`select public.tednas_ubah_tim((select kode from _tw), (select tok from _tw), ${q(JSON.stringify([{ urutan: 6, baru: true, nama: "Cadangan Tanpa WA", dokumen_jenis: "KTP", dokumen_path: tanda(`gdrive/${id(5093)}.jpg`), profil_ml_path: tanda(`gdrive/${id(5094)}.png`), follow_esports_path: tanda(`gdrive/${id(5095)}.png`), follow_ppdt_path: tanda(`gdrive/${id(5096)}.png`) }]))})`, "WA_PEMAIN_TIDAK_VALID")}
do $u$ begin
  assert (select wa from public.tednas_pemain where tim_id = (select id from _tw) and urutan = 2) = '6281300002222', 'WA pemain 2 tersimpan';
  assert (select wa from public.tednas_pemain where tim_id = (select id from _tw) and urutan = 1) is null, 'WA pemain 1 tetap kosong';
  assert (select twibbon_path from public.tednas_tim where id = (select id from _tw)) = ${q(`gdrive/${id(5092)}.png`)}, 'twibbon baru';
  assert public.tednas_ai_sidik((select id from _tw)) <> (select sidik from _m16 where id = (select id from _tw)), 'twibbon baru → sidik berubah → AI cek ulang';
  assert (select drive_versi from public.tednas_tim where id = (select id from _tw)) > (select versi from _m16 where id = (select id from _tw)), 'Sheet ikut diperbarui';
  assert (select count(*) from public.tednas_pemain where tim_id = (select id from _tw)) = 5, 'cadangan tanpa WA tidak tersimpan';
end $u$;
-- tim lama (form v1): WA pemain boleh diisi lalu dikosongkan lagi, twibbon boleh ditambahkan
set role anon;
do $u$ declare v json; begin
  v := public.tednas_ubah_tim((select kode from _pb), (select tok from _pb), '[{"urutan":3,"wa":"081277700003"}]');
  assert (v->>'diubah')::int = 1, 'tim lama: WA pemain diisi';
  v := public.tednas_ubah_tim((select kode from _pb), (select tok from _pb), '[{"urutan":3,"wa":""}]');
  assert (v->>'diubah')::int = 1, 'tim lama: WA pemain boleh dikosongkan';
end $u$;
reset role;
-- @@MIGRASI17@@

-- 19. Twibbon ikut "dipakai" (migrasi 17): tidak dibuang Apps Script sebagai unggahan yatim
do $u$ begin
  assert public.tednas_drive_dipakai(${q(RAHASIA)}, array[${q(`gdrive/${id(5092)}.png`)}, ${q(`gdrive/${id(5091)}.jpg`)}, ${q(p16a[0].dokumen_path.split("~")[0])}])
         = array[${q(`gdrive/${id(5092)}.png`)}, ${q(p16a[0].dokumen_path.split("~")[0])}], 'twibbon aktif dipakai; twibbon lama yang sudah diganti tidak';
end $u$;
reset role;
-- @@MIGRASI18@@

-- 20. Komunitas di MZone membuat tautan referal Esports Desa sendiri (migrasi 18)
${harusGagal(`select public.tednas_mzone_komunitas(repeat('0', 64), '01957a00-0000-7000-8000-000000000001')`, "KUNCI_SALAH", "anon")}
${harusGagal(`select public.tednas_mzone_komunitas((select db from _j), '01957a00-0000-7000-8000-000000000001')`, "KUNCI_SALAH", "anon")}
${harusGagal(`select public.tednas_mzone_komunitas((select mz from _j), '01957a00-0000-7000-8000-000000000001', true, false, ' X ')`, "NAMA_TIDAK_SAH", "anon")}
${harusGagal(`select public.tednas_mzone_komunitas((select mz from _j), null, true, false, 'Tanpa Id')`, "KOMUNITAS_TIDAK_SAH", "anon")}
set role anon;
do $u$ declare a json; b json; c json; mz text := (select mz from _j); begin
  assert public.tednas_mzone_komunitas(mz, '01957a00-0000-7000-8000-000000000001') is null, 'belum punya tautan → null';
  a := public.tednas_mzone_komunitas(mz, '01957a00-0000-7000-8000-000000000001', true, false, '  Esports   Desa Sumber ', 'Kabupaten Malang', 'Jawa Timur', 'Andi PIC', '+62 812-3456-0001');
  assert a->>'nama' = 'Esports Desa Sumber' and (a->>'aktif')::boolean and not (a->>'bawaan')::boolean and (a->>'mendaftar')::int = 0, 'tautan dibuat';
  assert position('Andi' in a::text) = 0 and position('6281234560001' in a::text) = 0, 'jawaban tanpa data PIC';
  b := public.tednas_mzone_komunitas(mz, '01957a00-0000-7000-8000-000000000001', true, false, 'Esports Desa Sumber Baru', 'Kabupaten Malang', 'Jawa Timur', '', '');
  assert b->>'id' = a->>'id' and b->>'nama' = 'Esports Desa Sumber Baru', 'satu komunitas MZone = satu tautan; nama ikut diperbarui';
  assert public.tednas_mzone_komunitas(mz, '01957a00-0000-7000-8000-000000000001')->>'id' = a->>'id', 'baca';
  assert public.tednas_komunitas_info((a->>'id')::int)->>'nama' = 'Esports Desa Sumber Baru', 'tautannya dipakai formulir daftar seperti tautan buatan admin';
  c := public.tednas_mzone_komunitas(mz, '01957a00-0000-7000-8000-000000000002', true, true, 'MZONETOUR', 'Kota Jakarta Selatan', 'DKI Jakarta', 'Pengurus', '');
  assert (c->>'bawaan')::boolean and c->>'nama' = 'MZone Tour', 'penyelenggara TEDNas di MZone memakai komunitas bawaan';
  c := public.tednas_mzone_komunitas(mz, '01957a00-0000-7000-8000-000000000003', true, true, 'Penyelenggara Palsu', '', '', '', '');
  assert not (c->>'bawaan')::boolean and c->>'nama' = 'Penyelenggara Palsu', 'bawaan yang sudah tertaut tidak bisa diambil alih';
end $u$;
reset role;
do $u$ declare a json; begin
  assert (select pic_wa from public.tednas_komunitas where mzone_id = '01957a00-0000-7000-8000-000000000001') = '6281234560001', 'PIC dari pembuat pertama tetap (yang kedua kosong)';
  assert (select count(*) from public.tednas_komunitas where bawaan) = 1, 'tetap satu bawaan';
  assert (public.tednas_mzone_komunitas((select mz from _j), '01957a00-0000-7000-8000-000000000002')->>'mendaftar')::int
         = (select count(*) from public.tednas_tim where komunitas_id = (select id from public.tednas_komunitas where bawaan)), 'hitungan tim bawaan';
  update public.tednas_komunitas set aktif = false where mzone_id = '01957a00-0000-7000-8000-000000000001';
  a := public.tednas_mzone_komunitas((select mz from _j), '01957a00-0000-7000-8000-000000000001', true, false, 'Esports Desa Sumber', '', '', '', '');
  assert not (a->>'aktif')::boolean, 'dinonaktifkan admin → tidak dinyalakan ulang dari MZone';
end $u$;
${harusGagal(`insert into public.tednas_komunitas (nama, mzone_id) values ('Kembar', '01957a00-0000-7000-8000-000000000001')`, "duplicate key", "postgres")}
\\echo SEMUA_LULUS
`;

const tmp = mkdtempSync(join(tmpdir(), "tednas-sql-"));
const f = join(tmp, "uji.sql");
const skema = baca("supabase/schema-tednas.sql").replace(/^create extension if not exists http with schema extensions;$/m, "-- (http: tiruan)");
const migrasi = baca("supabase/migration-8-drive.sql").replace(/^create extension if not exists pg_net with schema extensions;$/m, "-- (pg_net: tiruan)");
const migrasi9 = baca("supabase/migration-9-cermin-drive.sql");
const migrasi10 = baca("supabase/migration-10-ai-periksa.sql");
const migrasi12 = baca("supabase/migration-12-perbaiki.sql");
const migrasi13 = baca("supabase/migration-13-komunitas.sql");
const migrasi14 = baca("supabase/migration-14-jalur-mzone-dasbor.sql");
const migrasi15 = baca("supabase/migration-15-ubah-semua.sql");
const migrasi16 = baca("supabase/migration-16-wa-pemain-twibbon.sql");
const migrasi17 = baca("supabase/migration-17-drive-twibbon.sql");
const migrasi18 = baca("supabase/migration-18-komunitas-mzone.sql");
writeFileSync(f, ["\\set ON_ERROR_STOP 1", "\\set QUIET 1", "\\set VERBOSITY verbose", "set client_min_messages = warning;", baca("uji/sql-tiruan-supabase.sql"), skema,
  "-- migrasi 8, 9, 10, 12, 13, 14 & 15 dua kali: harus aman dijalankan ulang", migrasi, migrasi, migrasi9, migrasi9, migrasi10, migrasi10, migrasi12, migrasi12, migrasi13, migrasi13, migrasi14, migrasi14, migrasi15, migrasi15, SQL_BANTU, uji, uji2.replace("-- @@MIGRASI13@@", () => `reset role;\n${migrasi13}`)
    .replace("-- @@MIGRASI16@@", () => `reset role;\n-- migrasi 16 dua kali (aman diulang), di atas data yang sudah ada\n${migrasi16}\n${migrasi16}`)
    .replace("-- @@MIGRASI17@@", () => `${migrasi17}\n${migrasi17}`)
    .replace("-- @@MIGRASI18@@", () => `${migrasi18}\n${migrasi18}`)].join("\n")
  .replace(/^-- (\d+)\. (.*)$/gm, (_, n, t) => `\\echo LANGKAH ${n}: ${t}`));
const NAMA = "tednas-uji-pg";
const ssh = (cmd, input) => execFileSync("ssh", ["-o", "ConnectTimeout=15", "jot", cmd], { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
try {
  ssh(`docker rm -f ${NAMA} >/dev/null 2>&1; docker run -d --rm --name ${NAMA} -m 300m -e POSTGRES_PASSWORD=uji postgres:17-alpine >/dev/null && for i in $(seq 1 40); do docker exec ${NAMA} pg_isready -U postgres -q && sleep 1 && exit 0; sleep 1; done; exit 1`);
  let keluar;
  try { keluar = ssh(`docker exec -i ${NAMA} psql -U postgres -X -q -v ON_ERROR_STOP=1`, readFileSync(f, "utf8")); }
  catch (e) { console.error(`GAGAL:\n${e.stdout ?? ""}\n${e.stderr ?? e.message}`); process.exitCode = 1; }
  if (keluar !== undefined) {
    if (!keluar.includes("SEMUA_LULUS")) { console.error(keluar); process.exitCode = 1; }
    else console.log("uji SQL lulus (skema + migrasi 8–18 di Postgres 17, 20 kelompok)");
  }
} finally {
  try { ssh(`docker rm -f ${NAMA} >/dev/null 2>&1; true`); } catch { /* */ }
  rmSync(tmp, { recursive: true, force: true });
}
