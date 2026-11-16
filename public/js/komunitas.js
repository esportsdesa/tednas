/* Papan Komunitas (ToT): peringkat komunitas menurut tim terverifikasi yang mendaftar lewat tautan komunitasnya. */
(function () {
  const { $, esc, angka } = U;
  let semua = [];
  const normal = (t) => String(t || '').toLowerCase();

  function gambar() {
    const q = normal($('#cari').value.trim());
    // Peringkat dihitung dari seluruh daftar; pencarian hanya menyaring baris, nomor peringkat tetap.
    const baris = semua.map((k, i) => ({ ...k, ke: i + 1 })).filter((k) => !q || normal(`${k.nama} ${k.kota} ${k.provinsi}`).includes(q));
    $('#baris').innerHTML = baris.length ? baris.map((k) => `<tr${k.ke <= 3 && k.terverifikasi > 0 ? ' class="papan-atas"' : ''}>
      <td class="papan-ke">${k.ke}</td>
      <td><b>${esc(k.nama)}</b><small>${esc([k.kota, k.provinsi].filter(Boolean).join(', '))}</small></td>
      <td class="angka"><b>${angka(k.terverifikasi)}</b></td><td class="angka">${angka(k.mendaftar)}</td><td class="angka">${angka(k.pemain)}</td></tr>`).join('')
      : `<tr><td colspan="5">${semua.length ? 'Komunitas tidak ditemukan.' : 'Belum ada komunitas yang ikut.'}</td></tr>`;
  }

  (async () => {
    try {
      semua = await DB.papanKomunitas();
      $('#p-komunitas').textContent = angka(semua.length);
      $('#p-ver').textContent = angka(semua.reduce((n, k) => n + Number(k.terverifikasi), 0));
      $('#p-tim').textContent = angka(semua.reduce((n, k) => n + Number(k.mendaftar), 0));
      gambar();
    } catch (e) { $('#baris').innerHTML = '<tr><td colspan="5">Papan gagal dimuat. Muat ulang halaman ini.</td></tr>'; }
  })();
  $('#cari').oninput = gambar;
})();
