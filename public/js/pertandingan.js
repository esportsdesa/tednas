(function () {
  const { $, esc } = U;
  const PER_HAL = 100;
  let dari = 0, semua = [];

  /* Dipakai juga oleh panel admin (dengan tombol aksi tambahan). */
  window.kartuMatch = (m, aksi) => {
    const baris = (nama, desa, kab, skor, menang, kosong) => `<div class="match-tim ${menang ? 'menang' : ''}">
      <div><b>${esc(nama || kosong)}${menang ? ' ✓' : ''}</b><small>${esc([desa, kab].filter(Boolean).join(', '))}</small></div>
      <span class="skor">${skor ?? ''}</span></div>`;
    const bye = m.status === 'bye';
    const lencana = bye ? ['bye', 'Lolos tanpa lawan'] : m.status === 'selesai' ? ['selesai', 'Selesai'] : ['terjadwal', 'Terjadwal'];
    return `<article class="match">
      <div class="match-atas"><span>${esc(U.waktu(m.jadwal))} · BO${esc(m.bo)}</span><span class="lencana ${lencana[0]}">${lencana[1]}</span></div>
      ${baris(m.a_nama, m.a_desa, m.a_kab, m.skor_a, m.pemenang && m.pemenang === m.tim_a, '(tim dihapus)')}
      ${bye ? '' : baris(m.b_nama, m.b_desa, m.b_kab, m.skor_b, m.pemenang && m.pemenang === m.tim_b, '(tim dihapus)')}
      ${m.tautan_live ? `<div class="match-aksi"><a class="btn btn-garis-gelap btn-kecil" href="${esc(U.urlAman(m.tautan_live))}" target="_blank" rel="noopener">Tonton</a></div>` : ''}
      ${aksi || ''}</article>`;
  };

  window.kelompokMatch = (daftar, aksiFn) => {
    const grup = new Map();
    daftar.forEach((m) => {
      const k = `${m.fase}|${m.provinsi || ''}|${m.ronde}|${m.label}`;
      if (!grup.has(k)) grup.set(k, []);
      grup.get(k).push(m);
    });
    return [...grup.values()].map((g) => {
      const m = g[0];
      const lingkup = m.fase === 'nasional' ? 'Fase Nasional' : m.provinsi;
      return `<div class="grup-judul"><h2>${esc(lingkup)} · ${esc(m.label || 'Ronde ' + m.ronde)}</h2><span>${g.length} pertandingan</span>${aksiFn ? aksiFn.judul(m) : ''}</div>
        <div class="match-daftar">${g.map((x) => window.kartuMatch(x, aksiFn ? aksiFn.kartu(x) : '')).join('')}</div>`;
    }).join('');
  };

  /* Bagan satu provinsi atau fase nasional: kolom per ronde, ronde yang belum dibuat tampil sebagai slot kosong. */
  const LABEL_J3 = 'Perebutan Juara 3';
  const kartuBagan = (m) => {
    const baris = (nama, desa, skor, menang) => `<div class="bg-tim ${menang ? 'menang' : ''}"><span><b>${esc(nama || '(tim dihapus)')}</b><small>${esc(desa || '')}</small></span><i>${skor ?? ''}</i></div>`;
    const bye = m.status === 'bye';
    return `<div class="bg-match"><div class="bg-atas">${esc(U.waktu(m.jadwal))} · BO${esc(m.bo)}</div>
      ${baris(m.a_nama, m.a_desa, m.skor_a, m.pemenang && m.pemenang === m.tim_a)}
      ${bye ? '<div class="bg-tim bg-bye"><span>Lolos tanpa lawan</span></div>' : baris(m.b_nama, m.b_desa, m.skor_b, m.pemenang && m.pemenang === m.tim_b)}
      ${m.tautan_live ? `<a class="bg-live" href="${esc(U.urlAman(m.tautan_live))}" target="_blank" rel="noopener">Tonton ▶</a>` : ''}</div>`;
  };
  const slotKosong = '<div class="bg-match bg-kosong"><div class="bg-tim"><span>Menunggu pemenang</span></div><div class="bg-tim"><span>Menunggu pemenang</span></div></div>';

  function bagan(daftar) {
    const utama = daftar.filter((m) => m.label !== LABEL_J3), j3 = daftar.filter((m) => m.label === LABEL_J3);
    const fase = daftar[0].fase, per = new Map();
    utama.forEach((m) => { if (!per.has(m.ronde)) per.set(m.ronde, []); per.get(m.ronde).push(m); });
    const ronde = [...per.keys()].sort((a, b) => a - b);
    const awal = per.get(ronde[0]).length, total = Number.isInteger(Math.log2(awal)) ? Math.log2(awal) + 1 : ronde.length;
    const kolom = [];
    for (let r = 1; r <= Math.max(total, ronde.at(-1)); r++) {
      const ms = (per.get(r) || []).sort((a, b) => (a.urut || 0) - (b.urut || 0));
      const jml = ms.length || awal / 2 ** (r - 1);
      const judul = ms.length ? ms[0].label : U.namaBabak(fase, jml * 2, r);
      kolom.push(`<div class="bg-kolom"><h3>${esc(judul || 'Ronde ' + r)}</h3><div class="bg-isi">${ms.length ? ms.map(kartuBagan).join('') : slotKosong.repeat(jml)}</div></div>`);
    }
    const akhir = per.get(ronde.at(-1));
    const f = akhir.length === 1 && ronde.at(-1) >= total && akhir[0].pemenang ? akhir[0] : null;
    const juara = f ? (f.pemenang === f.tim_a ? [f.a_nama, f.a_desa, f.a_kab] : [f.b_nama, f.b_desa, f.b_kab]) : null;
    kolom.push(`<div class="bg-kolom bg-juara"><h3>${fase === 'nasional' ? 'Juara Nasional' : 'Juara Provinsi'}</h3><div class="bg-isi">
      <div class="bg-piala">${juara ? `<b>${esc(juara[0])}</b><small>${esc([juara[1], juara[2]].filter(Boolean).join(', '))}</small>${fase === 'provinsi' ? '<em>Lolos ke Fase Nasional</em>' : ''}` : '<span>Belum ditentukan</span>'}</div></div></div>`);
    const judul = fase === 'nasional' ? 'Fase Nasional' : daftar[0].provinsi;
    return `<div class="grup-judul"><h2>Bagan ${esc(judul)}</h2></div><div class="bg-gulir"><div class="bg-bagan">${kolom.join('')}</div></div>` +
      (j3.length ? `<div class="grup-judul"><h2>${LABEL_J3}</h2></div><div class="match-daftar">${j3.map((m) => window.kartuMatch(m)).join('')}</div>` : '');
  }

  async function muat(tambah) {
    if (!$('#daftar')) return;
    const fase = $('#f-fase').value, prov = $('#f-prov').value;
    if (fase === 'nasional' || prov) {
      $('#lagi').hidden = true; $('#petunjuk').hidden = true;
      try {
        const ms = await DB.matchSemua(fase === 'nasional' ? 'nasional' : 'provinsi', fase === 'nasional' ? '' : prov);
        $('#daftar').innerHTML = ms.length ? bagan(ms)
          : `<div class="kosong">Bagan ${fase === 'nasional' ? 'Fase Nasional' : 'provinsi ini'} belum dibuat. Jadwalnya keluar setelah verifikasi peserta selesai.</div>`;
      } catch (e) { $('#daftar').innerHTML = '<div class="kosong">Datanya gagal dimuat. Coba muat ulang halaman ini.</div>'; }
      return;
    }
    $('#petunjuk').hidden = false;
    if (!tambah) { dari = 0; semua = []; }
    try {
      const r = await DB.matchPublik({ fase: $('#f-fase').value, prov: $('#f-prov').value, dari, jumlah: PER_HAL });
      semua = semua.concat(r.baris); dari += r.baris.length;
      $('#daftar').innerHTML = semua.length ? window.kelompokMatch(semua)
        : '<div class="kosong">Belum ada pertandingan. Jadwalnya keluar setelah verifikasi peserta selesai.</div>';
      $('#lagi').hidden = dari >= r.total;
    } catch (e) { $('#daftar').innerHTML = '<div class="kosong">Datanya gagal dimuat. Coba muat ulang halaman ini.</div>'; }
  }

  if ($('#f-fase')) {
    U.provinsi().then((p) => $('#f-prov').insertAdjacentHTML('beforeend', p.map(([k, n]) => `<option value="${esc(k)}">${esc(n)}</option>`).join('')));
    $('#f-fase').onchange = () => muat();
    $('#f-prov').onchange = () => muat();
    $('#lagi').onclick = () => muat(true);
    muat();
  }
})();
