-- =====================================================================
--  MIGRASI 001 — Revisi Agustus 2026
--
--  Jalankan file ini HANYA jika database Anda sudah terlanjur dibuat
--  dengan schema.sql + seed.sql versi sebelumnya.
--
--  Untuk instalasi baru, tidak perlu: schema.sql dan seed.sql terbaru
--  sudah mencakup semua perubahan di bawah.
--
--  Aman dijalankan berkali-kali.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Minggu pelaporan otomatis mengikuti kalender
-- ---------------------------------------------------------------------

alter table public.periods
  add column if not exists auto_week boolean not null default true;

comment on column public.periods.auto_week is
  'true = minggu berjalan dihitung dari tanggal (W1=1-7, W2=8-14, W3=15-21, W4=22-akhir), zona waktu Asia/Jakarta. false = pakai current_week sebagai override manual.';

-- ---------------------------------------------------------------------
-- 2. Hapus baris penampung yang bukan salesman sungguhan
--    (OTHERS, PROJECT, PROJECT BTM)
--
--    Data report yang menempel pada baris tersebut ikut terhapus lewat
--    ON DELETE CASCADE. Kalau ada angka yang masih ingin diselamatkan,
--    pindahkan dulu ke salesman lain sebelum menjalankan bagian ini.
-- ---------------------------------------------------------------------

-- Cek dulu apa yang akan terhapus:
--   select b.code, s.name,
--          (select count(*) from public.report_entries e where e.salesman_id = s.id) as jml_baris_report
--     from public.salesmen s
--     join public.branches b on b.id = s.branch_id
--    where upper(btrim(s.name)) in ('OTHERS', 'PROJECT', 'PROJECT BTM')
--    order by b.sort_order;

delete from public.salesmen
 where upper(btrim(name)) in ('OTHERS', 'PROJECT', 'PROJECT BTM');

-- ---------------------------------------------------------------------
-- 3. Buang sisa kolom PLAN SALES MASTER dari data yang sudah tersimpan
--    Kolom ini dihapus dari sistem, jadi nilainya tidak lagi dipakai.
-- ---------------------------------------------------------------------

update public.report_entries
   set values = values - 'plan_sales'
 where values ? 'plan_sales';

update public.report_snapshots
   set values = values - 'plan_sales'
 where values ? 'plan_sales';

-- Jejak audit atas kolom itu dibiarkan utuh — riwayat perubahan masa lalu
-- tetap bisa dibaca di menu Monitoring Perubahan.

-- ---------------------------------------------------------------------
-- Selesai. Verifikasi:
-- ---------------------------------------------------------------------
--   select count(*) as jml_salesman from public.salesmen;          -- harusnya 39
--   select year, month, auto_week, current_week from public.periods;
