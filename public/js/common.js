/* Komponen bersama: navigasi, kaki halaman, dan pembantu kecil. */
(function () {
  const U = {};
  U.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  U.$ = (s, r) => (r || document).querySelector(s);
  U.$$ = (s, r) => [...(r || document).querySelectorAll(s)];
  U.angka = (n) => Number(n || 0).toLocaleString('id-ID');
  U.tanggal = (s) => (s ? new Date(s).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-');
  U.waktu = (s) => (s ? new Date(s).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' WIB' : 'Jadwal menyusul');
  U.jadwalWib = (s) => {
    const z = { timeZone: 'Asia/Jakarta' }, d = new Date(s);
    return d.toLocaleDateString('id-ID', { ...z, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) +
      ' pukul ' + d.toLocaleTimeString('id-ID', { ...z, hour: '2-digit', minute: '2-digit' }).replace(':', '.') + ' WIB';
  };
  // Naikkan DATA_VERSI tiap public/data berubah, supaya browser tidak memakai salinan lama.
  const DATA_VERSI = '2';
  U.jsonData = async (p) => { const r = await fetch(`${p}?v=${DATA_VERSI}`); if (!r.ok) throw new Error('Gagal memuat ' + p); return r.json(); };
  U.provinsi = () => U.jsonData('data/provinsi.json');

  /* Nama babak mengikuti jumlah tim tersisa pada ronde tersebut. */
  U.namaBabak = (fase, jumlahTim, ronde) => {
    if (jumlahTim === 1) return 'Lolos Tanpa Lawan';
    if (jumlahTim === 2) return fase === 'nasional' ? 'Final' : 'Final Provinsi';
    if (jumlahTim <= 4) return 'Semifinal';
    if (jumlahTim <= 8) return 'Perempat Final';
    return 'Ronde ' + ronde;
  };

  /* Tautan galeri ditampilkan hanya bila memakai http(s), supaya admin tak bisa keliru menyimpan skema lain. */
  U.urlAman = (u) => (/^https?:\/\//i.test(u) || /^data:(image|video)\//i.test(u) ? u : '#');
  U.kartuGaleri = (g) => {
    const judul = U.esc(g.judul), url = U.esc(U.urlAman(g.url));
    const isi = g.jenis === 'foto' ? `<img src="${url}" alt="${judul}" loading="lazy">`
      : g.jenis === 'video' ? `<video src="${url}" controls preload="metadata"></video>`
      : `<a class="kartu-tautan" href="${url}" target="_blank" rel="noopener">▶ Tonton video</a>`;
    return `<figure>${isi}${judul ? `<figcaption>${judul}</figcaption>` : ''}</figure>`;
  };

  /* Peraturan resmi dari panitia. Dipakai di halaman Peraturan dan langkah pertama formulir. */
  U.PERATURAN = [
    ['A. Kriteria Umum', [
      'WNI dan berdomisili di desa yang diwakili, dibuktikan dengan KTP/KK atau surat keterangan domisili.',
      'Berusia 15–30 tahun per 15 Januari 2027. Peserta di bawah 17 tahun wajib mendapat izin orang tua/wali.',
      'Bersedia mematuhi seluruh peraturan turnamen.',
      'Setiap pemain wajib mengikuti (follow) akun Instagram @esportsdesa.official dan @ditjen_ppdt.']],
    ['B. Kriteria Tim', [
      'Terdiri atas 5 pemain inti dan maksimal 1 pemain cadangan.',
      'Seluruh anggota tim berdomisili di desa, setiap desa boleh mengirimkan lebih dari satu tim.',
      'Pemain dalam satu tim diperbolehkan berasal dari gabungan beberapa desa.',
      'Setiap pemain hanya boleh terdaftar pada 1 tim.',
      'Nama tim mencantumkan nama desa dan bebas dari unsur SARA, pornografi, serta politik praktis. (Contoh: Mangliawan Esports).',
      'Satu tim menunjuk 1 orang kapten sebagai narahubung.']],
    ['C. Akun dan Perangkat', [
      'Menggunakan akun gim pribadi.',
      'Dilarang menggunakan akun pinjaman, joki, atau cheat.',
      'Menyiapkan perangkat dan koneksi internet secara mandiri untuk babak daring.']],
    ['D. Dokumen Pendaftaran', [
      'KTP/KK atau kartu pelajar setiap pemain.',
      'Surat izin orang tua/wali bagi peserta di bawah 17 tahun.',
      'Tangkapan layar profil akun gim.',
      'Tangkapan layar bukti follow Instagram @esportsdesa.official dan @ditjen_ppdt setiap pemain.',
      'Identitas dan nomor WhatsApp kapten tim.']],
    ['E. Larangan dan Sanksi', [
      'Pemain profesional yang masih terikat kontrak atau mantan pemain profesional (MPL, MDL, dan Liga Esports Nasional) tidak diperkenankan mengikuti turnamen.',
      'Pelanggaran berupa pemalsuan data, ketidaksesuaian domisili, joki, cheat, dan pengaturan skor dapat dikenai diskualifikasi.',
      'Panitia berhak melakukan verifikasi dan membatalkan kepesertaan apabila ditemukan pelanggaran.']]
  ];
  U.peraturanHtml = () => U.PERATURAN.map(([j, isi]) => `<h3>${U.esc(j)}</h3><ul>${isi.map((x) => `<li>${U.esc(x)}</li>`).join('')}</ul>`).join('');

  U.pesan = (t, jenis) => {
    let w = U.$('#toasts');
    if (!w) { w = document.createElement('div'); w.id = 'toasts'; w.setAttribute('aria-live', 'polite'); document.body.append(w); }
    const d = document.createElement('div');
    d.className = 'toast ' + (jenis || ''); d.textContent = t; w.append(d);
    setTimeout(() => d.remove(), 5000);
  };

  const MENU = [['index.html', 'Beranda'], ['peraturan.html', 'Peraturan'], ['rekap.html', 'Rekap Tim'], ['pertandingan.html', 'Pertandingan'], ['index.html#galeri', 'Galeri']];

  function pasangKerangka() {
    const kini = location.pathname.split('/').pop().replace('.html', '') || 'index';
    const head = document.createElement('header');
    head.className = 'nav';
    head.innerHTML = `<div class="nav-isi">
      <a class="merek" href="index.html"><img src="img/logo-esports.png" alt="" width="42" height="42"><span>TEDNas<b>2027</b></span></a>
      <button class="nav-tombol" aria-label="Buka menu" aria-expanded="false"><span></span><span></span><span></span></button>
      <nav>${MENU.map(([h, n]) => `<a href="${h}" ${h.replace('.html', '') === kini ? 'aria-current="page"' : ''}>${n}</a>`).join('')}
      <a class="btn btn-emas btn-kecil" href="daftar.html">Daftar Tim</a></nav></div>`;
    document.body.prepend(head);
    const t = U.$('.nav-tombol', head);
    t.onclick = () => { const b = head.classList.toggle('buka'); t.setAttribute('aria-expanded', b); };

    if (window.DB && DB.lokal) {
      const p = document.createElement('div');
      p.className = 'pita-lokal';
      p.textContent = 'MODE LOKAL: data hanya tersimpan di browser ini. Database online belum tersambung.';
      head.after(p);
    }

    const f = document.createElement('footer');
    f.className = 'kaki';
    f.innerHTML = `<div class="kaki-isi">
      <div class="kaki-merek"><span class="kaki-logo"><img src="img/logo-kemendes.png" alt="Logo Kementerian Desa dan PDT" width="64" height="64"><img src="img/logo-ppdt.png" alt="Logo Ditjen PPDT" width="64" height="64"></span>
        <p><b>Direktorat Jenderal Percepatan Pembangunan Daerah Tertinggal</b><br>Kementerian Desa dan Pembangunan Daerah Tertinggal</p></div>
      <div class="kaki-kanan"><p>Turnamen Esports Desa Nasional 2027<br>Rangkaian Peringatan Hari Desa Nasional 2027</p>
        <p class="sosmed">Instagram: <a href="https://www.instagram.com/esportsdesa.official/" rel="noopener" target="_blank">@esportsdesa.official</a> · <a href="https://www.instagram.com/ditjen_ppdt/" rel="noopener" target="_blank">@ditjen_ppdt</a> · <a href="https://www.instagram.com/kemendespdt/" rel="noopener" target="_blank">@kemendespdt</a></p>
        <p><a class="tautan-admin" href="admin.html">Masuk Admin</a></p></div></div>`;
    document.body.append(f);
  }

  document.addEventListener('DOMContentLoaded', pasangKerangka);
  window.U = U;
})();
