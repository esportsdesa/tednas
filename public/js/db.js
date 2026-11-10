/* Lapisan data. Dua backend dengan antarmuka sama: Supabase (produksi) dan
   localStorage (mode lokal untuk uji tanpa server). */
(function () {
  const C = window.APP_CONFIG || {};
  // Hanya konfigurasi kosong yang boleh jatuh ke mode lokal. Kalau pustaka Supabase gagal dimuat
  // di produksi, pendaftar tidak boleh mengira datanya terkirim padahal hanya tersimpan di browsernya.
  const lokal = !C.SUPABASE_URL || C.SUPABASE_URL.startsWith('GANTI');
  if (!lokal && !window.supabase) {
    document.addEventListener('DOMContentLoaded', () => {
      document.body.innerHTML = '<p style="padding:40px;text-align:center;font:600 18px sans-serif">Koneksi ke server gagal dimuat. Periksa internet Anda lalu muat ulang halaman ini.</p>';
    });
    return;
  }
  const DOMAIN_ADMIN = '@tednas.id';
  const BUCKET_DOK = 'tednas-dokumen';
  const BUCKET_GAL = 'tednas-galeri';
  const KOLOM_PUBLIK = 'id,kode,nama_tim,prov_kode,provinsi,kab_kode,kabupaten,kecamatan,desa_kode,desa,status,created_at';

  const acakId = () => (crypto.randomUUID ? crypto.randomUUID() : 'x' + Date.now() + Math.random().toString(16).slice(2));
  const ekstensi = (f) => {
    const t = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' }[f.type];
    return t || (f.name.split('.').pop() || 'bin').toLowerCase();
  };
  const pola = (q) => '%' + String(q).replace(/[%_,()\\]/g, ' ').trim() + '%';

  /* ---------- SUPABASE ---------- */
  function buatSupabase() {
    const sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);
    const cek = ({ data, error, count }) => { if (error) throw error; return count !== undefined && count !== null ? { data, count } : data; };

    function saringTim(q, o) {
      if (o.prov) q = q.eq('prov_kode', o.prov);
      if (o.status) q = q.eq('status', o.status);
      if (o.cari && o.cari.trim()) {
        const p = pola(o.cari);
        q = q.or(`nama_tim.ilike.${p},desa.ilike.${p},kecamatan.ilike.${p},kabupaten.ilike.${p},kode.ilike.${p}`);
      }
      return q;
    }

    return {
      lokal: false,
      async pengaturan() { return cek(await sb.from('tednas_pengaturan').select('*').eq('id', 1).single()); },
      async setPendaftaran(buka) { cek(await sb.from('tednas_pengaturan').update({ pendaftaran_buka: buka, updated_at: new Date().toISOString() }).eq('id', 1)); },
      async setJadwalBuka(iso) { cek(await sb.from('tednas_pengaturan').update({ buka_mulai: iso, updated_at: new Date().toISOString() }).eq('id', 1)); },
      async statistik() { return cek(await sb.rpc('tednas_statistik')); },
      async unggahDokumen(file) {
        const path = `dokumen/${acakId()}.${ekstensi(file)}`;
        cek(await sb.storage.from(BUCKET_DOK).upload(path, file, { contentType: file.type, upsert: false }));
        return path;
      },
      async daftar(d) {
        return cek(await sb.rpc('tednas_daftar', {
          p_nama_tim: d.nama_tim, p_wa: d.wa,
          p_prov_kode: d.prov_kode, p_provinsi: d.provinsi, p_kab_kode: d.kab_kode, p_kabupaten: d.kabupaten,
          p_kecamatan: d.kecamatan, p_desa_kode: d.desa_kode, p_desa: d.desa,
          p_pemain: d.pemain, p_captcha: d.captcha
        }));
      },
      async timPublik(o) {
        const q = saringTim(sb.from('tednas_tim_publik').select(KOLOM_PUBLIK, { count: 'exact' }), o)
          .order('created_at', { ascending: false }).range(o.dari, o.dari + o.jumlah - 1);
        const r = cek(await q); return { baris: r.data || [], total: r.count || 0 };
      },
      async matchPublik(o) {
        let q = sb.from('tednas_match_publik').select('*', { count: 'exact' });
        if (o.fase) q = q.eq('fase', o.fase);
        if (o.prov) q = q.eq('prov_kode', o.prov);
        q = q.order('fase', { ascending: false }).order('provinsi').order('ronde', { ascending: false }).order('jadwal', { nullsFirst: false }).order('id');
        const r = cek(await q.range(o.dari || 0, (o.dari || 0) + (o.jumlah || 1000) - 1));
        return { baris: r.data || [], total: r.count || 0 };
      },
      async galeri() { return cek(await sb.from('tednas_galeri').select('*').order('created_at', { ascending: false })); },

      /* --- admin --- */
      async masuk(pengguna, sandi) {
        const email = pengguna.includes('@') ? pengguna : pengguna.trim().toLowerCase() + DOMAIN_ADMIN;
        const { error } = await sb.auth.signInWithPassword({ email, password: sandi });
        if (error) throw error;
      },
      async keluar() { await sb.auth.signOut(); },
      async sesiAdmin() {
        const { data } = await sb.auth.getSession();
        if (!data.session) return false;
        const r = await sb.from('tednas_admin').select('user_id').eq('user_id', data.session.user.id).maybeSingle();
        return !!(r.data);
      },
      async timAdmin(o) {
        const q = saringTim(sb.from('tednas_tim').select('*,pemain:tednas_pemain(*)', { count: 'exact' }), o)
          .order('created_at', { ascending: false }).range(o.dari, o.dari + o.jumlah - 1);
        const r = cek(await q);
        (r.data || []).forEach((t) => t.pemain.sort((a, b) => a.urutan - b.urutan));
        return { baris: r.data || [], total: r.count || 0 };
      },
      async hapusTim(t) {
        cek(await sb.from('tednas_tim').delete().eq('id', t.id));
        await sb.storage.from(BUCKET_DOK).remove(t.pemain.flatMap((p) => [p.dokumen_path, p.profil_ml_path, p.follow_esports_path, p.follow_ppdt_path, p.izin_path]).filter(Boolean));
      },
      async setStatusTim(id, status) { cek(await sb.from('tednas_tim').update({ status }).eq('id', id)); },
      async urlDokumen(path) {
        const r = await sb.storage.from(BUCKET_DOK).createSignedUrl(path, 300);
        if (r.error) throw r.error; return r.data.signedUrl;
      },
      async timTerverifikasiProv(prov) {
        const semua = [];
        for (let dari = 0; ; dari += 1000) {
          const b = cek(await sb.from('tednas_tim').select('id,nama_tim,desa').eq('prov_kode', prov).eq('status', 'terverifikasi').range(dari, dari + 999));
          semua.push(...b); if (b.length < 1000) break;
        }
        return semua;
      },
      async matchSemua(fase, prov) {
        const semua = [];
        for (let dari = 0; ; dari += 1000) {
          const r = await this.matchPublik({ fase, prov, dari, jumlah: 1000 });
          semua.push(...r.baris); if (r.baris.length < 1000) break;
        }
        return semua;
      },
      async tambahMatch(baris) { for (let i = 0; i < baris.length; i += 500) cek(await sb.from('tednas_match').insert(baris.slice(i, i + 500))); },
      async ubahMatch(id, d) { cek(await sb.from('tednas_match').update(d).eq('id', id)); },
      async hapusMatch(id) { cek(await sb.from('tednas_match').delete().eq('id', id)); },
      async hapusRonde(fase, prov, ronde) {
        let q = sb.from('tednas_match').delete().eq('fase', fase).eq('ronde', ronde);
        q = prov ? q.eq('prov_kode', prov) : q.is('prov_kode', null);
        cek(await q);
      },
      async unggahGaleri(file, judul) {
        const path = `${acakId()}.${ekstensi(file)}`;
        cek(await sb.storage.from(BUCKET_GAL).upload(path, file, { contentType: file.type, upsert: false }));
        const url = sb.storage.from(BUCKET_GAL).getPublicUrl(path).data.publicUrl;
        cek(await sb.from('tednas_galeri').insert({ jenis: file.type.startsWith('video') ? 'video' : 'foto', judul, url, path }));
      },
      async tambahTautan(url, judul) { cek(await sb.from('tednas_galeri').insert({ jenis: 'tautan', judul, url })); },
      async hapusGaleri(g) {
        cek(await sb.from('tednas_galeri').delete().eq('id', g.id));
        if (g.path) await sb.storage.from(BUCKET_GAL).remove([g.path]);
      }
    };
  }

  /* ---------- MODE LOKAL ---------- */
  function buatLokal() {
    const baca = (k, d) => { try { return JSON.parse(localStorage.getItem('tednas_' + k)) ?? d; } catch (e) { return d; } };
    const tulis = (k, v) => localStorage.setItem('tednas_' + k, JSON.stringify(v));
    const tim = () => baca('tim', []);
    const match = () => baca('match', []);
    const gabungMatch = (m) => {
      const t = tim(); const a = t.find((x) => x.id === m.tim_a); const b = t.find((x) => x.id === m.tim_b);
      return { ...m, a_nama: a && a.nama_tim, a_desa: a && a.desa, a_kab: a && a.kabupaten, b_nama: b && b.nama_tim, b_desa: b && b.desa, b_kab: b && b.kabupaten };
    };
    const saring = (o) => tim().filter((t) => (!o.prov || t.prov_kode === o.prov) && (!o.status || t.status === o.status) &&
      (!o.cari || [t.nama_tim, t.desa, t.kecamatan, t.kabupaten, t.kode].join(' ').toLowerCase().includes(o.cari.toLowerCase().trim())))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const pub = ({ wa_kapten, nama_kapten, pemain, ...r }) => r;
    const urut = (x) => x.sort((a, b) => (b.fase.localeCompare(a.fase)) || (a.provinsi || '').localeCompare(b.provinsi || '') || b.ronde - a.ronde);
    const keData = (f) => new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(f); });

    return {
      lokal: true,
      async pengaturan() { return baca('set', { pendaftaran_buka: true }); },
      async setPendaftaran(b) { tulis('set', { ...baca('set', { pendaftaran_buka: true }), pendaftaran_buka: b }); },
      async setJadwalBuka(iso) { tulis('set', { ...baca('set', { pendaftaran_buka: true }), buka_mulai: iso }); },
      async statistik() {
        const t = tim(); const per = {};
        t.forEach((x) => { per[x.prov_kode] = per[x.prov_kode] || { prov_kode: x.prov_kode, provinsi: x.provinsi, jumlah: 0 }; per[x.prov_kode].jumlah++; });
        return { total: t.length, terverifikasi: t.filter((x) => x.status === 'terverifikasi').length,
          kabupaten: new Set(t.map((x) => x.kab_kode)).size, provinsi: Object.keys(per).length,
          per_provinsi: Object.values(per).sort((a, b) => b.jumlah - a.jumlah || a.provinsi.localeCompare(b.provinsi)) };
      },
      async unggahDokumen(f) { const p = `dokumen/${acakId()}.${ekstensi(f)}`; const d = baca('dok', {}); d[p] = f.size < 50000 ? await keData(f) : ''; tulis('dok', d); return p; },
      async daftar(d) {
        const t = tim(); let wa = d.wa.replace(/\D/g, ''); if (wa.startsWith('08')) wa = '62' + wa.slice(1);
        const salah = (m) => { throw new Error(m); };
        const set = baca('set', { pendaftaran_buka: true });
        if (!set.pendaftaran_buka) salah('PENDAFTARAN_TUTUP');
        if (set.buka_mulai && Date.now() < new Date(set.buka_mulai).getTime()) salah('PENDAFTARAN_BELUM_DIBUKA');
        if (!/^628\d{7,12}$/.test(wa)) salah('WA_TIDAK_VALID');
        if (t.some((x) => x.wa_kapten === wa)) salah('WA_SUDAH_ADA');
        const seq = baca('seq', 0) + 1; tulis('seq', seq);
        const kode = 'TED-' + String(seq).padStart(5, '0');
        t.push({ id: acakId(), kode, nama_tim: d.nama_tim, nama_kapten: d.pemain[0].nama, wa_kapten: wa, prov_kode: d.prov_kode, provinsi: d.provinsi, kab_kode: d.kab_kode, kabupaten: d.kabupaten, kecamatan: d.kecamatan, desa_kode: d.desa_kode, desa: d.desa, pemain: d.pemain.map((p, i) => ({ ...p, urutan: i + 1 })), status: 'menunggu', created_at: new Date().toISOString() });
        tulis('tim', t); return { kode };
      },
      async timPublik(o) { const a = saring(o); return { baris: a.slice(o.dari, o.dari + o.jumlah).map(pub), total: a.length }; },
      async matchPublik(o) {
        const a = urut(match().filter((m) => (!o.fase || m.fase === o.fase) && (!o.prov || m.prov_kode === o.prov))).map(gabungMatch);
        const dari = o.dari || 0; return { baris: a.slice(dari, dari + (o.jumlah || 1000)), total: a.length };
      },
      async galeri() { return baca('galeri', []); },
      async masuk(u, p) { if (!u || !p) throw new Error('Isi nama pengguna dan sandi'); sessionStorage.setItem('tednas_admin', '1'); },
      async keluar() { sessionStorage.removeItem('tednas_admin'); },
      async sesiAdmin() { return sessionStorage.getItem('tednas_admin') === '1'; },
      async timAdmin(o) { const a = saring(o); return { baris: a.slice(o.dari, o.dari + o.jumlah), total: a.length }; },
      async hapusTim(t) {
        tulis('tim', tim().filter((x) => x.id !== t.id));
        tulis('match', match().map((m) => ({ ...m, tim_a: m.tim_a === t.id ? null : m.tim_a, tim_b: m.tim_b === t.id ? null : m.tim_b, pemenang: m.pemenang === t.id ? null : m.pemenang })));
        const d = baca('dok', {}); t.pemain.forEach((p) => { delete d[p.dokumen_path]; delete d[p.profil_ml_path]; delete d[p.follow_esports_path]; delete d[p.follow_ppdt_path]; delete d[p.izin_path]; }); tulis('dok', d);
      },
      async setStatusTim(id, status) { tulis('tim', tim().map((t) => (t.id === id ? { ...t, status } : t))); },
      async urlDokumen(p) { return baca('dok', {})[p] || 'about:blank'; },
      async timTerverifikasiProv(prov) { return tim().filter((t) => t.prov_kode === prov && t.status === 'terverifikasi'); },
      async matchSemua(fase, prov) { return (await this.matchPublik({ fase, prov, jumlah: 1e6 })).baris; },
      async tambahMatch(b) { tulis('match', match().concat(b.map((m) => ({ id: acakId(), skor_a: null, skor_b: null, jadwal: null, tautan_live: null, ...m })))); },
      async ubahMatch(id, d) { tulis('match', match().map((m) => (m.id === id ? { ...m, ...d } : m))); },
      async hapusMatch(id) { tulis('match', match().filter((m) => m.id !== id)); },
      async hapusRonde(fase, prov, ronde) { tulis('match', match().filter((m) => !(m.fase === fase && (m.prov_kode || null) === (prov || null) && m.ronde === ronde))); },
      async unggahGaleri(f, judul) { const g = baca('galeri', []); g.unshift({ id: acakId(), jenis: f.type.startsWith('video') ? 'video' : 'foto', judul, url: await keData(f) }); tulis('galeri', g); },
      async tambahTautan(url, judul) { const g = baca('galeri', []); g.unshift({ id: acakId(), jenis: 'tautan', judul, url }); tulis('galeri', g); },
      async hapusGaleri(x) { tulis('galeri', baca('galeri', []).filter((g) => g.id !== x.id)); }
    };
  }

  window.DB = lokal ? buatLokal() : buatSupabase();
})();
