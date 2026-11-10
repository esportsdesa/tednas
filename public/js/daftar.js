(function () {
  const { $, $$, esc } = U;
  const MAKS_BERKAS = 5 * 1024 * 1024;
  const MAKS_FOTO_ASLI = 25 * 1024 * 1024; // foto kamera dikecilkan dulu sebelum diunggah
  const FOTO = ['image/jpeg', 'image/png'];
  const PESAN_GALAT = {
    PENDAFTARAN_TUTUP: 'Pendaftaran sedang ditutup.',
    PENDAFTARAN_BELUM_DIBUKA: 'Pendaftaran belum dibuka. Tunggu sampai jadwal buka ya.',
    WA_TIDAK_VALID: 'Nomor WA-nya belum benar. Contoh: 081234567890.',
    WILAYAH_TIDAK_VALID: 'Data wilayahnya bermasalah. Coba pilih ulang desamu.',
    PEMAIN_TIDAK_LENGKAP: 'Data pemainnya belum lengkap. Cek lagi nama dan berkasnya.',
    DOKUMEN_TIDAK_ADA: 'Kartu identitas ada yang gagal tersimpan. Coba unggah lagi.',
    PROFIL_ML_TIDAK_ADA: 'Screenshot profil ada yang gagal tersimpan. Coba unggah lagi.',
    IZIN_TIDAK_ADA: 'Surat izin ada yang gagal tersimpan. Coba unggah lagi.',
    FOLLOW_TIDAK_ADA: 'Bukti follow Instagram ada yang gagal tersimpan. Coba unggah lagi.',
    WA_SUDAH_ADA: 'Nomor WA ini sudah dipakai mendaftarkan tim lain.',
    CAPTCHA_GAGAL: 'Captcha-nya gagal atau kedaluwarsa. Coba sekali lagi.',
    CAPTCHA_BELUM_SIAP: 'Pendaftaran belum bisa diproses. Coba lagi nanti ya.'
  };

  const KUNCI_CAPTCHA = (window.APP_CONFIG || {}).TURNSTILE_SITE_KEY || '';
  const captchaAktif = !DB.lokal && KUNCI_CAPTCHA && !KUNCI_CAPTCHA.startsWith('GANTI');
  let captchaId = null, captchaToken = '';

  /* Skrip Turnstile dimuat async, jadi tunggu sampai tersedia saat langkah terakhir dibuka. */
  function pasangCaptcha() {
    if (!captchaAktif || captchaId !== null) return;
    if (!window.turnstile) { setTimeout(pasangCaptcha, 200); return; }
    captchaId = window.turnstile.render('#captcha', {
      sitekey: KUNCI_CAPTCHA, language: 'id', size: 'flexible',
      callback: (t) => { captchaToken = t; galat(''); },
      'expired-callback': () => { captchaToken = ''; },
      'error-callback': () => { captchaToken = ''; }
    });
  }
  function ulangCaptcha() {
    captchaToken = '';
    if (captchaId !== null) window.turnstile.reset(captchaId);
  }

  let langkah = 0, desaSemua = [], desaPilih = null, sedangKirim = false;
  // Urutan 1-5 pemain inti, urutan 6 cadangan. Berkas & path disimpan per pemain supaya
  // kembali ke langkah sebelumnya atau kirim ulang tidak mengulang unggahan.
  const pemain = Array.from({ length: 6 }, () => ({ jenis: 'KTP', dok: null, ml: null, ig1: null, ig2: null, izin: null, bawah17: false, pathDok: '', pathMl: '', pathIg1: '', pathIg2: '', pathIzin: '' }));
  const el = { prov: $('#prov'), kab: $('#kab'), cari: $('#cari-desa'), daftar: $('#desa-daftar'), salah: $('#salah') };
  const teksPilihan = (s) => s.options[s.selectedIndex].textContent;
  const waNormal = () => { const w = $('#wa').value.replace(/\D/g, ''); return w.startsWith('08') ? '62' + w.slice(1) : w; };
  const namaPemain = (i) => $(`#pemain-${i + 1}`).value.trim();
  /* Cadangan hanya ikut bila namanya diisi. */
  const pemainAktif = () => (namaPemain(5) ? [0, 1, 2, 3, 4, 5] : [0, 1, 2, 3, 4]);
  const labelPemain = (i) => `Pemain ${i + 1}${i === 0 ? ' (kapten)' : i === 5 ? ' (cadangan)' : ''}`;

  function galat(t) { el.salah.textContent = t || ''; el.salah.hidden = !t; }

  function tampilLangkah() {
    $$('[data-langkah]').forEach((s) => { s.hidden = Number(s.dataset.langkah) !== langkah; });
    $$('#langkah li').forEach((li, i) => { li.className = i <= langkah ? 'aktif' : ''; });
    $('#langkah-teks').textContent = `Langkah ${langkah + 1} dari 5`;
    $('#kembali').hidden = langkah === 0;
    $('#lanjut').textContent = langkah === 4 ? 'Kirim Pendaftaran' : 'Lanjut';
    galat('');
    if (langkah === 3) gambarBerkas();
    if (langkah === 4) { isiUlasan(); pasangCaptcha(); }
    $('#form').scrollIntoView({ block: 'start' });
  }

  function isiUlasan() {
    const baris = [
      ['Provinsi', teksPilihan(el.prov)], ['Kabupaten', teksPilihan(el.kab)],
      ['Desa', `${desaPilih[1]} (Kec. ${desaPilih[2]})`],
      ['Nama tim', $('#nama-tim').value.trim()], ['WhatsApp kapten', '+' + waNormal()],
      ...pemainAktif().map((i) => [labelPemain(i), `${namaPemain(i)} · ${pemain[i].jenis} + profil ML + 2 bukti follow IG${pemain[i].bawah17 ? ' + surat izin' : ''}`])
    ];
    $('#ulasan').innerHTML = baris.map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join('');
  }

  function periksaLangkah() {
    if (langkah === 0 && !$('#setuju-aturan').checked) return 'Centang dulu kalau sudah membaca peraturannya.';
    if (langkah === 1) {
      if (!el.prov.value) return 'Pilih provinsi.';
      if (!el.kab.value) return 'Pilih kabupaten.';
      if (!desaPilih) return 'Pilih dulu desa yang kamu wakili.';
    }
    if (langkah === 2) {
      if ($('#nama-tim').value.trim().length < 2) return 'Nama timnya belum diisi.';
      for (let i = 0; i < 5; i++) {
        if (namaPemain(i).length < 2) return `Nama ${labelPemain(i).toLowerCase()} belum diisi.`;
      }
      if (namaPemain(5) && namaPemain(5).length < 2) return 'Nama pemain cadangan terlalu pendek.';
      const nama = pemainAktif().map((i) => namaPemain(i).toLowerCase());
      if (new Set(nama).size !== nama.length) return 'Ada nama pemain yang sama. Cek lagi ya.';
      if (!/^628\d{7,12}$/.test(waNormal())) return 'Nomor WA-nya belum benar. Contoh: 081234567890.';
    }
    if (langkah === 3) {
      for (const i of pemainAktif()) {
        if (!pemain[i].dok) return `Kartu identitas ${labelPemain(i).toLowerCase()} belum diunggah.`;
        if (!pemain[i].ml) return `Screenshot profil ${labelPemain(i).toLowerCase()} belum diunggah.`;
        if (!pemain[i].ig1) return `Bukti follow @esportsdesa.official ${labelPemain(i).toLowerCase()} belum diunggah.`;
        if (!pemain[i].ig2) return `Bukti follow @ditjen_ppdt ${labelPemain(i).toLowerCase()} belum diunggah.`;
        if (pemain[i].bawah17 && !pemain[i].izin) return `Surat izin ${labelPemain(i).toLowerCase()} belum diunggah.`;
      }
    }
    if (langkah === 4 && !$('#setuju').checked) return 'Centang dulu persetujuannya.';
    if (langkah === 4 && captchaAktif && !captchaToken) return 'Selesaikan captcha-nya dulu.';
    return '';
  }

  /* ---------- Wilayah ---------- */
  async function muatProvinsi() {
    const p = await U.provinsi();
    el.prov.innerHTML = '<option value="">Pilih provinsi</option>' + p.map(([k, n]) => `<option value="${esc(k)}">${esc(n)}</option>`).join('');
  }

  function aturDesaKosong(placeholder) {
    desaSemua = []; desaPilih = null;
    el.cari.value = ''; el.cari.disabled = true; el.cari.placeholder = placeholder;
    el.daftar.hidden = true; el.daftar.innerHTML = '';
    el.cari.setAttribute('aria-expanded', 'false');
    $('#desa-terpilih').hidden = true; $('#desa-cari').hidden = false;
  }

  el.prov.onchange = async () => {
    aturDesaKosong('Pilih kabupaten dulu');
    el.kab.disabled = true;
    el.kab.innerHTML = '<option value="">' + (el.prov.value ? 'Memuat...' : 'Pilih provinsi dulu') + '</option>';
    if (!el.prov.value) return;
    const asal = el.prov.value;
    const k = await U.jsonData(`data/kab/${asal}.json`);
    if (asal !== el.prov.value) return;
    el.kab.innerHTML = '<option value="">Pilih kabupaten</option>' + k.map(([a, n]) => `<option value="${esc(a)}">${esc(n)}</option>`).join('');
    el.kab.disabled = false; el.kab.focus();
  };

  el.kab.onchange = async () => {
    aturDesaKosong(el.kab.value ? 'Memuat daftar desa...' : 'Pilih kabupaten dulu');
    if (!el.kab.value) return;
    const asal = el.kab.value;
    try {
      const d = await U.jsonData(`data/desa/${asal}.json`);
      if (asal !== el.kab.value) return;
      desaSemua = d;
      el.cari.disabled = false; el.cari.placeholder = `Ketik nama desa (ada ${U.angka(d.length)})`;
      el.cari.setAttribute('aria-expanded', 'true');
      el.daftar.hidden = false; gambarDesa(); el.cari.focus();
    } catch (e) { galat('Daftar desa gagal dimuat. Cek koneksi lalu pilih ulang kabupatennya.'); }
  };

  /* Pencarian mengabaikan huruf besar, spasi, dan tanda hubung: "awang awang" menemukan "Awang-awang". */
  const normal = (t) => t.toLowerCase().replace(/[^a-z0-9]/g, '');
  const MAKS_TAMPIL = 80;
  let opsiAktif = -1;

  function sorot(nama, q) {
    const i = q ? nama.toLowerCase().indexOf(q.toLowerCase()) : -1;
    if (i < 0) return esc(nama);
    return esc(nama.slice(0, i)) + '<mark>' + esc(nama.slice(i, i + q.length)) + '</mark>' + esc(nama.slice(i + q.length));
  }

  function gambarDesa() {
    const mentah = el.cari.value.trim(), q = normal(mentah);
    const skor = (r) => (normal(r[1]).startsWith(q) ? 0 : 1);
    const cocok = desaSemua.filter((r) => !q || normal(r[1]).includes(q) || normal(r[2]).includes(q))
      .sort((a, b) => skor(a) - skor(b) || a[1].localeCompare(b[1]));
    opsiAktif = -1;
    if (!cocok.length) {
      el.daftar.innerHTML = `<div class="desa-info">"${esc(mentah)}" tidak ketemu. Coba cari pakai nama kecamatannya.</div>`;
      return;
    }
    el.daftar.innerHTML = cocok.slice(0, MAKS_TAMPIL).map((r) => `<button type="button" class="desa-opsi" role="option" aria-selected="false" data-k="${esc(r[0])}">${sorot(r[1], mentah)}<small>Kec. ${sorot(r[2], mentah)}</small></button>`).join('') + (cocok.length > MAKS_TAMPIL ? `<div class="desa-info">Masih ada ${U.angka(cocok.length - MAKS_TAMPIL)} lagi. Ketik namanya biar lebih cepat.</div>` : '');
  }

  function pilihDesa(r) {
    desaPilih = r; galat('');
    $('#desa-nama').textContent = 'Desa ' + r[1];
    $('#desa-kec').textContent = 'Kec. ' + r[2];
    $('#desa-terpilih').hidden = false;
    $('#desa-cari').hidden = true;
    $('#lanjut').focus();
  }

  function gantiDesa() {
    desaPilih = null;
    $('#desa-terpilih').hidden = true;
    $('#desa-cari').hidden = false;
    el.cari.value = ''; gambarDesa(); el.cari.focus();
  }

  function aktifkanOpsi(arah) {
    const opsi = $$('.desa-opsi:not(:disabled)', el.daftar);
    if (!opsi.length) return;
    opsi.forEach((o) => o.classList.remove('aktif'));
    opsiAktif = (opsiAktif + arah + opsi.length) % opsi.length;
    if (opsiAktif < 0) opsiAktif = 0;
    opsi[opsiAktif].classList.add('aktif');
    opsi[opsiAktif].scrollIntoView({ block: 'nearest' });
  }

  el.cari.oninput = gambarDesa;
  el.cari.onkeydown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); aktifkanOpsi(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); aktifkanOpsi(opsiAktif < 0 ? 0 : -1); }
    else if (e.key === 'Escape') { el.cari.value = ''; gambarDesa(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const opsi = $$('.desa-opsi:not(:disabled)', el.daftar);
      const pilih = opsi[opsiAktif] || (opsi.length === 1 ? opsi[0] : null);
      if (pilih) pilih.click();
    }
  };
  el.daftar.onclick = (e) => {
    const b = e.target.closest('.desa-opsi');
    if (b && !b.disabled) pilihDesa(desaSemua.find((r) => r[0] === b.dataset.k));
  };
  $('#desa-ganti').onclick = gantiDesa;

  /* ---------- Berkas per pemain ---------- */
  /* Foto diperkecil di HP pengguna: 12 berkas per tim akan cepat menghabiskan penyimpanan dan kuota data. */
  async function kecilkan(f) {
    if (!f.type.startsWith('image/')) return f;
    try {
      const gambar = await createImageBitmap(f);
      const skala = Math.min(1, 1280 / Math.max(gambar.width, gambar.height));
      const c = document.createElement('canvas');
      c.width = Math.round(gambar.width * skala); c.height = Math.round(gambar.height * skala);
      c.getContext('2d').drawImage(gambar, 0, 0, c.width, c.height);
      gambar.close();
      const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.72));
      if (!blob || blob.size >= f.size) return f;
      return new File([blob], f.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
    } catch (e) { return f; }
  }

  const statusBerkas = (f) => (f ? `<span class="berkas-ok">${esc(f.name)}</span>` : '');

  function gambarBerkas() {
    $('#pemain-berkas').innerHTML = pemainAktif().map((i) => {
      const p = pemain[i];
      return `<fieldset class="blok-pemain" data-i="${i}">
        <legend>${esc(labelPemain(i))}: ${esc(namaPemain(i))}</legend>
        <label class="isian">Kartu identitas
          <select data-jenis>${[['KTP', 'KTP'], ['KK', 'KK'], ['Kartu Pelajar', 'Kartu Pelajar'], ['Suket RT/RW', 'Surat keterangan domisili']].map(([v, t]) => `<option value="${v}" ${p.jenis === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <div class="dua-unggah">
          <label class="jatuhan"><input type="file" data-file="dok" accept="application/pdf,image/jpeg,image/png">Unggah kartu identitas<small>Foto atau PDF</small><span data-status="dok">${statusBerkas(p.dok)}</span></label>
          <label class="jatuhan"><input type="file" data-file="ml" accept="image/jpeg,image/png">Unggah profil ML<small>Screenshot</small><span data-status="ml">${statusBerkas(p.ml)}</span></label>
          <label class="jatuhan"><input type="file" data-file="ig1" accept="image/jpeg,image/png">Bukti follow @esportsdesa.official<small>Screenshot</small><span data-status="ig1">${statusBerkas(p.ig1)}</span></label>
          <label class="jatuhan"><input type="file" data-file="ig2" accept="image/jpeg,image/png">Bukti follow @ditjen_ppdt<small>Screenshot</small><span data-status="ig2">${statusBerkas(p.ig2)}</span></label>
        </div>
        <label class="centang-kecil"><input type="checkbox" data-bawah ${p.bawah17 ? 'checked' : ''}>Pemain ini di bawah 17 tahun per 15 Januari 2027</label>
        <label class="jatuhan" data-izin ${p.bawah17 ? '' : 'hidden'}><input type="file" data-file="izin" accept="application/pdf,image/jpeg,image/png">Unggah surat izin orang tua/wali<small>Foto atau PDF</small><span data-status="izin">${statusBerkas(p.izin)}</span></label>
      </fieldset>`;
    }).join('');
  }

  $('#pemain-berkas').addEventListener('change', async (e) => {
    const blok = e.target.closest('.blok-pemain'); if (!blok) return;
    const i = Number(blok.dataset.i), p = pemain[i];
    if (e.target.matches('[data-jenis]')) { p.jenis = e.target.value; return; }
    if (e.target.matches('[data-bawah]')) { p.bawah17 = e.target.checked; $('[data-izin]', blok).hidden = !p.bawah17; return; }
    const jenis = e.target.dataset.file, f = e.target.files[0];
    if (!jenis || !f) return;
    const bolehPdf = jenis === 'dok' || jenis === 'izin';
    if (!FOTO.includes(f.type) && !(bolehPdf && f.type === 'application/pdf')) {
      galat(bolehPdf ? 'Berkas ini harus berupa foto (JPG/PNG) atau PDF.' : 'Screenshot harus JPG atau PNG.');
      return;
    }
    if (f.size > (f.type === 'application/pdf' ? MAKS_BERKAS : MAKS_FOTO_ASLI)) {
      galat(f.type === 'application/pdf' ? 'PDF-nya lebih dari 5 MB. Perkecil dulu ya.' : 'Fotonya terlalu besar. Coba foto ulang.');
      return;
    }
    galat('');
    const status = $(`[data-status="${jenis}"]`, blok);
    status.textContent = 'Menyiapkan...';
    const siap = await kecilkan(f);
    if (siap.size > MAKS_BERKAS) { status.textContent = ''; galat('Berkasnya masih lebih dari 5 MB. Coba foto ulang.'); return; }
    p[jenis] = siap; p['path' + jenis[0].toUpperCase() + jenis.slice(1)] = '';
    status.innerHTML = statusBerkas(siap);
  });

  /* ---------- Kirim ---------- */
  async function kirim() {
    if (sedangKirim) return;
    sedangKirim = true;
    const tombol = $('#lanjut'); tombol.disabled = true;
    galat('');
    try {
      const aktif = pemainAktif(), total = aktif.reduce((n, i) => n + (pemain[i].bawah17 ? 5 : 4), 0);
      let selesai = 0;
      for (const i of aktif) {
        const p = pemain[i];
        tombol.textContent = `Mengunggah ${++selesai} dari ${total}...`;
        if (!p.pathDok) p.pathDok = await DB.unggahDokumen(p.dok);
        tombol.textContent = `Mengunggah ${++selesai} dari ${total}...`;
        if (!p.pathMl) p.pathMl = await DB.unggahDokumen(p.ml);
        tombol.textContent = `Mengunggah ${++selesai} dari ${total}...`;
        if (!p.pathIg1) p.pathIg1 = await DB.unggahDokumen(p.ig1);
        tombol.textContent = `Mengunggah ${++selesai} dari ${total}...`;
        if (!p.pathIg2) p.pathIg2 = await DB.unggahDokumen(p.ig2);
        if (p.bawah17) {
          tombol.textContent = `Mengunggah ${++selesai} dari ${total}...`;
          if (!p.pathIzin) p.pathIzin = await DB.unggahDokumen(p.izin);
        }
      }
      tombol.textContent = 'Mengirim...';
      const hasil = await DB.daftar({
        nama_tim: $('#nama-tim').value.trim(), wa: waNormal(),
        prov_kode: el.prov.value, provinsi: teksPilihan(el.prov), kab_kode: el.kab.value, kabupaten: teksPilihan(el.kab),
        kecamatan: desaPilih[2], desa_kode: desaPilih[0], desa: desaPilih[1],
        pemain: aktif.map((i) => ({ nama: namaPemain(i), dokumen_jenis: pemain[i].jenis, dokumen_path: pemain[i].pathDok, profil_ml_path: pemain[i].pathMl, follow_esports_path: pemain[i].pathIg1, follow_ppdt_path: pemain[i].pathIg2, izin_path: pemain[i].bawah17 ? pemain[i].pathIzin : null })),
        captcha: captchaToken
      });
      $('#form').hidden = true; $('#sukses').hidden = false;
      $('#kode').textContent = hasil.kode;
      $('#sukses-teks').textContent = `${$('#nama-tim').value.trim()}, wakil ${desaPilih[1]}, ${teksPilihan(el.kab)}.`;
      window.scrollTo(0, 0);
    } catch (e) {
      const kunci = Object.keys(PESAN_GALAT).find((k) => String(e.message).includes(k));
      galat(kunci ? PESAN_GALAT[kunci] : 'Belum terkirim. Cek koneksi lalu coba lagi.');
      tombol.disabled = false; tombol.textContent = 'Kirim Pendaftaran';
      ulangCaptcha(); // token hanya sah sekali pakai
    } finally { sedangKirim = false; }
  }

  $('#lanjut').onclick = () => {
    const s = periksaLangkah();
    if (s) { galat(s); return; }
    if (langkah === 4) { kirim(); return; }
    langkah++; tampilLangkah();
  };
  $('#kembali').onclick = () => { langkah--; tampilLangkah(); };

  $('#peraturan-form').innerHTML = U.peraturanHtml();

  (async () => {
    const set = await DB.pengaturan().catch(() => ({ pendaftaran_buka: true }));
    if (!set.pendaftaran_buka || (!DB.lokal && !captchaAktif)) { $('#tutup').hidden = false; return; }
    const buka = set.buka_mulai ? new Date(set.buka_mulai).getTime() : 0;
    if (Date.now() < buka) { tungguBuka(buka); return; }
    $('#form').hidden = false;
    await muatProvinsi();
  })();

  /* Sebelum jadwal: tampilkan hitung mundur, lalu muat ulang halaman tepat saat dibuka. */
  function tungguBuka(buka) {
    const k = $('#belum-buka'); k.hidden = false;
    $('#bb-waktu').textContent = U.jadwalWib(buka);
    const dua = (n) => String(n).padStart(2, '0');
    const detak = () => {
      const s = Math.max(0, Math.ceil((buka - Date.now()) / 1000));
      if (!s) { location.reload(); return; }
      $('#bb-sisa').textContent = `${Math.floor(s / 86400)} hari ${dua(Math.floor((s % 86400) / 3600))}:${dua(Math.floor((s % 3600) / 60))}:${dua(s % 60)}`;
    };
    detak(); setInterval(detak, 1000);
  }
})();
