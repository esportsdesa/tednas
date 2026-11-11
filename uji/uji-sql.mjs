/**
 * Uji SQL TEDNas di Postgres SUNGGUHAN (container sementara di server jot, dibuang setelahnya):
 * skema-tednas.sql + migration-8-drive.sql di atas tiruan Supabase (uji/sql-tiruan-supabase.sql).
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
\\echo SEMUA_LULUS
`;

const tmp = mkdtempSync(join(tmpdir(), "tednas-sql-"));
const f = join(tmp, "uji.sql");
const skema = baca("supabase/schema-tednas.sql").replace(/^create extension if not exists http with schema extensions;$/m, "-- (http: tiruan)");
const migrasi = baca("supabase/migration-8-drive.sql").replace(/^create extension if not exists pg_net with schema extensions;$/m, "-- (pg_net: tiruan)");
writeFileSync(f, ["\\set ON_ERROR_STOP 1", "\\set QUIET 1", "\\set VERBOSITY verbose", "set client_min_messages = warning;", baca("uji/sql-tiruan-supabase.sql"), skema,
  "-- migrasi 8 dua kali: harus aman dijalankan ulang", migrasi, migrasi, SQL_BANTU, uji, uji2].join("\n")
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
    else console.log("uji SQL lulus (skema + migrasi 8 di Postgres 17, 11 kelompok)");
  }
} finally {
  try { ssh(`docker rm -f ${NAMA} >/dev/null 2>&1; true`); } catch { /* */ }
  rmSync(tmp, { recursive: true, force: true });
}
