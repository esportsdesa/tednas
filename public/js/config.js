/* Konfigurasi TEDNas.
   Kunci publik: aman tampil di browser, akses dijaga RLS. Nilai GANTI_ berarti mode lokal. */
window.APP_CONFIG = {
  SUPABASE_URL: 'https://dlznnpmzccndjqxxhnio.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_jBDfxJAsqsdLlKD3eK_TVA_9l4voeNS',
  TURNSTILE_SITE_KEY: '0x4AAAAAAFtmaVnev07_bB2J',
  // Web App Google Drive (deploy/drive/Code.gs). Kosong = berkas masih ke bucket Supabase.
  DRIVE_URL: 'https://script.google.com/macros/s/AKfycbxNJLVu4HNulN9iRLxHSgEsC0FQQNjmzJ166_tpil6vN0-fzDpE3QN9_3ZYzstjzNhYxw/exec'
};
