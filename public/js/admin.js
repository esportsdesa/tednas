(function () {
  const { $, $$, esc, angka } = U;
  const PER_HAL = 25;
  const LABEL_J3 = 'Perebutan Juara 3';
  let dari = 0, tundaCari, timHal = [], matchHal = [], galeriHal = [], matchEdit = null, timHapus = null, timDialog = null;

  /* ---------- Masuk ---------- */
  async function mulai() {
    const admin = await DB.sesiAdmin().catch(() => false);
    $('#masuk').hidden = admin;
    $('#panel').hidden = !admin;
    if (admin) { isiProvinsi(); muatTim(); muatRingkas(); }
  }
  $('#masuk').onsubmit = async (e) => {
    e.preventDefault();
    const s = $('#masuk-salah'); s.hidden = true;
    try {
      await DB.masuk($('#u').value, $('#p').value);
      $('#p').value = '';
      if (!(await DB.sesiAdmin())) { await DB.keluar(); throw new Error('bukan admin'); }
      mulai();
    } catch (err) { s.textContent = 'Nama pengguna atau kata sandi salah, atau akun ini bukan admin.'; s.hidden = false; }
  };
  $('#keluar').onclick = async () => { await DB.keluar(); location.reload(); };

  async function isiProvinsi() {
    const p = await U.provinsi();
    const op = p.map(([k, n]) => `<option value="${esc(k)}">${esc(n)}</option>`).join('');
    $('#t-prov').insertAdjacentHTML('beforeend', op);
    $('#m-prov').insertAdjacentHTML('beforeend', op);
  }

  /* ---------- Tab ---------- */
  $$('[data-tab]').forEach((b) => {
    b.onclick = () => {
      $$('[data-tab]').forEach((x) => x.setAttribute('aria-selected', x === b));
      $$('[data-isi]').forEach((s) => { s.hidden = s.dataset.isi !== b.dataset.tab; });
      if (b.dataset.tab === 'match') muatMatch();
      if (b.dataset.tab === 'galeri') muatGaleri();
      if (b.dataset.tab === 'atur') muatAtur();
    };
  });
  $$('dialog [data-batal]').forEach((b) => { b.onclick = () => b.closest('dialog').close(); });

  /* ---------- Tim ---------- */
  async function muatRingkas() {
    const s = await DB.statistik();
    $('#adm-ringkas').innerHTML = [[s.total, 'Tim terdaftar'], [s.terverifikasi, 'Terverifikasi'], [s.total - s.terverifikasi, 'Menunggu verifikasi'], [s.provinsi, 'Provinsi']]
      .map(([a, b]) => `<div><b>${angka(a)}</b><span>${b}</span></div>`).join('');
  }
  const saringTim = () => ({ cari: $('#t-cari').value, prov: $('#t-prov').value, status: $('#t-status').value });

  async function muatTim() {
    try {
      const { baris, total } = await DB.timAdmin({ ...saringTim(), dari, jumlah: PER_HAL });
      timHal = baris;
      $('#t-baris').innerHTML = baris.length ? baris.map((t) => `<tr>
        <td>${esc(t.kode)}<small>${esc(U.tanggal(t.created_at))}</small></td>
        <td><b>${esc(t.nama_tim)}</b><small>${esc(t.nama_kapten)}</small></td>
        <td><a href="https://wa.me/${esc(t.wa_kapten)}" target="_blank" rel="noopener">+${esc(t.wa_kapten)}</a></td>
        <td>${esc(t.desa)}<small>Kec. ${esc(t.kecamatan)}, ${esc(t.kabupaten)}<br>${esc(t.provinsi)}</small></td>
        <td><button class="btn btn-garis-gelap btn-kecil" data-pemain="${esc(t.id)}">Lihat ${t.pemain.length} pemain</button></td>
        <td><span class="lencana ${esc(t.status)}">${t.status === 'terverifikasi' ? 'Terverifikasi' : 'Menunggu'}</span></td>
        <td><div class="aksi-sel">
          <button class="btn btn-kecil ${t.status === 'terverifikasi' ? 'btn-garis-gelap' : ''}" data-ver="${esc(t.id)}">${t.status === 'terverifikasi' ? 'Batalkan' : 'Verifikasi'}</button>
          <button class="btn btn-bahaya btn-kecil" data-hapus="${esc(t.id)}">Hapus</button></div></td></tr>`).join('')
        : '<tr><td colspan="7">Tidak ada tim.</td></tr>';
      const akhir = Math.min(dari + PER_HAL, total);
      $('#t-info').textContent = total ? `Menampilkan ${angka(dari + 1)}-${angka(akhir)} dari ${angka(total)} tim` : '';
      $('#t-prev').disabled = dari === 0;
      $('#t-next').disabled = akhir >= total;
    } catch (e) { U.pesan('Gagal memuat tim: ' + e.message, 'gagal'); }
  }

  $('#t-baris').onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const cari = (id) => timHal.find((t) => t.id === id);
    if (b.dataset.pemain) {
      const t = timDialog = cari(b.dataset.pemain);
      $('#d-pemain-judul').textContent = `${t.nama_tim} · ${t.desa}`;
      $('#d-pemain-isi').innerHTML = t.pemain.map((p) => `<div class="baris-pemain">
        <div><b>${esc(p.nama)}</b><small>Pemain ${p.urutan}${p.urutan === 1 ? ' (kapten)' : p.urutan === 6 ? ' (cadangan)' : ''}</small></div>
        <div class="aksi-sel"><button class="btn btn-garis-gelap btn-kecil" data-buka="${esc(p.dokumen_path)}">${esc(p.dokumen_jenis)}</button>
          <button class="btn btn-garis-gelap btn-kecil" data-buka="${esc(p.profil_ml_path)}">Profil ML</button>
          ${p.follow_esports_path ? `<button class="btn btn-garis-gelap btn-kecil" data-buka="${esc(p.follow_esports_path)}">Follow esportsdesa</button>` : ''}
          ${p.follow_ppdt_path ? `<button class="btn btn-garis-gelap btn-kecil" data-buka="${esc(p.follow_ppdt_path)}">Follow ditjen_ppdt</button>` : ''}
          ${p.izin_path ? `<button class="btn btn-garis-gelap btn-kecil" data-buka="${esc(p.izin_path)}">Surat Izin</button>` : ''}</div></div>`).join('')
        || '<p>Data pemain tidak ada.</p>';
      $('#d-pemain').showModal();
    } else if (b.dataset.ver) {
      const t = cari(b.dataset.ver);
      try { await DB.setStatusTim(t.id, t.status === 'terverifikasi' ? 'menunggu' : 'terverifikasi'); muatTim(); muatRingkas(); }
      catch (err) { U.pesan('Gagal mengubah status: ' + err.message, 'gagal'); }
    } else if (b.dataset.hapus) {
      timHapus = cari(b.dataset.hapus);
      $('#d-hapus-teks').textContent = `Tim "${timHapus.nama_tim}" (${timHapus.desa}, ${timHapus.kabupaten}) beserta data pemain dan semua berkasnya akan dihapus permanen, dan desa ini bisa didaftarkan lagi. Di pertandingan yang sudah dibuat, tim ini akan tertulis "(tim dihapus)".`;
      $('#d-hapus').showModal();
    }
  };
  $('#d-pemain-isi').onclick = async (e) => {
    const b = e.target.closest('[data-buka]'); if (!b) return;
    // Tab dibuka lebih dulu: browser memblokir window.open setelah await.
    const w = window.open('', '_blank');
    try { const url = await DB.urlDokumen(b.dataset.buka); w.opener = null; w.location = url; }
    catch (err) { w.close(); U.pesan('Berkas gagal dibuka: ' + err.message, 'gagal'); }
  };
  $('#d-hapus-ya').onclick = async () => {
    const t = timHapus; $('#d-hapus').close();
    try {
      await DB.hapusTim(t);
      U.pesan(`Tim ${t.nama_tim} dihapus.`, 'ok');
      if (timHal.length === 1 && dari > 0) dari = Math.max(0, dari - PER_HAL);
      muatTim(); muatRingkas();
    } catch (e) { U.pesan('Gagal menghapus: ' + e.message, 'gagal'); }
  };

  $('#t-cari').oninput = () => { clearTimeout(tundaCari); tundaCari = setTimeout(() => { dari = 0; muatTim(); }, 300); };
  $('#t-prov').onchange = $('#t-status').onchange = () => { dari = 0; muatTim(); };
  $('#t-prev').onclick = () => { dari = Math.max(0, dari - PER_HAL); muatTim(); };
  $('#t-next').onclick = () => { dari += PER_HAL; muatTim(); };

  $('#t-ekspor').onclick = async () => {
    try {
      const semua = [];
      for (let d = 0; ; d += 1000) {
        const { baris } = await DB.timAdmin({ ...saringTim(), dari: d, jumlah: 1000 });
        semua.push(...baris); if (baris.length < 1000) break;
      }
      // Awalan ' mencegah isian pendaftar terbaca sebagai rumus saat dibuka di Excel.
      const sel = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
      const kolom = ['kode', 'nama_tim', 'wa_kapten', 'desa', 'kecamatan', 'kabupaten', 'provinsi', 'desa_kode', 'status', 'created_at'];
      const judulPemain = [1, 2, 3, 4, 5, 6].flatMap((i) => [`pemain_${i}`, `identitas_${i}`, `surat_izin_${i}`]);
      const isiPemain = (t) => [0, 1, 2, 3, 4, 5].flatMap((i) => [t.pemain[i] ? t.pemain[i].nama : '', t.pemain[i] ? t.pemain[i].dokumen_jenis : '', t.pemain[i] && t.pemain[i].izin_path ? 'ada' : '']);
      const csv = '﻿' + [[...kolom, ...judulPemain].join(';'), ...semua.map((t) => [...kolom.map((k) => t[k]), ...isiPemain(t)].map(sel).join(';'))].join('\r\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      a.download = `tim-tednas-2027-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) { U.pesan('Gagal mengunduh: ' + e.message, 'gagal'); }
  };

  /* ---------- Unduh berkas (ZIP) untuk backup ke Google Drive ---------- */
  const TIM_PER_ZIP = 40;
  const amanNama = (t) => String(t || '').replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  const ekstensi = (path) => (String(path).match(/\.(\w+)$/) || [, 'bin'])[1];

  function daftarBerkas(t) {
    return t.pemain.flatMap((p) => {
      const awal = `Pemain ${p.urutan} - ${amanNama(p.nama)}`;
      return [[p.dokumen_path, p.dokumen_jenis], [p.profil_ml_path, 'Profil ML'], [p.follow_esports_path, 'Follow esportsdesa'],
        [p.follow_ppdt_path, 'Follow ditjen_ppdt'], [p.izin_path, 'Surat izin']]
        .filter(([path]) => path).map(([path, jenis]) => [path, `${awal} - ${amanNama(jenis)}.${ekstensi(path)}`]);
    });
  }

  function infoTim(t) {
    return [`Kode: ${t.kode}`, `Nama tim: ${t.nama_tim}`, `Desa: ${t.desa}, Kec. ${t.kecamatan}`, `Kabupaten: ${t.kabupaten}`, `Provinsi: ${t.provinsi}`,
      `WhatsApp kapten: +${t.wa_kapten}`, `Status: ${t.status}`, `Mendaftar: ${U.tanggal(t.created_at)}`, '', 'Pemain:',
      ...t.pemain.map((p) => `${p.urutan}. ${p.nama}${p.urutan === 1 ? ' (kapten)' : p.urutan === 6 ? ' (cadangan)' : ''}, identitas ${p.dokumen_jenis}`)].join('\r\n');
  }

  /* Berkas diambil 4 sekaligus; yang gagal dicatat di GAGAL.txt supaya bisa diunduh ulang. */
  async function buatZip(daftarTim, kabar) {
    const zip = new JSZip(), gagal = [], tugas = [];
    for (const t of daftarTim) {
      const folder = zip.folder(amanNama(`${t.kode} ${t.nama_tim} - ${t.desa}`));
      folder.file('info.txt', infoTim(t));
      daftarBerkas(t).forEach(([path, nama]) => tugas.push({ folder, path, nama, tim: t.kode }));
    }
    let selesai = 0;
    const kerja = async () => {
      while (tugas.length) {
        const x = tugas.shift();
        try {
          const r = await fetch(await DB.urlDokumen(x.path));
          if (!r.ok) throw new Error('HTTP ' + r.status);
          x.folder.file(x.nama, await r.blob());
        } catch (e) { gagal.push(`${x.tim} / ${x.nama}: ${e.message}`); }
        kabar(++selesai);
      }
    };
    const total = tugas.length;
    await Promise.all(Array.from({ length: 4 }, kerja));
    if (gagal.length) zip.file('GAGAL.txt', gagal.join('\r\n'));
    return { blob: await zip.generateAsync({ type: 'blob' }), total, gagal: gagal.length };
  }

  function simpanBerkas(blob, nama) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = nama; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }

  $('#t-zip').onclick = async () => {
    const tombol = $('#t-zip'), teks = tombol.textContent;
    if (!window.JSZip) { U.pesan('Pustaka ZIP belum termuat. Muat ulang halaman.', 'gagal'); return; }
    tombol.disabled = true;
    try {
      const semua = [];
      for (let d = 0; ; d += 1000) {
        const { baris } = await DB.timAdmin({ prov: $('#t-prov').value, status: 'terverifikasi', dari: d, jumlah: 1000 });
        semua.push(...baris); if (baris.length < 1000) break;
      }
      if (!semua.length) { U.pesan('Belum ada tim terverifikasi untuk diunduh.', 'gagal'); return; }
      semua.reverse(); // urut dari yang paling awal mendaftar
      const bagian = Math.ceil(semua.length / TIM_PER_ZIP), tgl = new Date().toISOString().slice(0, 10);
      const wilayah = $('#t-prov').value ? amanNama($('#t-prov').selectedOptions[0].textContent).replace(/ /g, '-') : 'semua-provinsi';
      let gagal = 0;
      for (let b = 0; b < bagian; b++) {
        const tim = semua.slice(b * TIM_PER_ZIP, (b + 1) * TIM_PER_ZIP);
        const label = bagian > 1 ? `Bagian ${b + 1}/${bagian}: ` : '';
        const hasil = await buatZip(tim, (n) => { tombol.textContent = `${label}${n} berkas...`; });
        gagal += hasil.gagal;
        simpanBerkas(hasil.blob, `berkas-tednas-${wilayah}-${tgl}${bagian > 1 ? `-bagian-${b + 1}` : ''}.zip`);
      }
      U.pesan(gagal ? `Selesai, tapi ${gagal} berkas gagal diambil. Daftarnya ada di GAGAL.txt dalam ZIP.` : `Berkas ${semua.length} tim terverifikasi selesai diunduh.`, gagal ? 'gagal' : 'ok');
    } catch (e) { U.pesan('Gagal membuat ZIP: ' + e.message, 'gagal'); }
    finally { tombol.disabled = false; tombol.textContent = teks; }
  };

  $('#d-pemain-zip').onclick = async () => {
    const t = timDialog, tombol = $('#d-pemain-zip'), teks = tombol.textContent;
    if (!t || !window.JSZip) return;
    tombol.disabled = true;
    try {
      const hasil = await buatZip([t], (n) => { tombol.textContent = `${n} berkas...`; });
      simpanBerkas(hasil.blob, `${amanNama(`${t.kode} ${t.nama_tim}`).replace(/ /g, '-')}.zip`);
      if (hasil.gagal) U.pesan(`${hasil.gagal} berkas gagal diambil. Daftarnya ada di GAGAL.txt dalam ZIP.`, 'gagal');
    } catch (e) { U.pesan('Gagal membuat ZIP: ' + e.message, 'gagal'); }
    finally { tombol.disabled = false; tombol.textContent = teks; }
  };

  /* ---------- Pertandingan ---------- */
  const lingkup = () => ({ fase: $('#m-fase').value, prov: $('#m-fase').value === 'provinsi' ? $('#m-prov').value : '' });
  $('#m-fase').onchange = () => { $('#m-prov').hidden = $('#m-fase').value !== 'provinsi'; muatMatch(); };
  $('#m-prov').onchange = muatMatch;

  async function muatMatch() {
    const { fase, prov } = lingkup();
    if (fase === 'provinsi' && !prov) { $('#m-daftar').innerHTML = '<div class="kosong">Pilih provinsi untuk melihat atau membuat pertandingan.</div>'; return; }
    try {
      matchHal = await DB.matchSemua(fase, prov);
      const maksRonde = Math.max(0, ...matchHal.map((m) => m.ronde));
      $('#m-daftar').innerHTML = matchHal.length ? window.kelompokMatch(matchHal, {
        judul: (m) => (m.ronde === maksRonde && m.label !== LABEL_J3 ? `<button class="btn btn-bahaya btn-kecil" data-hapus-ronde="${m.ronde}">Hapus ronde ini</button>` : ''),
        kartu: (m) => (m.status === 'bye' ? '' : `<div class="match-aksi"><button class="btn btn-garis-gelap btn-kecil" data-ubah="${esc(m.id)}">Jadwal & Skor</button></div>`)
      }) : '<div class="kosong">Belum ada pertandingan di sini.</div>';
    } catch (e) { U.pesan('Gagal memuat pertandingan: ' + e.message, 'gagal'); }
  }

  const acak = (a) => { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };

  /* Isi slot bagan ronde 1 (ukuran pangkat dua). Pertandingan "lolos tanpa lawan" disebar merata,
     jadi tidak menumpuk di satu sisi bagan. */
  function acakBagan(ids) {
    const n = ids.length;
    if (n === 1) return [ids[0], null];
    let ukuran = 2; while (ukuran < n) ukuran *= 2;
    const jmlMatch = ukuran / 2, bye = ukuran - n;
    const posBye = new Set(Array.from({ length: bye }, (_, k) => Math.floor((k * jmlMatch) / bye)));
    const slot = []; let j = 0;
    for (let i = 0; i < jmlMatch; i++) {
      slot.push(ids[j++]);
      slot.push(posBye.has(i) ? null : ids[j++]);
    }
    return slot;
  }

  /* Juara provinsi = pemenang ronde terakhir yang hanya berisi satu pertandingan. */
  function juaraProvinsi(semua) {
    const per = new Map();
    semua.forEach((m) => { if (!per.has(m.prov_kode)) per.set(m.prov_kode, []); per.get(m.prov_kode).push(m); });
    const juara = [], belum = [];
    per.forEach((ms) => {
      const r = Math.max(...ms.map((m) => m.ronde));
      const akhir = ms.filter((m) => m.ronde === r);
      if (akhir.length === 1 && akhir[0].pemenang) juara.push({ id: akhir[0].pemenang });
      else belum.push(ms[0].provinsi);
    });
    return { juara, belum };
  }

  async function buatRonde() {
    const { fase, prov } = lingkup();
    if (fase === 'provinsi' && !prov) { U.pesan('Pilih provinsi dulu.', 'gagal'); return; }
    const provNama = fase === 'provinsi' ? $('#m-prov').selectedOptions[0].textContent : null;
    const ada = (await DB.matchSemua(fase, prov)).filter((m) => m.label !== LABEL_J3);
    const ronde = Math.max(0, ...ada.map((m) => m.ronde));
    const terakhir = ada.filter((m) => m.ronde === ronde).sort((a, b) => (a.urut || 0) - (b.urut || 0));

    if (terakhir.some((m) => m.status === 'terjadwal')) { U.pesan('Masih ada pertandingan yang belum selesai di ronde terakhir.', 'gagal'); return; }
    if (ronde && terakhir.length === 1) { U.pesan('Ronde final sudah dibuat, juara sudah ditentukan dari sana.', 'gagal'); return; }

    /* Bagan tetap: ronde 1 diacak dan dilengkapi "lolos tanpa lawan" sampai jumlah slot 2, 4, 8, 16, ...;
       ronde berikutnya mempertemukan pemenang pertandingan urut 0 & 1, 2 & 3, dan seterusnya. */
    let slot;
    if (ronde) {
      slot = terakhir.map((m) => m.pemenang || null);
    } else {
      let peserta;
      if (fase === 'provinsi') {
        peserta = await DB.timTerverifikasiProv(prov);
      } else {
        const { juara, belum } = juaraProvinsi(await DB.matchSemua('provinsi', ''));
        if (belum.length && !confirm(`${belum.length} provinsi belum punya juara (${belum.slice(0, 5).join(', ')}${belum.length > 5 ? ', dst.' : ''}). Tetap buat fase nasional tanpa provinsi tersebut?`)) return;
        peserta = juara;
      }
      if (!peserta.length) { U.pesan(fase === 'provinsi' ? 'Belum ada tim terverifikasi di provinsi ini.' : 'Belum ada juara provinsi.', 'gagal'); return; }
      if (fase === 'nasional' && peserta.length < 2) { U.pesan('Fase nasional butuh minimal dua juara provinsi.', 'gagal'); return; }
      slot = acakBagan(acak(peserta).map((t) => t.id));
    }

    const n = slot.length;
    const label = U.namaBabak(fase, slot.filter(Boolean).length === 1 ? 1 : n, ronde + 1);
    const bo = fase === 'provinsi' ? 1 : n === 2 ? 5 : 3;
    const dasar = { fase, prov_kode: prov || null, provinsi: provNama, ronde: ronde + 1, label, bo };
    const baru = [];
    for (let i = 0; i < n; i += 2) {
      const a = slot[i], b = i + 1 < n ? slot[i + 1] : null, urut = i / 2;
      if (a && b) baru.push({ ...dasar, urut, tim_a: a, tim_b: b, status: 'terjadwal' });
      else if (a || b) baru.push({ ...dasar, urut, tim_a: a || b, tim_b: null, pemenang: a || b, status: 'bye' });
    }

    // Dua semifinalis yang kalah merebut juara 3, karena proposal menetapkan tiga tim terbaik.
    if (fase === 'nasional' && n === 2 && terakhir.filter((m) => m.status === 'selesai').length === 2) {
      const kalah = terakhir.map((m) => (m.pemenang === m.tim_a ? m.tim_b : m.tim_a)).filter(Boolean);
      if (kalah.length === 2) baru.push({ ...dasar, urut: 1, label: LABEL_J3, bo: 3, tim_a: kalah[0], tim_b: kalah[1], status: 'terjadwal' });
    }

    try {
      await DB.tambahMatch(baru);
      U.pesan(`${label}: ${baru.length} pertandingan dibuat.`, 'ok');
      muatMatch();
    } catch (e) { U.pesan('Gagal membuat ronde: ' + e.message, 'gagal'); }
  }
  $('#m-buat').onclick = async () => { const b = $('#m-buat'); b.disabled = true; try { await buatRonde(); } finally { b.disabled = false; } };

  $('#m-daftar').onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.hapusRonde) {
      if (!confirm('Hapus seluruh pertandingan pada ronde ini?')) return;
      const { fase, prov } = lingkup();
      try { await DB.hapusRonde(fase, prov, Number(b.dataset.hapusRonde)); muatMatch(); }
      catch (err) { U.pesan('Gagal menghapus ronde: ' + err.message, 'gagal'); }
    } else if (b.dataset.ubah) bukaMatch(matchHal.find((m) => m.id === b.dataset.ubah));
  };

  /* Nilai datetime-local dibaca sebagai WIB, apa pun zona waktu komputer admin. */
  const keLokalWIB = (iso) => (iso ? new Date(new Date(iso).getTime() + 7 * 3600000).toISOString().slice(0, 16) : '');
  const dariLokalWIB = (s) => (s ? new Date(s + ':00+07:00').toISOString() : null);

  function bukaMatch(m) {
    matchEdit = m;
    const maksRonde = Math.max(...matchHal.map((x) => x.ronde));
    const terkunci = m.ronde < maksRonde;
    $('#dm-peringatan').hidden = !terkunci;
    ['#dm-sa', '#dm-sb', '#dm-menang'].forEach((s) => { $(s).disabled = terkunci; });
    $('#dm-jadwal').value = keLokalWIB(m.jadwal);
    $('#dm-a').textContent = 'Skor ' + (m.a_nama || '(tim dihapus)');
    $('#dm-b').textContent = 'Skor ' + (m.b_nama || '(tim dihapus)');
    $('#dm-sa').value = m.skor_a ?? ''; $('#dm-sb').value = m.skor_b ?? '';
    const opsi = [['', 'Ikuti skor']];
    if (m.tim_a) opsi.push([m.tim_a, m.a_nama]);
    if (m.tim_b) opsi.push([m.tim_b, m.b_nama]);
    $('#dm-menang').innerHTML = opsi.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
    const tanpaSkor = m.pemenang && m.skor_a === null && m.skor_b === null;
    $('#dm-menang').value = tanpaSkor ? m.pemenang : '';
    $('#dm-live').value = m.tautan_live || '';
    $('#dm-salah').hidden = true;
    $('#d-match').showModal();
  }

  $('#dm-simpan').onclick = async () => {
    const m = matchEdit, salah = (t) => { $('#dm-salah').textContent = t; $('#dm-salah').hidden = false; };
    const sa = $('#dm-sa').value, sb = $('#dm-sb').value, manual = $('#dm-menang').value;
    const live = $('#dm-live').value.trim();
    if (live && !/^https?:\/\//i.test(live)) { salah('Tautan siaran harus diawali https://'); return; }
    const d = { jadwal: dariLokalWIB($('#dm-jadwal').value), tautan_live: live || null };

    if (!$('#dm-sa').disabled) {
      if ((sa === '') !== (sb === '')) { salah('Isi kedua skor, atau kosongkan keduanya.'); return; }
      let pemenang = manual || null;
      if (sa !== '') {
        const a = Number(sa), b = Number(sb), syarat = (m.bo + 1) / 2;
        if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) { salah('Skor harus bilangan bulat.'); return; }
        if (a === b) { salah('Skor seri tidak bisa menentukan pemenang.'); return; }
        if (Math.max(a, b) !== syarat || a + b > m.bo) { salah(`Format BO${m.bo}: pemenang harus tepat ${syarat} kemenangan.`); return; }
        const dariSkor = a > b ? m.tim_a : m.tim_b;
        if (!dariSkor) { salah('Tim pemenang menurut skor sudah dihapus. Kosongkan skor, lalu pilih pemenang.'); return; }
        if (manual && manual !== dariSkor) { salah('Pilihan pemenang tidak sesuai dengan skor.'); return; }
        pemenang = dariSkor;
        d.skor_a = a; d.skor_b = b;
      } else { d.skor_a = null; d.skor_b = null; }
      d.pemenang = pemenang;
      d.status = pemenang ? 'selesai' : 'terjadwal';
    }
    try { await DB.ubahMatch(m.id, d); $('#d-match').close(); U.pesan('Tersimpan.', 'ok'); muatMatch(); }
    catch (e) { salah('Gagal menyimpan: ' + e.message); }
  };

  /* ---------- Galeri ---------- */
  async function muatGaleri() {
    try {
      galeriHal = await DB.galeri();
      $('#g-daftar').innerHTML = galeriHal.length ? galeriHal.map((g) => {
        const k = U.kartuGaleri(g);
        return k.replace('</figure>', `<div style="padding:0 12px 12px"><button class="btn btn-bahaya btn-kecil" data-g="${esc(g.id)}">Hapus</button></div></figure>`);
      }).join('') : '<div class="kosong" style="grid-column:1/-1">Galeri masih kosong.</div>';
    } catch (e) { U.pesan('Gagal memuat galeri: ' + e.message, 'gagal'); }
  }
  $('#g-berkas').onchange = async (e) => {
    const files = [...e.target.files], st = $('#g-status'); let ok = 0;
    for (const [i, f] of files.entries()) {
      if (f.size > 50 * 1024 * 1024) { U.pesan(`${f.name} melebihi 50 MB, dilewati.`, 'gagal'); continue; }
      st.textContent = `Mengunggah ${i + 1} dari ${files.length}: ${f.name}`;
      try { await DB.unggahGaleri(f, $('#g-judul').value.trim()); ok++; }
      catch (err) { U.pesan(`${f.name} gagal: ${err.message}`, 'gagal'); }
    }
    st.textContent = ok ? `${ok} berkas ditambahkan.` : '';
    e.target.value = ''; $('#g-judul').value = '';
    muatGaleri();
  };
  $('#g-tambah').onclick = async () => {
    const url = $('#g-tautan').value.trim();
    if (!/^https?:\/\//i.test(url)) { U.pesan('Tautan harus diawali https://', 'gagal'); return; }
    try { await DB.tambahTautan(url, $('#g-judul').value.trim()); $('#g-tautan').value = ''; $('#g-judul').value = ''; muatGaleri(); }
    catch (e) { U.pesan('Gagal menambah tautan: ' + e.message, 'gagal'); }
  };
  $('#g-daftar').onclick = async (e) => {
    const b = e.target.closest('[data-g]'); if (!b || !confirm('Hapus item galeri ini?')) return;
    try { await DB.hapusGaleri(galeriHal.find((g) => g.id === b.dataset.g)); muatGaleri(); }
    catch (err) { U.pesan('Gagal menghapus: ' + err.message, 'gagal'); }
  };

  /* ---------- Pengaturan ---------- */
  async function muatAtur() {
    const s = await DB.pengaturan();
    $('#a-status').textContent = s.pendaftaran_buka ? 'Pendaftaran sedang DIBUKA.' : 'Pendaftaran sedang DITUTUP.';
    const t = $('#a-tukar');
    t.textContent = s.pendaftaran_buka ? 'Tutup Pendaftaran' : 'Buka Pendaftaran';
    t.onclick = async () => {
      try { await DB.setPendaftaran(!s.pendaftaran_buka); muatAtur(); }
      catch (e) { U.pesan('Gagal mengubah: ' + e.message, 'gagal'); }
    };

    // Isian datetime-local dibaca sebagai WIB, apa pun zona waktu komputer admin.
    const j = s.buka_mulai ? new Date(s.buka_mulai) : null;
    $('#a-jadwal').value = j ? j.toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta' }).slice(0, 16).replace(' ', 'T') : '';
    $('#a-jadwal-status').textContent = !j ? 'Tidak ada jadwal.'
      : (j > new Date() ? 'Formulir dibuka otomatis ' : 'Jadwal sudah lewat: ') + U.jadwalWib(j) + '.';
    const simpanJadwal = async (iso) => {
      try { await DB.setJadwalBuka(iso); U.pesan('Jadwal tersimpan.'); muatAtur(); }
      catch (e) { U.pesan('Gagal menyimpan jadwal: ' + e.message, 'gagal'); }
    };
    $('#a-jadwal-simpan').onclick = () => {
      const v = $('#a-jadwal').value;
      if (!v) { U.pesan('Isi tanggal dan jam dulu.', 'gagal'); return; }
      simpanJadwal(new Date(v + ':00+07:00').toISOString());
    };
    $('#a-jadwal-hapus').onclick = () => { if (confirm('Hapus jadwal buka? Formulir langsung mengikuti status buka/tutup.')) simpanJadwal(null); };
  }

  mulai();
})();
