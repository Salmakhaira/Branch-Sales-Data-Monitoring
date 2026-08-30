-- =====================================================================
--  006. HAPUS SISA MODE ONEDRIVE
-- =====================================================================
--
--  Sistem ini sekarang HANYA berjalan dengan skema input lewat website
--  (Opsi 1) — bukan skema OneDrive/Power Automate (Opsi 2). Migration
--  004 dulu membuat beberapa tabel & fungsi khusus mode OneDrive; migration
--  ini menghapusnya kembali karena tidak pernah dipakai di skema yang
--  berjalan sekarang.
--
--  Yang SENGAJA TIDAK disentuh (masih dipakai mode website):
--    - kolom reason_status & constraint-nya (dari migration 004 §1)
--    - fungsi lock_week() — bulk-lock oleh PIC HO, fitur umum bukan
--      khusus OneDrive (sudah didefinisikan ulang di migration 005)
--    - view v_revision_monitor (sudah didefinisikan ulang di migration 005)
--    - report_branch_entries, report_branch_snapshots, kolom
--      entry_revisions.branch_entry_id (migration 005, tidak terkait OneDrive)
--
-- =====================================================================

-- 1. Fungsi khusus alur "Belum Dijelaskan" (tab /pending, sudah dihapus)
drop function if exists public.submit_revision_reason(uuid, text, text);

-- 2. Tabel riwayat sinkronisasi OneDrive
drop table if exists public.sync_runs;

-- 3. Tabel sumber file per cabang (OneDrive)
drop table if exists public.sync_sources;
