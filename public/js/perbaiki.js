/* Halaman ubah data tim untuk kapten (migrasi 12 + 15). Dibuka dari tautan di pesan WhatsApp panitia:
   perbaiki#<kode tim>.<token>. Token ada di bagian # supaya tidak ikut terkirim ke server mana pun.
   Semua data bisa diubah (user 18 Nov: "biarin aja semua data bisa diedit"): nama tim, nomor WA kapten, desa, data &
   berkas pemain, serta tambah/hapus pemain cadangan — juga setelah tim terverifikasi. Berkas diunggah ke Web App Drive
   seperti saat mendaftar → tednas_ubah_tim. Agen AI lalu memeriksa ulang tim itu dengan sendirinya.
   Bila migrasi 15 belum terpasang, halaman jatuh ke mode lama (hanya pemain & berkas, tim Menunggu saja). */
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
    NAMA_TIM_TIDAK_VALID: 'Nama tim 2–60 huruf.',
    WA_TIDAK_VALID: 'Nomor WhatsApp kapten tidak valid. Pakai nomor HP Indonesia, contoh 0812xxxxxxx.',
    WA_SUDAH_ADA: 'Nomor WhatsApp ini sudah dipakai kapten tim lain.',
    WILAYAH_TIDAK_VALID: 'Desa tidak valid. Pilih ulang provinsi, kabupaten/kota, dan desanya (kelurahan dan DKI Jakarta tidak bisa).',
    HANYA_CADANGAN: 'Hanya pemain cadangan yang bisa ditambah atau dihapus. Pemain inti diganti saja nama dan berkasnya.',
    CADANGAN_SUDAH_ADA: 'Tim ini sudah punya pemain cadangan. Muat ulang halaman ini.',
    ISIAN_TIDAK_SAH: 'Belum ada yang diubah.',
    DRIVE_SIBUK: 'Server berkas sedang ramai. Tunggu sebentar lalu tekan Simpan lagi, berkas yang sudah terunggah tidak diulang.',
    DRIVE_JARINGAN: 'Koneksi terputus saat mengunggah. Tekan Simpan lagi, berkas yang sudah terunggah tidak diulang.',
    DRIVE_ISI_TIDAK_SAH: 'Ada berkas yang rusak atau bukan foto/PDF asli. Unggah ulang berkas itu.',
    DRIVE_TERLALU_BESAR: 'Ada berkas yang lebih dari 5 MB. Foto ulang atau perkecil dulu.',
    DRIVE_JENIS_TIDAK_SAH: 'Ada berkas yang bukan JPG, PNG, atau PDF.'
  };
  // [kunci, kolom database, judul, keterangan, boleh PDF, wajib untuk pemain baru]
  const BERKAS = [
    ['dok', 'dokumen_path', 'Kartu identitas', 'Foto atau PDF', true, true],
    ['ml', 'profil_ml_path', 'Profil Mobile Legends', 'Screenshot, ID & server terlihat', false, true],
    ['ig1', 'follow_esports_path', 'Follow @esportsdesa.official', 'Screenshot, tombol "Mengikuti"', false, true],
    ['ig2', 'follow_ppdt_path', 'Follow @ditjen_ppdt', 'Screenshot, tombol "Mengikuti"', false, true],
    ['izin', 'izin_path', 'Surat izin orang tua/wali', 'Wajib bila di bawah 17 tahun', true, false]
  ];
  const JENIS_DOK = [['KTP', 'KTP'], ['KK', 'KK'], ['Kartu Pelajar', 'Kartu Pelajar'], ['Suket RT/RW', 'Surat keterangan domisili']];

  const [kode, token] = decodeURIComponent(location.hash.slice(1)).split('.');
  let data = null, sibuk = false, cadanganBaru = false, desaBaru = null, desaSemua = [], timTerbuka = false;
  const berkas = {}; // berkas[urutan][kunci] = { f: File, path: '' } — path tersimpan supaya Simpan ulang tidak mengunggah lagi
  const bisaUbahTim = () => Boolean(DB.ubahAda && data && data.wa_kapten !== undefined);

  const galat = (t) => { $('#salah').textContent = t || ''; $('#salah').hidden = !t; };
  const teksGalat = (e) => { const k = Object.keys(PESAN_GALAT).find((x) => String(e && e.message).includes(x)); return k ? PESAN_GALAT[k] : ''; };
  const waTampil = (w) => (w ? '0' + String(w).replace(/^62/, '') : '');
  const waNormal = (v) => { let w = String(v || '').replace(/\D/g, ''); if (w.startsWith('08')) w = '62' + w.slice(1); return w; };

  function gagalMuat(t) { $('#pb-muat').hidden = true; $('#pb').hidden = true; const g = $('#pb-galat'); g.textContent = t; g.hidden = false; }

  async function muat(kabarSimpan) {
    if (!kode || !token) { gagalMuat('Tautannya tidak lengkap. Buka lagi tautan dari pesan WhatsApp panitia.'); return; }
    try { data = await DB.ubahLihat(kode, token); }
    catch (e) { gagalMuat(teksGalat(e) || 'Data tim gagal dimuat. Cek koneksi lalu muat ulang halaman ini.'); return; }
    Object.keys(berkas).forEach((k) => delete berkas[k]);
    cadanganBaru = false; desaBaru = null; timTerbuka = false;
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

    const terverifikasi = d.status === 'terverifikasi', terkunci = terverifikasi && !bisaUbahTim();
    const nCatatan = saran.tim.length + saran.pemain.reduce((n, p) => n + p.saran.length, 0);
    let kabar, kelas = 'pb-info';
    if (kabarSimpan) { kabar = '<b>Perubahan tersimpan.</b> Data dicek ulang otomatis, biasanya beberapa menit sampai satu jam. Buka lagi tautan ini nanti untuk melihat hasilnya.'; kelas = 'pb-ok'; }
    else if (terverifikasi) { kabar = `<b>Tim kamu sudah TERVERIFIKASI.</b> ${terkunci ? 'Sampai jumpa di pertandingan!' : 'Kalau ada data yang perlu diubah, ubah di bawah. Setelah disimpan, data dicek ulang otomatis.'}`; kelas = 'pb-ok'; }
    else if (ai && !ai.segar) { kabar = '<b>Perubahan sudah diterima.</b> Data sedang dicek ulang otomatis. Kalau semuanya sesuai, tim langsung terverifikasi.' + (nCatatan ? ' Catatan di bawah adalah hasil pemeriksaan sebelum perubahan.' : ''); kelas = 'pb-ok'; }
    else if (!ai || ai.akhir === 'galat') kabar = 'Berkas tim kamu sedang diperiksa. Kalau ada data yang ingin diubah, kamu tetap bisa mengubahnya di bawah.';
    else if (!nCatatan) kabar = 'Dari pemeriksaan berkas tidak ada yang perlu diperbaiki. Kalau ada data yang ingin diubah, ubah di bawah.';
    else { kabar = `<b>Ada ${nCatatan} catatan.</b> Perbaiki yang ditandai di bawah, lalu tekan <b>Simpan Perubahan</b>.`; kelas = 'pb-perlu'; }
    const k = $('#pb-kabar'); k.className = 'pb-kabar ' + kelas; k.innerHTML = kabar;

    const st = $('#pb-saran-tim');
    st.innerHTML = saran.tim.map((s) => `<li>${esc(s.teks)}</li>`).join(''); st.hidden = !saran.tim.length;
    $('#pb-form').hidden = terkunci;
    if (terkunci) return;

    $('#pb-data-tim').innerHTML = bisaUbahTim() ? `<fieldset class="blok-pemain pb-pemain pb-tim-form"><legend>Data tim</legend>
        <details${saran.tim.length || timTerbuka ? ' open' : ''}><summary>Ubah nama tim, nomor WhatsApp kapten, atau desa</summary>
        <label class="isian">Nama tim<input type="text" id="pb-nama-tim" maxlength="60" value="${esc(d.nama_tim)}" autocomplete="off"></label>
        <label class="isian">Nomor WhatsApp kapten<input type="tel" id="pb-wa" inputmode="tel" maxlength="20" value="${esc(waTampil(d.wa_kapten))}" autocomplete="off"><small>Pesan panitia dikirim ke nomor ini.</small></label>
        <div class="isian">Desa yang diwakili
          <div class="pb-desa-kini" id="pb-desa-kini">${desaBaru ? `<b>Desa ${esc(desaBaru.desa)} (baru)</b><small>Kec. ${esc(desaBaru.kecamatan)}, ${esc(desaBaru.kabupaten)}, ${esc(desaBaru.provinsi)}</small><button type="button" class="tautan" id="pb-batal-desa">Batal ganti desa</button>` : `<b>Desa ${esc(d.desa)}</b><small>Kec. ${esc(d.kecamatan || '')}, ${esc(d.kabupaten)}, ${esc(d.provinsi)}</small><button type="button" class="tautan" id="pb-ganti-desa">Ganti desa</button>`}</div>
          <div class="pb-desa-pilih" id="pb-desa-pilih" hidden>
            <select id="pb-prov" aria-label="Provinsi"><option value="">Memuat provinsi...</option></select>
            <select id="pb-kab" aria-label="Kabupaten/kota" disabled><option value="">Pilih provinsi dulu</option></select>
            <input type="search" id="pb-cari-desa" placeholder="Pilih kabupaten/kota dulu" disabled autocomplete="off" aria-label="Cari desa">
            <div class="desa-daftar" id="pb-daftar-desa" hidden></div>
            <button type="button" class="tautan" id="pb-batal-desa">Batal ganti desa</button>
          </div>
          <small>Semua pemain harus berdomisili di kabupaten/kota yang sama dengan desa ini.</small></div>
        </details></fieldset>` : '';

    const per = new Map(saran.pemain.map((p) => [p.urutan, p.saran]));
    const adaCadangan = d.pemain.some((p) => p.urutan === 6);
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
          ${p.urutan === 6 && bisaUbahTim() ? '<label class="pb-hapus"><input type="checkbox" data-hapus> Hapus pemain cadangan ini dari tim</label>' : ''}
        </details>
      </fieldset>`;
    }).join('') + (bisaUbahTim() && !adaCadangan ? (cadanganBaru ? blokCadanganBaru() : '<button type="button" class="btn btn-garis-gelap pb-tambah" id="pb-tambah-cadangan">+ Tambah pemain cadangan</button>') : '');
    ringkas();
  }

  function blokCadanganBaru() {
    return `<fieldset class="blok-pemain pb-pemain pb-baru" data-u="6" data-baru>
      <legend>${esc(SARAN.labelPemain(6))} baru</legend>
      <label class="isian">Nama lengkap sesuai kartu identitas<input type="text" data-nama maxlength="80" value="" autocomplete="off"></label>
      <label class="isian">Jenis kartu identitas<select data-jenis>${JENIS_DOK.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>
      <div class="dua-unggah">${BERKAS.map(([kunci, , judul, ket, pdf, wajib]) => `<label class="jatuhan"><input type="file" data-file="${kunci}" accept="${pdf ? 'application/pdf,' : ''}image/jpeg,image/png">${esc(judul)}${wajib ? ' *' : ''}<small>${esc(ket)}</small><span data-status="${kunci}"></span></label>`).join('')}</div>
      <p class="bantu">Format surat izin: ${U.unduhIzin}</p>
      <button type="button" class="tautan" id="pb-batal-cadangan">Batal menambah cadangan</button>
    </fieldset>`;
  }

  /* ── pilih desa baru (sama dengan formulir daftar: provinsi → kabupaten/kota → cari desa) ── */
  const normal = (t) => t.toLowerCase().replace(/[^a-z0-9]/g, '');
  async function bukaPilihDesa() {
    $('#pb-desa-kini').hidden = true; $('#pb-desa-pilih').hidden = false;
    const p = await U.provinsi();
    $('#pb-prov').innerHTML = '<option value="">Pilih provinsi</option>' + p.map(([k, n]) => `<option value="${esc(k)}">${esc(n)}</option>`).join('');
  }
  function gambarDesa() {
    const mentah = $('#pb-cari-desa').value.trim(), q = normal(mentah);
    const cocok = desaSemua.filter((r) => !q || normal(r[1]).includes(q) || normal(r[2]).includes(q)).slice(0, 60);
    const daftar = $('#pb-daftar-desa'); daftar.hidden = false;
    daftar.innerHTML = cocok.map((r) => `<button type="button" class="desa-opsi" data-k="${esc(r[0])}">${esc(r[1])}<small>Kec. ${esc(r[2])}</small></button>`).join('') || `<div class="desa-info">"${esc(mentah)}" tidak ketemu.</div>`;
  }
  $('#pb-form').addEventListener('change', async (e) => {
    if (e.target.id === 'pb-prov') {
      const kab = $('#pb-kab'); kab.disabled = true; desaSemua = []; $('#pb-cari-desa').disabled = true; $('#pb-daftar-desa').hidden = true;
      if (!e.target.value) return;
      const k = await U.jsonData(`data/kab/${e.target.value}.json`);
      kab.innerHTML = '<option value="">Pilih kabupaten/kota</option>' + k.map(([a, n]) => `<option value="${esc(a)}">${esc(n)}</option>`).join(''); kab.disabled = false;
    } else if (e.target.id === 'pb-kab' && e.target.value) {
      desaSemua = await U.jsonData(`data/desa/${e.target.value}.json`);
      const c = $('#pb-cari-desa'); c.disabled = false; c.placeholder = `Ketik nama desa (ada ${U.angka(desaSemua.length)})`; gambarDesa(); c.focus();
    }
  });
  $('#pb-form').addEventListener('input', (e) => { if (e.target.id === 'pb-cari-desa') gambarDesa(); else ringkas(); });
  $('#pb-form').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'pb-ganti-desa') return bukaPilihDesa();
    if (b.id === 'pb-batal-desa') { desaBaru = null; simpanIsianLalu(gambar); return; }
    if (b.id === 'pb-tambah-cadangan') { cadanganBaru = true; simpanIsianLalu(gambar); return; }
    if (b.id === 'pb-batal-cadangan') { cadanganBaru = false; delete berkas[6]; simpanIsianLalu(gambar); return; }
    if (b.dataset.k) {
      const r = desaSemua.find((x) => x[0] === b.dataset.k); if (!r) return;
      const prov = $('#pb-prov'), kab = $('#pb-kab');
      desaBaru = { prov_kode: prov.value, provinsi: prov.selectedOptions[0].textContent, kab_kode: kab.value, kabupaten: kab.selectedOptions[0].textContent, kecamatan: r[2], desa_kode: r[0], desa: r[1] };
      $('#pb-desa-pilih').hidden = true; $('#pb-desa-kini').hidden = false;
      $('#pb-desa-kini').innerHTML = `<b>Desa ${esc(r[1])} (baru)</b><small>Kec. ${esc(r[2])}, ${esc(desaBaru.kabupaten)}, ${esc(desaBaru.provinsi)}</small><button type="button" class="tautan" id="pb-batal-desa">Batal ganti desa</button>`;
      ringkas();
    }
  });
  // Menggambar ulang daftar pemain tanpa kehilangan isian yang sudah diketik.
  function simpanIsianLalu(f) {
    const nilai = { tim: $('#pb-nama-tim')?.value, wa: $('#pb-wa')?.value, pemain: $$('[data-u]').map((b) => ({ u: b.dataset.u, baru: b.hasAttribute('data-baru'), nama: $('[data-nama]', b)?.value, jenis: $('[data-jenis]', b)?.value, hapus: $('[data-hapus]', b)?.checked })) };
    timTerbuka = Boolean($('#pb-data-tim details')?.open);
    f();
    if ($('#pb-nama-tim') && nilai.tim !== undefined) $('#pb-nama-tim').value = nilai.tim;
    if ($('#pb-wa') && nilai.wa !== undefined) $('#pb-wa').value = nilai.wa;
    for (const p of nilai.pemain) { const b = $(`[data-u="${p.u}"]${p.baru ? '[data-baru]' : ':not([data-baru])'}`); if (!b) continue; if ($('[data-nama]', b)) $('[data-nama]', b).value = p.nama; if ($('[data-jenis]', b)) $('[data-jenis]', b).value = p.jenis; if ($('[data-hapus]', b)) $('[data-hapus]', b).checked = p.hapus; }
    ringkas();
  }

  /* Apa saja yang akan diubah, supaya kapten tahu tombol Simpan akan mengirim apa. */
  function perubahan() {
    const ubah = [], unggah = [], tim = {};
    if (bisaUbahTim()) {
      const nt = $('#pb-nama-tim').value.trim(), wa = $('#pb-wa').value.trim();
      if (nt !== data.nama_tim) tim.nama_tim = nt;
      if (waNormal(wa) !== data.wa_kapten) tim.wa = wa;
      if (desaBaru && desaBaru.desa_kode !== data.desa_kode) Object.assign(tim, desaBaru);
    }
    for (const blok of $$('[data-u]')) {
      const u = Number(blok.dataset.u), baru = blok.hasAttribute('data-baru'), p = data.pemain.find((x) => x.urutan === u);
      const x = { urutan: u };
      if ($('[data-hapus]', blok)?.checked) { ubah.push({ urutan: u, hapus: true }); continue; }
      const nama = $('[data-nama]', blok).value.trim(), jenis = $('[data-jenis]', blok).value;
      if (baru) { Object.assign(x, { baru: true, nama, dokumen_jenis: jenis }); }
      else { if (nama !== p.nama) x.nama = nama; if (jenis !== p.dokumen_jenis) x.dokumen_jenis = jenis; }
      for (const [kunci, kolom] of BERKAS) if (berkas[u] && berkas[u][kunci]) unggah.push({ x, u, kunci, kolom });
      if (baru || Object.keys(x).length > 1 || unggah.some((t) => t.x === x)) ubah.push(x);
    }
    return { ubah, unggah, tim };
  }
  function ringkas() {
    const { ubah, unggah, tim } = perubahan(), nTim = Object.keys(tim).length ? 1 : 0;
    const bagian = [nTim && 'data tim', unggah.length && `${unggah.length} berkas baru`, ubah.length && `${ubah.length} pemain diubah`].filter(Boolean);
    $('#pb-ringkas').textContent = bagian.length ? bagian.join(', ') : 'Belum ada yang diubah';
  }

  $('#pb-form').addEventListener('change', async (e) => {
    const blok = e.target.closest('[data-u]'); if (!blok) return;
    if (e.target.matches('[data-jenis], [data-hapus]')) { ringkas(); return; }
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
    const { ubah, unggah, tim } = perubahan();
    if (!ubah.length && !Object.keys(tim).length) { galat('Belum ada yang diubah. Ganti data atau unggah berkas baru dulu.'); return; }
    if (tim.nama_tim !== undefined && tim.nama_tim.length < 2) { galat(PESAN_GALAT.NAMA_TIM_TIDAK_VALID); return; }
    if (tim.wa !== undefined && !/^628\d{7,12}$/.test(waNormal(tim.wa))) { galat(PESAN_GALAT.WA_TIDAK_VALID); return; }
    const pendek = ubah.find((x) => x.nama !== undefined && x.nama.length < 2);
    if (pendek) { galat(`Nama ${SARAN.labelPemain(pendek.urutan).toLowerCase()} minimal 2 huruf.`); return; }
    const baru = ubah.find((x) => x.baru);
    if (baru) {
      const kurang = BERKAS.filter(([k, , , , , wajib]) => wajib && !(berkas[6] && berkas[6][k])).map((b) => b[2]);
      if (kurang.length) { galat(`Pemain cadangan baru belum lengkap: ${kurang.join(', ')}.`); return; }
    }
    if (ubah.some((x) => x.hapus) && !confirm('Hapus pemain cadangan dari tim? Data dan berkasnya ikut dilepas dari tim ini.')) return;
    sibuk = true;
    const tombol = $('#pb-simpan'); tombol.disabled = true;
    try {
      // Dua berkas sekaligus, seperti di halaman daftar. Yang sudah terunggah tidak diulang saat Simpan ditekan lagi.
      const antre = unggah.filter((t) => !berkas[t.u][t.kunci].path);
      let selesai = unggah.length - antre.length;
      if (unggah.length) tombol.textContent = `Mengunggah ${selesai} dari ${unggah.length}...`;
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
      await DB.ubahSimpan(data.kode, token, ubah, Object.keys(tim).length ? tim : null);
      await muat(true);
      window.scrollTo(0, 0);
    } catch (err) {
      galat((teksGalat(err) || 'Belum tersimpan. Cek koneksi lalu coba lagi.') + (err.berkas ? ` (berkas: ${err.berkas})` : ''));
    } finally { sibuk = false; tombol.disabled = false; tombol.textContent = 'Simpan Perubahan'; }
  };

  muat();
})();
