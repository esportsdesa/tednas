/**
 * Google & Supabase TIRUAN untuk menjalankan deploy/drive/Code.gs di Node (vm): Drive, Sheets, Cache, Lock,
 * Properties, UrlFetch, Utilities, ContentService. Supabase tiruan meniru kontrak migration-8-drive.sql —
 * nama parameter tiap RPC dicocokkan dengan tanda tangan fungsi di berkas migrasi.
 * Dipakai uji/uji-drive.mjs (unit) dan uji/uji-peramban.mjs (ujung ke ujung di Chromium).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, createHmac, randomUUID } from "node:crypto";
import vm from "node:vm";

const AKAR = new URL("..", import.meta.url);

export function buatDunia({ KUNCI = "c3".repeat(32) } = {}) {
const KODE_GS = readFileSync(new URL("deploy/drive/Code.gs", AKAR), "utf8");
const MIGRASI = readFileSync(new URL("supabase/migration-8-drive.sql", AKAR), "utf8");
const SB = "https://dlznnpmzccndjqxxhnio.supabase.co";
const J = (x) => JSON.parse(JSON.stringify(x));
const S = {};
/* ── tanda tangan RPC dari migrasi ────────────────────────────────────── */
const TTD = {};
for (const m of MIGRASI.matchAll(/create or replace function public\.(tednas_drive_\w+)\(([^)]*)\)/g)) {
  TTD[m[1]] = m[2].split(",").map((x) => x.trim()).filter(Boolean).map((x) => ({ nama: x.split(/\s+/)[0], wajib: !/\bdefault\b/i.test(x) }));
}
for (const f of ["tednas_drive_antre", "tednas_drive_selesai", "tednas_drive_hapus_selesai", "tednas_drive_dipakai", "tednas_drive_setel_url"]) assert.ok(TTD[f], `fungsi ${f} tidak ada di migrasi`);

/* ── waktu ────────────────────────────────────────────────────────────── */
S.jam = Date.parse("2026-11-11T03:00:00Z");
class TDate extends Date { constructor(...a) { if (a.length) super(...a); else super(S.jam); } static now() { return S.jam; } }

/* ── Drive tiruan ─────────────────────────────────────────────────────── */
let nomor = 0;
const benda = new Map();
const hitung = { moveTo: 0, setName: 0, fetch: 0, auth: 0 };
const iter = (a) => { let i = 0; return { hasNext: () => i < a.length, next: () => a[i++] }; };
const idBaru = () => `1Tiru${String(++nomor).padStart(6, "0")}xxxxxxxxxxxxxxxxxxxxxx`;
const signed = (buf) => [...buf].map((b) => (b > 127 ? b - 256 : b));
const unsigned = (a) => Buffer.from(a.map((b) => b & 255));
function blob(bytes, mime, nama) {
  let n = nama;
  return { _buf: unsigned(bytes), getBytes: () => [...bytes], getContentType: () => mime, getName: () => n, setName(x) { n = x; return this; } };
}
function buatBerkas(nama, isi, mime, induk) {
  const id = idBaru();
  const f = { _jenis: "berkas", _nama: nama, _isi: isi, _mime: mime, _induk: induk, _sampah: false,
    getId: () => id, getName: () => f._nama, setName(x) { hitung.setName++; f._nama = x; return f; },
    getUrl: () => `https://drive.google.com/file/d/${id}/view?usp=drivesdk`, isTrashed: () => f._sampah, setTrashed(x) { f._sampah = x; return f; },
    moveTo(d) { hitung.moveTo++; f._induk = d.getId(); return f; }, getParents: () => iter(f._induk && benda.has(f._induk) ? [benda.get(f._induk)] : []),
    getBlob: () => blob(signed(f._isi), f._mime, f._nama) };
  benda.set(id, f);
  return f;
}
function buatFolder(nama, induk) {
  const id = idBaru();
  const d = { _jenis: "folder", _nama: nama, _induk: induk, _sampah: false,
    getId: () => id, getName: () => d._nama, setName(x) { d._nama = x; return d; }, getUrl: () => `https://drive.google.com/drive/folders/${id}`,
    isTrashed: () => d._sampah, setTrashed(x) { d._sampah = x; return d; },
    createFolder: (n) => buatFolder(n, id), createFile: (b) => buatBerkas(b.getName(), b._buf, b.getContentType(), id),
    getFiles: () => iter([...benda.values()].filter((x) => (x._jenis === "berkas" || x._jenis === "sheet") && x._induk === id && !x._sampah)),
    getFolders: () => iter([...benda.values()].filter((x) => x._jenis === "folder" && x._induk === id && !x._sampah)),
    getParents: () => iter(d._induk && benda.has(d._induk) ? [benda.get(d._induk)] : []),
    addViewer: () => d };
  benda.set(id, d);
  return d;
}
const ROOT_DRIVE = buatFolder("My Drive", null);
const folderBernama = (n) => [...benda.values()].find((x) => x._jenis === "folder" && x._nama === n && !x._sampah);
const anakDari = (d) => [...benda.values()].filter((x) => x._induk === d.getId() && !x._sampah);

