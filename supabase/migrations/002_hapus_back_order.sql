-- =====================================================================
--  MIGRASI 002 — Hapus kolom Back Order, kembalikan Plan Sales Master
--
--  Jalankan HANYA jika database Anda sudah pernah diisi data memakai
--  versi sebelumnya. Untuk instalasi baru tidak perlu.
--
--  Aman dijalankan berkali-kali.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Buang seluruh kolom Back Order dari data yang sudah tersimpan
--
--    Kolom yang dihapus:
--      bo_poco_main, bo_poco_ikd, bo_poco_bkt,
--      bo_prtm_main, bo_prtm_ikd, bo_prtm_bkt
--    Kolom turunannya (bo_poco_total, bo_prtm_total, bo_total,
--    bo_balance) tidak pernah disimpan — selalu dihitung ulang — jadi
--    tidak perlu dibersihkan.
-- ---------------------------------------------------------------------

update public.report_entries
   set values = values
              - 'bo_poco_main' - 'bo_poco_ikd' - 'bo_poco_bkt'
              - 'bo_prtm_main' - 'bo_prtm_ikd' - 'bo_prtm_bkt'
 where values ?| array['bo_poco_main','bo_poco_ikd','bo_poco_bkt',
                       'bo_prtm_main','bo_prtm_ikd','bo_prtm_bkt'];

update public.report_snapshots
   set values = values
              - 'bo_poco_main' - 'bo_poco_ikd' - 'bo_poco_bkt'
              - 'bo_prtm_main' - 'bo_prtm_ikd' - 'bo_prtm_bkt'
 where values ?| array['bo_poco_main','bo_poco_ikd','bo_poco_bkt',
                       'bo_prtm_main','bo_prtm_ikd','bo_prtm_bkt'];

-- Jejak audit atas kolom itu dibiarkan utuh — riwayat perubahan masa
-- lalu tetap bisa dibaca di Monitoring Perubahan.

-- ---------------------------------------------------------------------
-- 2. Plan Sales Master dipakai kembali
--
--    Migrasi 001 sempat membuang kunci 'plan_sales' dari data tersimpan.
--    Tidak ada yang perlu dijalankan di sini: kolom akan terisi lagi
--    begitu cabang mengisinya, dan sel kosong dianggap nol.
--
--    Bila Anda ingin langsung mengisikan target dari file Excel, contoh:
--
--      update public.report_entries e
--         set values = e.values || jsonb_build_object('plan_sales', 3597)
--        from public.salesmen s
--       where s.id = e.salesman_id
--         and s.name = 'ADITIA KURNIAWAN'
--         and e.period_id = (select id from public.periods
--                             where year = 2026 and month = 8);
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- Verifikasi — seharusnya mengembalikan 0 baris:
-- ---------------------------------------------------------------------
--   select count(*) from public.report_entries
--    where values ?| array['bo_poco_main','bo_prtm_main'];
