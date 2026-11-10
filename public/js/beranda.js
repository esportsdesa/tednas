(function () {
  const { $, angka } = U;

  const FINAL = new Date('2027-01-14T09:00:00+07:00').getTime();
  const dua = (n) => String(n).padStart(2, '0');
  function detak() {
    const s = Math.max(0, Math.floor((FINAL - Date.now()) / 1000));
    $('[data-h]').textContent = Math.floor(s / 86400);
    $('[data-j]').textContent = dua(Math.floor((s % 86400) / 3600));
    $('[data-m]').textContent = dua(Math.floor((s % 3600) / 60));
    $('[data-d]').textContent = dua(s % 60);
  }
  detak(); setInterval(detak, 1000);

  DB.statistik().then((s) => {
    $('#s-tim').textContent = angka(s.total);
    $('#s-ver').textContent = angka(s.terverifikasi);
    $('#s-kab').textContent = angka(s.kabupaten);
    $('#s-prov').textContent = angka(s.provinsi);
  }).catch(() => {});

  DB.galeri().then((g) => {
    // Unggahan dari admin tampil di depan foto bawaan.
    $('#galeri-isi').insertAdjacentHTML('afterbegin', g.map(U.kartuGaleri).join(''));
  }).catch(() => {});
})();
