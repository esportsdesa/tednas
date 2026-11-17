/* Pembuat twibbon (user 18 Nov: pendaftar wajib post foto/video bertwibbon di story/feed dengan tag @esportsdesa.official).
   Semua diproses di HP pengguna: foto tidak diunggah ke mana pun. Bingkai 1080×1920 (bagian tengah transparan) digambar
   di atas foto; foto bisa digeser (seret) dan diperbesar (penggeser / roda tetikus / cubit dua jari). */
(function () {
  const $ = (s) => document.querySelector(s);
  const kanvas = $('#tw-kanvas'), ctx = kanvas.getContext('2d');
  const W = kanvas.width, H = kanvas.height;
  const bingkai = new Image();
  bingkai.src = 'unduhan/twibbon-tednas-2027.png';
  let foto = null, zoom = 1, x = 0, y = 0; // x,y = geseran pusat foto dari pusat kanvas (piksel kanvas)

  function gambar() {
    ctx.fillStyle = '#16103f'; ctx.fillRect(0, 0, W, H);
    if (foto) {
      const dasar = Math.max(W / foto.width, H / foto.height), s = dasar * zoom;
      const w = foto.width * s, h = foto.height * s;
      // Jangan sampai ada celah kosong: geseran dibatasi supaya foto tetap menutup kanvas.
      x = Math.max(-(w - W) / 2, Math.min((w - W) / 2, x));
      y = Math.max(-(h - H) / 2, Math.min((h - H) / 2, y));
      ctx.drawImage(foto, (W - w) / 2 + x, (H - h) / 2 + y, w, h);
    }
    if (bingkai.complete && bingkai.naturalWidth) ctx.drawImage(bingkai, 0, 0, W, H);
  }
  bingkai.onload = gambar;

  $('#tw-foto').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      foto = await createImageBitmap(f);
    } catch (err) {
      const img = new Image(); img.src = URL.createObjectURL(f);
      try { await img.decode(); foto = img; } catch (e2) { alert('Foto ini tidak bisa dibuka. Coba foto lain (JPG/PNG).'); return; }
    }
    zoom = 1; x = 0; y = 0; $('#tw-zoom').value = 100;
    $('#tw-zoom').disabled = $('#tw-unduh').disabled = $('#tw-bagikan').disabled = false;
    $('#tw-kosong').hidden = true;
    gambar();
  });
  $('#tw-zoom').addEventListener('input', (e) => { zoom = e.target.value / 100; gambar(); });

  /* Seret & cubit. Koordinat layar diubah ke piksel kanvas. */
  const titik = new Map();
  let jarakAwal = 0, zoomAwal = 1;
  const skala = () => W / kanvas.getBoundingClientRect().width;
  kanvas.addEventListener('pointerdown', (e) => { if (!foto) return; kanvas.setPointerCapture(e.pointerId); titik.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (titik.size === 2) { const [a, b] = [...titik.values()]; jarakAwal = Math.hypot(a.x - b.x, a.y - b.y); zoomAwal = zoom; } });
  kanvas.addEventListener('pointermove', (e) => {
    if (!foto || !titik.has(e.pointerId)) return;
    const lama = titik.get(e.pointerId); titik.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (titik.size === 1) { x += (e.clientX - lama.x) * skala(); y += (e.clientY - lama.y) * skala(); }
    else if (titik.size === 2 && jarakAwal) { const [a, b] = [...titik.values()]; zoom = Math.max(1, Math.min(3, zoomAwal * Math.hypot(a.x - b.x, a.y - b.y) / jarakAwal)); $('#tw-zoom').value = Math.round(zoom * 100); }
    gambar();
  });
  const lepas = (e) => { titik.delete(e.pointerId); if (titik.size < 2) jarakAwal = 0; };
  kanvas.addEventListener('pointerup', lepas); kanvas.addEventListener('pointercancel', lepas);
  kanvas.addEventListener('wheel', (e) => { if (!foto) return; e.preventDefault(); zoom = Math.max(1, Math.min(3, zoom * (e.deltaY < 0 ? 1.06 : 1 / 1.06))); $('#tw-zoom').value = Math.round(zoom * 100); gambar(); }, { passive: false });

  const hasil = () => new Promise((ok) => kanvas.toBlob(ok, 'image/jpeg', 0.92));
  $('#tw-unduh').addEventListener('click', async () => {
    const b = await hasil(), a = document.createElement('a');
    a.href = URL.createObjectURL(b); a.download = 'twibbon-tednas-2027.jpg';
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  });
  // HP yang mendukung berbagi berkas: langsung ke aplikasi Instagram / galeri.
  const bisaBagi = () => { try { return navigator.canShare && navigator.canShare({ files: [new File([''], 'a.jpg', { type: 'image/jpeg' })] }); } catch (e) { return false; } };
  if (bisaBagi()) $('#tw-bagikan').hidden = false;
  $('#tw-bagikan').addEventListener('click', async () => {
    const f = new File([await hasil()], 'twibbon-tednas-2027.jpg', { type: 'image/jpeg' });
    try { await navigator.share({ files: [f], text: 'Kami Siap Juara! #TEDNas2027 @esportsdesa.official' }); } catch (e) { /* dibatalkan */ }
  });
  gambar();
})();
