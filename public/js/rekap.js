(function () {
  const { $, esc, angka } = U;
  const PER_HAL = 25;
  let dari = 0, tundaCari;
  const STATUS = { menunggu: 'Dicek panitia', terverifikasi: 'Terverifikasi' };

  async function muatStatistik() {
    const [s, prov] = await Promise.all([DB.statistik(), U.provinsi()]);
    $('#r-tim').textContent = angka(s.total);
    $('#r-ver').textContent = angka(s.terverifikasi);
    $('#r-kab').textContent = angka(s.kabupaten);
    $('#r-prov').textContent = angka(s.provinsi);
    $('#f-prov').insertAdjacentHTML('beforeend', prov.map(([k, n]) => `<option value="${esc(k)}">${esc(n)}</option>`).join(''));
    const per = Object.fromEntries((s.per_provinsi || []).map((p) => [p.prov_kode, p.jumlah]));
    const urut = prov.map(([k, n]) => ({ k, n, j: per[k] || 0 })).sort((a, b) => b.j - a.j || a.n.localeCompare(b.n));
    const maks = Math.max(1, ...urut.map((x) => x.j));
    $('#batang').innerHTML = urut.map((x) => `<button class="batang-baris" data-k="${esc(x.k)}" aria-label="Saring ${esc(x.n)}, ${x.j} tim">
      <span class="batang-nama">${esc(x.n)}</span><span class="batang-angka">${angka(x.j)}</span>
      <span class="batang-trek"><span class="batang-isi" style="display:block;width:${(x.j / maks) * 100}%"></span></span></button>`).join('');
  }

  async function muatTabel() {
    const o = { dari, jumlah: PER_HAL, cari: $('#cari').value, prov: $('#f-prov').value };
    try {
      const { baris, total } = await DB.timPublik(o);
      $('#baris').innerHTML = baris.length ? baris.map((t) => `<tr>
        <td>${esc(t.kode)}</td><td><b>${esc(t.nama_tim)}</b></td>
        <td>${esc(t.desa)}<small>Kec. ${esc(t.kecamatan)}</small></td>
        <td>${esc(t.kabupaten)}</td><td>${esc(t.provinsi)}</td>
        <td><span class="lencana ${esc(t.status)}">${esc(STATUS[t.status] || t.status)}</span></td>
        <td>${esc(U.tanggal(t.created_at))}</td></tr>`).join('')
        : '<tr><td colspan="7">Belum ada timnya. Jadi yang pertama?</td></tr>';
      const akhir = Math.min(dari + PER_HAL, total);
      $('#info').textContent = total ? `Menampilkan ${angka(dari + 1)}-${angka(akhir)} dari ${angka(total)} tim` : '';
      $('#prev').disabled = dari === 0;
      $('#next').disabled = akhir >= total;
    } catch (e) {
      $('#baris').innerHTML = '<tr><td colspan="7">Datanya gagal dimuat. Coba muat ulang halaman ini.</td></tr>';
    }
  }

  $('#cari').oninput = () => { clearTimeout(tundaCari); tundaCari = setTimeout(() => { dari = 0; muatTabel(); }, 300); };
  $('#f-prov').onchange = () => { dari = 0; muatTabel(); tandai(); };
  $('#prev').onclick = () => { dari = Math.max(0, dari - PER_HAL); muatTabel(); };
  $('#next').onclick = () => { dari += PER_HAL; muatTabel(); };
  function tandai() { U.$$('.batang-baris').forEach((b) => b.classList.toggle('pilih', b.dataset.k === $('#f-prov').value)); }
  $('#batang').onclick = (e) => {
    const b = e.target.closest('.batang-baris'); if (!b) return;
    $('#f-prov').value = $('#f-prov').value === b.dataset.k ? '' : b.dataset.k;
    $('#f-prov').onchange();
  };

  muatStatistik().catch(() => {});
  muatTabel();
})();