/* ── Sheets tiruan (baris = larik) ────────────────────────────────────── */
function buatLembar(nama) {
  const rows = [];
  let maxR = 1000;
  const sh = { _nama: nama, _rows: rows, _warna: new Map(),
    getName: () => sh._nama, setName(n) { sh._nama = n; return sh; }, setFrozenRows: () => sh,
    getLastRow: () => { for (let i = rows.length - 1; i >= 0; i--) if (rows[i] && rows[i].some((x) => x !== "" && x != null)) return i + 1; return 0; },
    getMaxRows: () => maxR, insertRowsAfter: (_, n) => { maxR += n; },
    deleteRows: (awal, n) => { rows.splice(awal - 1, n); maxR -= n; },
    getRange: (r, c, nr = 1, nc = 1) => {
      assert.ok(r >= 1 && c >= 1 && r + nr - 1 <= maxR, `rentang ${r},${c},${nr},${nc} > ${maxR}`);
      const rg = {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (rows[r - 1 + i] ?? [])[c - 1 + j] ?? "")),
        setValues: (v) => { assert.equal(v.length, nr); v.forEach((b, i) => { assert.equal(b.length, nc); const row = (rows[r - 1 + i] ??= []); b.forEach((x, j) => { assert.equal(typeof x, "string", "nilai harus teks"); row[c - 1 + j] = x; }); }); return rg; },
        setValue: (x) => { (rows[r - 1] ??= [])[c - 1] = x; return rg; },
        setBackground: (w) => { sh._warna.set(`${r},${c}`, w); return rg; },
        setNumberFormat: () => rg, setFontWeight: () => rg,
      };
      return rg;
    },
    baris: (n) => rows[n - 1] ?? [],
    data: () => rows.slice(1).filter((x) => x && x.length),
  };
  return sh;
}
const SpreadsheetApp = {
  create: (nama) => {
    const id = idBaru();
    const lembar = [buatLembar("Sheet1")];
    const ss = { _jenis: "sheet", _nama: nama, _induk: ROOT_DRIVE.getId(), _sampah: false, _lembar: lembar,
      getId: () => id, getUrl: () => `https://docs.google.com/spreadsheets/d/${id}/edit`, isTrashed: () => ss._sampah,
      moveTo: (d) => { ss._induk = d.getId(); }, getSheets: () => [...lembar],
      getSheetByName: (n) => lembar.find((s) => s._nama === n) ?? null,
      insertSheet: (n) => { const s = buatLembar(n); lembar.push(s); return s; } };
    benda.set(id, ss);
    return ss;
  },
  openById: (id) => { const x = benda.get(id); if (!x || x._jenis !== "sheet") throw new Error("tidak ada"); return x; },
};

