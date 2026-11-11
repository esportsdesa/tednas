/* Penyimpanan Google Drive TEDNas: berkas pendaftar diunggah langsung ke Web App Apps Script milik
   pemilik Drive (deploy/drive/Code.gs), tidak lewat bucket Supabase. Aktif bila APP_CONFIG.DRIVE_URL diisi;
   kosong = tetap memakai bucket Supabase seperti sebelumnya. */
(function () {
  const URL_DRIVE = String((window.APP_CONFIG || {}).DRIVE_URL || '').trim();
  const aktif = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(URL_DRIVE);
  const tidur = (ms) => new Promise((ok) => setTimeout(ok, ms));
  const galat = (pesan, ulang) => Object.assign(new Error(pesan), { ulang });

  async function keBase64(blob) {
    const b = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(s);
  }

  /* text/plain supaya tanpa preflight CORS. Jawaban bukan JSON = halaman galat Google (mis. terlalu banyak
     eksekusi bersamaan) → dicoba lagi dengan jeda yang makin panjang. */
  async function panggil(isi, coba) {
    let akhir = galat('DRIVE_GAGAL', true);
    for (let i = 0; i < coba; i++) {
      if (i) await tidur(1500 * i + Math.random() * 1500);
      try {
        const r = await fetch(URL_DRIVE, { method: 'POST', body: JSON.stringify(isi), headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow' });
        let j;
        try { j = JSON.parse(await r.text()); } catch (e) { akhir = galat('DRIVE_SIBUK', true); continue; }
        if (j && j.ok) return j;
        akhir = galat('DRIVE_' + ((j && j.pesan) || 'GAGAL'), Boolean(j && j.ulang));
        if (!akhir.ulang) throw akhir;
      } catch (e) {
        if (e.ulang === false) throw e;
        akhir = e.ulang ? e : galat('DRIVE_JARINGAN', true); // fetch gagal: sinyal putus, dsb.
      }
    }
    throw akhir;
  }

  window.DRIVE = {
    aktif,
    /** → path "gdrive/<id>.<ext>~<tanda>" untuk tednas_daftar(). */
    async unggah(file) {
      if (!aktif) throw galat('DRIVE_BELUM_DIATUR', false);
      return (await panggil({ aksi: 'unggah', mime: file.type, data: await keBase64(file) }, 5)).path;
    },
    /** Admin: isi berkas Drive → alamat blob: (dibuang otomatis setelah 10 menit). */
    async buka(path, token) {
      if (!aktif) throw galat('Alamat Drive belum diatur di config.js', false);
      const j = await panggil({ aksi: 'berkas', path, token }, 3);
      const bin = atob(j.data);
      const b = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([b], { type: j.mime || 'application/octet-stream' }));
      setTimeout(() => URL.revokeObjectURL(url), 10 * 60 * 1000);
      return url;
    }
  };
})();
