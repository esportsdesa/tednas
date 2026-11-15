/**
 * Membuat berkas siap-tempel di .siap/ (TIDAK masuk git — repo ini publik):
 *   .siap/rahasia.txt   kunci bersama Supabase ↔ Apps Script (dibuat sekali, dipakai ulang)
 *   .siap/supabase.sql  migration-8-drive.sql + pemasangan kunci → tempel di Supabase > SQL Editor
 *   .siap/Code.gs       deploy/drive/Code.gs berkunci → tempel di script.google.com akun pemilik Drive
 *                       (KUNCI_AI ikut diisi bila .siap/rahasia-ai.txt ada — agen AI, lihat agen-ai/README.md)
 *   node deploy/drive/buat-siap.mjs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const akar = new URL("../../", import.meta.url);
const siap = new URL(".siap/", akar);
mkdirSync(siap, { recursive: true });
const fR = new URL("rahasia.txt", siap);
if (!existsSync(fR)) writeFileSync(fR, randomBytes(32).toString("hex") + "\n", { mode: 0o600 });
const kunci = readFileSync(fR, "utf8").trim();
if (!/^[0-9a-f]{64}$/.test(kunci)) throw new Error("rahasia.txt rusak");

const sql = readFileSync(new URL("supabase/migration-8-drive.sql", akar), "utf8");
writeFileSync(new URL("supabase.sql", siap), `-- TEDNas: penyimpanan Google Drive — SIAP TEMPEL (berisi rahasia; jangan dibagikan/di-commit).
-- Supabase > SQL Editor > New query > tempel seluruh isi ini > Run. Aman dijalankan ulang.

${sql}
-- ========== KUNCI BERSAMA (sama dengan KUNCI di Code.gs) ==========
update public.tednas_rahasia set drive_rahasia = '${kunci}' where id = 1;

-- Hasil yang benar: rahasia_terpasang = true.
select (select drive_rahasia is not null from public.tednas_rahasia where id = 1) as rahasia_terpasang,
       (select count(*) from public.tednas_tim) as tim,
       (select count(*) from public.tednas_tim where drive_tersalin < drive_versi) as tim_menunggu_disalin;
`);
const gs = readFileSync(new URL("deploy/drive/Code.gs", akar), "utf8");
if (!gs.includes('"__KUNCI__"')) throw new Error("penanda __KUNCI__ hilang dari Code.gs");
const fAi = new URL("rahasia-ai.txt", siap);
const kunciAi = existsSync(fAi) ? readFileSync(fAi, "utf8").trim() : null;
if (kunciAi && !/^[0-9a-f]{64}$/.test(kunciAi)) throw new Error("rahasia-ai.txt rusak");
writeFileSync(new URL("Code.gs", siap), gs.replace('"__KUNCI__"', JSON.stringify(kunci)).replace('"__KUNCI_AI__"', kunciAi ? JSON.stringify(kunciAi) : '"__KUNCI_AI__"'));
console.log("Siap: .siap/supabase.sql dan .siap/Code.gs (kunci di .siap/rahasia.txt)");