/* ── Supabase tiruan (kontrak migration-8) ────────────────────────────── */
const db = { tim: [], hapus: [], url: null, admin: new Map([["token-admin-sah-0123456789", "u-admin"], ["token-bukan-admin-012345", "u-biasa"]]), adminId: new Set(["u-admin"]) };
let seq = 0;
const paket = (t) => J({ ...t, pemain: t.pemain });
function rpcTiruan(nama, b) {
  const t = TTD[nama];
  assert.ok(t, `RPC ${nama} tidak ada di migrasi`);
  for (const k of Object.keys(b)) assert.ok(t.some((x) => x.nama === k), `${nama}: parameter ${k} tidak ada di SQL`);
  for (const x of t) if (x.wajib) assert.ok(x.nama in b, `${nama}: parameter wajib ${x.nama} tidak dikirim`);
  if (b.p_kunci !== KUNCI) return [400, { message: "KUNCI_SALAH" }];
  const cari = (id) => db.tim.find((x) => x.id === id);
  switch (nama) {
    case "tednas_drive_antre":
      if (b.p_jenis === "sheet") { const perlu = db.tim.filter((x) => x.tersalin < x.versi); return [200, { tim: perlu.slice(0, b.p_batas).map(paket), sisa: perlu.length, hapus: db.hapus.map((h) => ({ ...h })) }]; }
      if (b.p_jenis === "rapi") { const perlu = db.tim.filter((x) => x.rapi === 0 && x.tersalin > 0); return [200, { tim: perlu.slice(0, b.p_batas).map(paket), sisa: perlu.length }]; }
      return [400, { message: "JENIS_SALAH" }];
    case "tednas_drive_selesai": {
      const x = cari(b.p_tim);
      if (x && b.p_jenis === "sheet") x.tersalin = Math.max(x.tersalin, Math.min(b.p_versi, x.versi));
      if (x && b.p_jenis === "rapi") { x.rapi = Math.max(b.p_versi || 1, 1); x.folder = b.p_folder || x.folder; }
      return [200, { ok: true }];
    }
    case "tednas_drive_hapus_selesai": db.hapus = db.hapus.filter((h) => h.kode !== b.p_kode); return [200, { ok: true }];
    case "tednas_drive_dipakai": {
      const pakai = new Set(db.tim.flatMap((x) => x.pemain.flatMap((p) => [p.dokumen_path, p.profil_ml_path, p.follow_esports_path, p.follow_ppdt_path, p.izin_path])));
      return [200, b.p_paths.filter((x) => pakai.has(x))];
    }
    case "tednas_drive_setel_url":
      if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,200}\/exec$/.test(b.p_url)) return [400, { message: "URL_SALAH" }];
      db.url = b.p_url; return [200, { ok: true }];
  }
  return [404, { message: "tidak ada" }];
}
/** tednas_daftar() tiruan untuk bagian berkas: tanda HMAC diperiksa (sama persis dengan SQL), lalu dibuang. */
function sahkan(path) {
  const m = /^(gdrive\/[A-Za-z0-9_-]{10,100}\.(pdf|jpg|png))~([0-9a-f]{64})$/.exec(path);
  if (!m) return null;
  return createHmac("sha256", KUNCI).update(m[1]).digest("hex") === m[3] ? m[1] : null;
}
function daftarTim(nama, pemain, opsi = {}) {
  const kode = `TED-${String(++seq).padStart(5, "0")}`;
  const t = { id: randomUUID(), kode, nama_tim: nama, nama_kapten: pemain[0].nama, wa_kapten: opsi.wa ?? `62812000000${seq}`, prov_kode: "35", provinsi: "JAWA TIMUR",
    kab_kode: "35.07", kabupaten: "KAB. MALANG", kecamatan: "Pakis", desa_kode: "35.07.18.2010", desa: "Mangliawan", status: "menunggu",
    created_at: new Date(S.jam).toISOString(), versi: 1, tersalin: 0, rapi: 0, folder: null,
    pemain: pemain.map((p, i) => {
      const s = (x) => (x == null ? null : opsi.lama ? x : sahkan(x));
      const q = { urutan: i + 1, nama: p.nama, dokumen_jenis: p.jenis ?? "KTP", dokumen_path: s(p.dok), profil_ml_path: s(p.ml), follow_esports_path: s(p.ig1), follow_ppdt_path: s(p.ig2), izin_path: s(p.izin) };
      for (const k of ["dokumen_path", "profil_ml_path", "follow_esports_path", "follow_ppdt_path"]) assert.ok(q[k], `${k} ditolak`);
      return q;
    }) };
  db.tim.push(t);
  return t;
}
const kabar = (aksi, isi) => J(JSON.parse(gs.doPost({ postData: { contents: JSON.stringify({ aksi, kunci: KUNCI, ...isi }) } }).getContent()));

