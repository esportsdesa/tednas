/* Halaman perbaikan berkas untuk kapten (migrasi 12). Dibuka dari tautan di pesan WhatsApp panitia:
   perbaiki.html#<kode tim>.<token>. Token ada di bagian # supaya tidak ikut terkirim ke server mana pun.
   Kapten mengganti nama pemain, jenis kartu identitas, atau berkas → berkas diunggah ke Web App Drive seperti saat
   mendaftar → tednas_perbaiki_simpan. Agen AI lalu memeriksa ulang tim itu dengan sendirinya. */
(function () {
  const { $, $$, esc } = U;
  const MAKS_BERKAS = 5 * 1024 * 1024;
  const MAKS_FOTO_ASLI = 25 * 1024 * 1024;
  const FOTO = ['image/jpeg', 'image/png'];
  const PESAN_GALAT = {
    TAUTAN_TIDAK_SAH: 'Tautan ini tidak berlaku. Buka lagi tautan dari pesan WhatsApp panitia, jangan diketik ulang.',
    SUDAH_TERVERIFIKASI: 'Tim ini sudah terverifikasi, jadi datanya tidak bisa diubah lagi.',
    PEMAIN_TIDAK_LENGKAP: 'Nama pemain minimal 2 huruf.',
    PEMAIN_TIDAK_ADA: 'Data pemain tidak cocok. Muat ulang halaman ini.',
    DOKUMEN_TIDAK_ADA: 'Kartu identitas gagal tersimpan, atau berkas yang sama sudah dipakai pemain lain. Unggah lagi.',
    PROFIL_ML_TIDAK_ADA: 'Screenshot profil ML gagal tersimpan. Unggah lagi.',
    FOLLOW_TIDAK_ADA: 'Bukti follow Instagram gagal tersimpan. Unggah lagi.',
    IZIN_TIDAK_ADA: 'Surat izin gagal tersimpan. Unggah lagi.',
    DRIVE_SIBUK: 'Server berkas sedang ramai. Tunggu sebentar lalu tekan Simpan lagi, berkas yang sudah terunggah tidak diulang.',
    DRIVE_JARINGAN: 'Koneksi terputus saat mengunggah. Tekan Simpan lagi, berkas yang sudah terunggah tidak diulang.',
    DRIVE_ISI_TIDAK_SAH: 'Ada berkas yang rusak atau bukan foto/PDF asli. Unggah ulang berkas itu.',
    DRIVE_TERLALU_BESAR: 'Ada berkas yang lebih dari 5 MB. Foto ulang atau perkecil dulu.',
    DRIVE_JENIS_TIDAK_SAH: 'Ada berkas yang bukan JPG, PNG, atau PDF.'
  };
  // [kunci, kolom database, judul, keterangan, boleh PDF]
  const BERKAS = [
    ['dok', 'dokumen_path', 'Kartu identitas', 'Foto atau PDF', true],
    ['ml', 'profil_ml_path', 'Profil Mobile Legends', 'Screenshot, ID & server terlihat', false],
    ['ig1', 'follow_esports_path', 'Follow @esportsdesa.official', 'Screenshot, tombol "Mengikuti"', false],
    ['ig2', 'follow_ppdt_path', 'Follow @ditjen_ppdt', 'Screenshot, tombol "Mengikuti"', false],
    ['izin', 'izin_path', 'Surat izin orang tua/wali', 'Wajib bila di bawah 17 tahun', true]
  ];
  const JENIS_DOK = [['KTP', 'KTP'], ['KK', 'KK'], ['Kartu Pelajar', 'Kartu Pelajar'], ['Suket RT/RW', 'Surat keterangan domisili']];

  const [kode, token] = decodeURIComponent(location.hash.slice(1)).split('.');
  let data = null, sibuk = false;
  const berkas = {}; // berkas[urutan][kunci] = { f: File, path: '' } — path tersimpan supaya Simpan ulang tidak mengunggah lagi

  const galat = (t) => { $('#salah').textContent = t || ''; $('#salah').hidden = !t; };
  const teksGalat = (e) => { const k = Object.keys(PESAN_GALAT).find((x) => String(e && e.message).includes(x)); return k ? PESAN_GALAT[k] : ''; };

  function gagalMuat(t) { $('#pb-muat').hidden = true; $('#pb').hidden = true; const g = $('#pb-galat'); g.textContent = t; g.hidden = false; }

  async function muat(kabarSimpan) {
    if (!kode || !token) { gagalMuat('Tautannya tidak lengkap. Buka lagi tautan dari pesan WhatsApp panitia.'); return; }
    try { data = await DB.perbaikiLihat(kode, token); }
    catch (e) { gagalMuat(teksGalat(e) || 'Data tim gagal dimuat. Cek koneksi lalu muat ulang halaman ini.'); return; }
    Object.keys(berkas).forEach((k) => delete berkas[k]);
    gambar(kabarSimpan);
  }

  function gambar(kabarSimpan) {
    const d = data, ai = d.ai, saran = SARAN.daftar(ai, d.pemain);
    $('#pb-muat').hidden = true; $('#pb-galat').hidden = true; $('#pb').hidden = false;
    $('#pb-kode').textContent = d.kode;
    $('#pb-nama').textContent = d.nama_tim;
    $('#pb-desa').textContent = `Desa ${d.desa}, ${d.kabupaten}, ${d.provinsi}`;
    const grup = (window.APP_CONFIG || {}).WA_GRUP;
    if (grup) { $('#wa-grup-link').href = grup; $('#wa-grup').hidden = false; }

    const terverifikasi = d.status === 'terverifikasi';
    const nCatatan = saran.tim.length + saran.pemain.reduce((n, p) => n + p.saran.length, 0);
    let kabar, kelas = 'pb-info';
    if (terverifikasi) { kabar = '<b>Tim kamu sudah TERVERIFIKASI.</b> Tidak ada yang perlu diperbaiki. Sampai jumpa di pertandingan!'; kelas = 'pb-ok'; }
    else if (kabarSimpan || (ai && !ai.segar)) {
      kabar = `<b>${kabarSimpan ? 'Perbaikan tersimpan.' : 'Perbaikan sudah diterima.'}</b> Berkas sedang dicek ulang otomatis, biasanya beberapa menit sampai satu jam. Kalau semuanya sesuai, tim langsung terverifikasi. Buka lagi tautan ini nanti untuk melihat hasilnya.`
        + (nCatatan ? ' Catatan di bawah adalah hasil pemeriksaan sebelum perbaikan.' : '');
      kelas = 'pb-ok';
    } else if (!ai || ai.akhir === 'galat') kabar = 'Berkas tim kamu sedang diperiksa. Kalau ada berkas yang ingin diganti, kamu tetap bisa menggantinya di bawah.';
    else if (!nCatatan) kabar = 'Dari pemeriksaan berkas tidak ada yang perlu diperbaiki. Tim kamu tinggal menunggu konfirmasi panitia.';
    else { kabar = `<b>Ada ${nCatatan} catatan.</b> Perbaiki yang ditandai di bawah, lalu tekan <b>Simpan Perbaikan</b>.`; kelas = 'pb-perlu'; }
    const k = $('#pb-kabar'); k.className = 'pb-kabar ' + kelas; k.innerHTML = kabar;

    const st = $('#pb-saran-tim');
    st.innerHTML = saran.tim.map((s) => `<li>${esc(s.teks)}</li>`).join(''); st.hidden = !saran.tim.length || terverifikasi;
    $('#pb-form').hidden = terverifikasi;
    if (terverifikasi) return;

    const per = new Map(saran.pemain.map((p) => [p.urutan, p.saran]));
    $('#pb-pemain').innerHTML = d.pemain.map((p) => {
      const s = per.get(p.urutan) || [], perlu = new Set(s.map((x) => x.kolom));
      const tanda = (k) => (perlu.has(k) ? ' perlu' : '');
      return `<fieldset class="blok-pemain pb-pemain${s.length ? ' ada-catatan' : ''}" data-u="${p.urutan}">
        <legend>${esc(SARAN.labelPemain(p.urutan))}: ${esc(p.nama)}</legend>
        ${s.length ? `<ul class="pb-saran">${s.map((x) => `<li>${esc(x.teks)}</li>`).join('')}</ul>` : '<p class="bantu">Tidak ada catatan untuk pemain ini.</p>'}
        <details ${s.length ? 'open' : ''}><summary>${s.length ? 'Perbaiki data pemain ini' : 'Ganti data pemain ini'}</summary>
          <label class="isian${tanda('nama')}">Nama lengkap sesuai kartu identitas
            <input type="text" data-nama maxlength="80" value="${esc(p.nama)}" autocomplete="off"></label>
          <label class="isian">Jenis kartu identitas
            <select data-jenis>${JENIS_DOK.map(([v, t]) => `<option value="${v}" ${p.dokumen_jenis === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
          <div class="dua-unggah">${BERKAS.map(([kunci, , judul, ket, pdf]) => `<label class="jatuhan${tanda(kunci)}"><input type="file" data-file="${kunci}" accept="${pdf ? 'application/pdf,' : ''}image/jpeg,image/png">${esc(judul)}<small>${esc(kunci === 'izin' && p.ada_izin ? 'Sudah ada; unggah untuk mengganti' : ket)}</small><span data-status="${kunci}"></span></label>`).join('')}</div>
          ${perlu.has('izin') ? `<p class="bantu">Format surat izin: ${U.unduhIzin}</p>` : ''}
        </details>
      </fieldset>`;
    }).join('');
    ringkas();
  }

  /* Berapa yang akan diubah, supaya kapten tahu tombol Simpan akan mengirim apa. */
  function perubahan() {
    const ubah = [], unggah = [];
    for (const p of data.pemain) {
      const blok = $(`[data-u="${p.urutan}"]`), x = { urutan: p.urutan };
      const nama = $('[data-nama]', blok).value.trim(), jenis = $('[data-jenis]', blok).value;
      if (nama !== p.nama) x.nama = nama;
      if (jenis !== p.dokumen_jenis) x.dokumen_jenis = jenis;
      for (const [kunci, kolom] of BERKAS) if (berkas[p.urutan] && berkas[p.urutan][kunci]) unggah.push({ x, u: p.urutan, kunci, kolom });
      if (Object.keys(x).length > 1 || unggah.some((t) => t.x === x)) ubah.push(x);
    }
    return { ubah, unggah };
  }
  function ringkas() {
    const { ubah, unggah } = perubahan();
    $('#pb-ringkas').textContent = ubah.length ? `${unggah.length} berkas baru, ${ubah.length} pemain diubah` : 'Belum ada yang diubah';
  }

  $('#pb-pemain').addEventListener('input', (e) => { if (e.target.matches('[data-nama]')) ringkas(); });
  $('#pb-pemain').addEventListener('change', async (e) => {
    const blok = e.target.closest('[data-u]'); if (!blok) return;
    if (e.target.matches('[data-jenis]')) { ringkas(); return; }
    const kunci = e.target.dataset.file, f = e.target.files && e.target.files[0];
    if (!kunci || !f) return;
    const u = Number(blok.dataset.u), bolehPdf = kunci === 'dok' || kunci === 'izin';
    if (!FOTO.includes(f.type) && !(bolehPdf && f.type === 'application/pdf')) {
      galat(bolehPdf ? 'Berkas ini harus berupa foto (JPG/PNG) atau PDF.' : 'Screenshot harus JPG atau PNG.'); return;
    }
    if (f.size > (f.type === 'application/pdf' ? MAKS_BERKAS : MAKS_FOTO_ASLI)) {
      galat(f.type === 'application/pdf' ? 'PDF-nya lebih dari 5 MB. Perkecil dulu ya.' : 'Fotonya terlalu besar. Coba foto ulang.'); return;
    }
    galat('');
    const status = $(`[data-status="${kunci}"]`, blok);
    status.textContent = 'Menyiapkan...';
    const siap = await U.kecilkanFoto(f);
    if (siap.size > MAKS_BERKAS) { status.textContent = ''; galat('Berkasnya masih lebih dari 5 MB. Coba foto ulang.'); return; }
    (berkas[u] = berkas[u] || {})[kunci] = { f: siap, path: '' };
    status.innerHTML = `<span class="berkas-ok">${esc(siap.name)}</span>`;
    ringkas();
  });

  $('#pb-form').onsubmit = async (e) => {
    e.preventDefault();
    if (sibuk) return;
    galat('');
    const { ubah, unggah } = perubahan();
    if (!ubah.length) { galat('Belum ada yang diubah. Ganti nama atau unggah berkas baru dulu.'); return; }
    const pendek = ubah.find((x) => x.nama !== undefined && x.nama.length < 2);
    if (pendek) { galat(`Nama ${SARAN.labelPemain(pendek.urutan).toLowerCase()} minimal 2 huruf.`); return; }
    sibuk = true;
    const tombol = $('#pb-simpan'); tombol.disabled = true;
    try {
      // Dua berkas sekaligus, seperti di halaman daftar. Yang sudah terunggah tidak diulang saat Simpan ditekan lagi.
      const antre = unggah.filter((t) => !berkas[t.u][t.kunci].path);
      let selesai = unggah.length - antre.length;
      tombol.textContent = `Mengunggah ${selesai} dari ${unggah.length}...`;
      const kerja = async () => {
        while (antre.length) {
          const t = antre.shift(), b = berkas[t.u][t.kunci];
          try { b.path = await DB.unggahDokumen(b.f); }
          catch (err) { antre.length = 0; err.berkas = `${BERKAS.find((x) => x[0] === t.kunci)[2]} ${SARAN.labelPemain(t.u)}`; throw err; }
          tombol.textContent = `Mengunggah ${++selesai} dari ${unggah.length}...`;
        }
      };
      await Promise.all([kerja(), kerja()]);
      for (const t of unggah) t.x[t.kolom] = berkas[t.u][t.kunci].path;
      tombol.textContent = 'Menyimpan...';
      await DB.perbaikiSimpan(data.kode, token, ubah);
      await muat(true);
      window.scrollTo(0, 0);
    } catch (err) {
      galat((teksGalat(err) || 'Belum tersimpan. Cek koneksi lalu coba lagi.') + (err.berkas ? ` (berkas: ${err.berkas})` : ''));
    } finally { sibuk = false; tombol.disabled = false; tombol.textContent = 'Simpan Perbaikan'; }
  };

  muat();
})();