function ambil(url, o = {}) {
  hitung.fetch++;
  const res = (kode, isi) => ({ getResponseCode: () => kode, getContentText: () => (typeof isi === "string" ? isi : JSON.stringify(isi)) });
  if (url.startsWith(`${SB}/rest/v1/rpc/`)) {
    assert.equal(o.headers?.apikey, "sb_publishable_jBDfxJAsqsdLlKD3eK_TVA_9l4voeNS");
    const [kode, isi] = rpcTiruan(url.slice(`${SB}/rest/v1/rpc/`.length), JSON.parse(o.payload));
    return res(kode, isi);
  }
  const tok = String(o.headers?.Authorization ?? "").replace(/^Bearer /, "");
  if (url === `${SB}/auth/v1/user`) { hitung.auth++; const id = db.admin.get(tok); return id ? res(200, { id }) : res(401, { message: "invalid JWT" }); }
  const m = /^.*\/rest\/v1\/tednas_admin\?select=user_id&user_id=eq\.(.+)$/.exec(url);
  if (m) { const id = db.admin.get(tok); return res(200, id && id === decodeURIComponent(m[1]) && db.adminId.has(id) ? [{ user_id: id }] : []); }
  throw new Error(`alamat tak dikenal ${url}`);
}

/* ── layanan Apps Script lain ─────────────────────────────────────────── */
const props = new Map(), cache = new Map(), pemicu = [], log = [];
S.gembokSibuk = false; S.urlLayanan = null;
const google = {
  DriveApp: {
    createFolder: (n) => buatFolder(n, ROOT_DRIVE.getId()),
    getFolderById: (id) => { const x = benda.get(id); if (!x || x._jenis !== "folder") throw new Error("Folder tidak ada"); return x; },
    getFileById: (id) => { const x = benda.get(id); if (!x || x._jenis === "folder") throw new Error("Berkas tidak ada"); return x; },
  },
  SpreadsheetApp,
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (props.has(k) ? props.get(k) : null), setProperty: (k, v) => props.set(k, String(v)), deleteProperty: (k) => props.delete(k) }) },
  CacheService: { getScriptCache: () => ({ get: (k) => cache.get(k) ?? null, put: (k, v) => cache.set(k, String(v)), remove: (k) => cache.delete(k) }) },
  LockService: { getScriptLock: () => ({ tryLock: () => !S.gembokSibuk, waitLock: () => { if (S.gembokSibuk) throw new Error("Lock timeout"); }, releaseLock: () => {} }) },
  ScriptApp: {
    getProjectTriggers: () => [...pemicu], deleteTrigger: (t) => pemicu.splice(pemicu.indexOf(t), 1),
    newTrigger: (fn) => ({ timeBased: () => ({ everyMinutes: (m) => ({ create: () => { assert.ok([1, 5, 10, 15, 30].includes(m)); pemicu.push({ getHandlerFunction: () => fn, m }); } }) }) }),
    getService: () => ({ getUrl: () => S.urlLayanan }),
  },
  UrlFetchApp: { fetch: ambil },
  Utilities: {
    base64Decode: (s) => signed(Buffer.from(s, "base64")), base64Encode: (b) => unsigned(b).toString("base64"),
    base64EncodeWebSafe: (b) => unsigned(b).toString("base64url"),
    computeHmacSha256Signature: (v, k) => signed(createHmac("sha256", k).update(v).digest()),
    computeDigest: (_, s) => signed(createHash("sha256").update(s).digest()), DigestAlgorithm: { SHA_256: "SHA_256" },
    newBlob: (bytes, mime, nama) => blob(bytes, mime, nama), getUuid: () => randomUUID(), sleep: () => {},
  },
  ContentService: { createTextOutput: (s) => ({ _s: s, setMimeType() { return this; }, getContent() { return this._s; } }), MimeType: { JSON: "json" } },
  Logger: { log: (s) => log.push(String(s)) },
  Session: { getEffectiveUser: () => ({ getEmail: () => "yanuarardaraja@gmail.com" }) },
};
const gs = vm.createContext({ ...google, Date: TDate });
vm.runInContext(KODE_GS.replace('"__KUNCI__"', JSON.stringify(KUNCI)), gs, { filename: "Code.gs" });
const post = (isi) => J(JSON.parse(gs.doPost({ postData: { contents: typeof isi === "string" ? isi : JSON.stringify(isi) } }).getContent()));


return { S, KUNCI, SB, J, gs, db, benda, hitung, props, cache, pemicu, log, ROOT_DRIVE, folderBernama, anakDari, sahkan, daftarTim, paket, kabar, post, blob, signed };
}
