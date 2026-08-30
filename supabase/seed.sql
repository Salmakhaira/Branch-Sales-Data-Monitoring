-- =====================================================================
--  SEED DATA - master area, cabang, salesman, dan periode awal.
--  Diambil dari sheet 'MOS AGUSTUS 2026' pada
--  WEEKLY REPORT MOS NASIONAL 2026.xlsx
--
--  Baris penampung OTHERS, PROJECT, dan PROJECT BTM sengaja TIDAK
--  disertakan - hanya salesman sungguhan yang didaftarkan.
--
--  Jalankan SESUDAH schema.sql
-- =====================================================================

insert into public.areas (code, name, sort_order) values
  ('ZDJ', 'AREA 1 (ZDJ)', 1),
  ('BBB', 'AREA 2 (BBB)', 2),
  ('STH', 'AREA 3 (STH)', 3)
on conflict (code) do nothing;

insert into public.branches (code, name, area_id, sort_order) values
  ('SMD-1', 'SAMARINDA-1', (select id from public.areas where code = 'ZDJ'), 1),
  ('SMD-2', 'SAMARINDA-2', (select id from public.areas where code = 'ZDJ'), 2),
  ('PLB', 'PALEMBANG', (select id from public.areas where code = 'ZDJ'), 3),
  ('BLG', 'BANDAR LAMPUNG', (select id from public.areas where code = 'ZDJ'), 4),
  ('SMP', 'SAMPIT', (select id from public.areas where code = 'ZDJ'), 5),
  ('MDN', 'MEDAN', (select id from public.areas where code = 'ZDJ'), 6),
  ('JMB', 'JAMBI', (select id from public.areas where code = 'BBB'), 7),
  ('PDG', 'PADANG', (select id from public.areas where code = 'BBB'), 8),
  ('MKS', 'MAKASSAR', (select id from public.areas where code = 'STH'), 9),
  ('PKB', 'PEKANBARU', (select id from public.areas where code = 'STH'), 10),
  ('PTK', 'PONTIANAK', (select id from public.areas where code = 'STH'), 11),
  ('JYP', 'JAYAPURA', (select id from public.areas where code = 'STH'), 12),
  ('BJM', 'BANJARMASIN', (select id from public.areas where code = 'STH'), 13)
on conflict (code) do nothing;

insert into public.salesmen (branch_id, name, sort_order) values
  ((select id from public.branches where code = 'SMD-1'), 'ADITIA KURNIAWAN', 1),
  ((select id from public.branches where code = 'SMD-1'), 'GERINDRA YONKY', 2),
  ((select id from public.branches where code = 'SMD-1'), 'HENDRA SIHOMBING', 3),
  ((select id from public.branches where code = 'SMD-1'), 'SHN', 4),
  ((select id from public.branches where code = 'SMD-2'), 'AGUSTIN PANGGABEAN', 1),
  ((select id from public.branches where code = 'SMD-2'), 'PICASO MARKUS AGAVENTA BANGUN', 2),
  ((select id from public.branches where code = 'PLB'), 'M. IQBAL ANDY KURNIAWAN', 1),
  ((select id from public.branches where code = 'PLB'), 'M. IKBAL FERDIANSYAH', 2),
  ((select id from public.branches where code = 'PLB'), 'SUDARSO', 3),
  ((select id from public.branches where code = 'PLB'), 'SHN', 4),
  ((select id from public.branches where code = 'BLG'), 'M. INDRA ARYANSAYAH', 1),
  ((select id from public.branches where code = 'BLG'), 'M. BALDIANSYA DEWANA', 2),
  ((select id from public.branches where code = 'SMP'), 'ANDREW NOFENESIA', 1),
  ((select id from public.branches where code = 'SMP'), 'HADI ISNANDAR', 2),
  ((select id from public.branches where code = 'SMP'), 'HENDRA SAPUTRA', 3),
  ((select id from public.branches where code = 'SMP'), 'HADI PRAYITNO', 4),
  ((select id from public.branches where code = 'MDN'), 'YOSRA HADI PUTRA', 1),
  ((select id from public.branches where code = 'MDN'), 'M. YUSUF SIPAHUTAR', 2),
  ((select id from public.branches where code = 'MDN'), 'DEALER', 3),
  ((select id from public.branches where code = 'MDN'), 'SHN', 4),
  ((select id from public.branches where code = 'JMB'), 'ALIF ALVIANTO', 1),
  ((select id from public.branches where code = 'JMB'), 'SHN', 2),
  ((select id from public.branches where code = 'PDG'), 'MUHAMMAD FAQIH ASSHIDIEQ', 1),
  ((select id from public.branches where code = 'MKS'), 'M. FADLY SINGKANG', 1),
  ((select id from public.branches where code = 'MKS'), 'WAHYUDDIN ABDULLAH', 2),
  ((select id from public.branches where code = 'MKS'), 'ZYAINI BHARKAH', 3),
  ((select id from public.branches where code = 'PKB'), 'HADY SUDHARSONO', 1),
  ((select id from public.branches where code = 'PKB'), 'IRFAN TRIYANTO', 2),
  ((select id from public.branches where code = 'PKB'), 'SETIA WANDI', 3),
  ((select id from public.branches where code = 'PTK'), 'ALPRIMA RAMDHANA', 1),
  ((select id from public.branches where code = 'PTK'), 'PUNGKAS PIJAR RAHMANTO', 2),
  ((select id from public.branches where code = 'PTK'), 'SETYONO M.T HIDAYAHTULLAH', 3),
  ((select id from public.branches where code = 'PTK'), 'M. RAFLY BAGOES IRAWAN', 4),
  ((select id from public.branches where code = 'JYP'), 'HARUN HARYANTO LATUMAHINA', 1),
  ((select id from public.branches where code = 'JYP'), 'INDRA THAMRIN', 2),
  ((select id from public.branches where code = 'BJM'), 'INDRA WINARTA SANDHI', 1),
  ((select id from public.branches where code = 'BJM'), 'PAMRIH SANTOSO', 2),
  ((select id from public.branches where code = 'BJM'), 'PRIYA LAKSONO', 3),
  ((select id from public.branches where code = 'BJM'), 'RONNY FERDIAN', 4)
on conflict (branch_id, name) do nothing;

-- Periode Januari 2026 - Desember 2027 (24 bulan) dibuat sekaligus supaya
-- pemilih bulan di halaman Input Report langsung berisi penuh — cabang
-- bisa menyusul bulan lampau maupun menyiapkan bulan depan.
-- current_week diabaikan selama auto_week = true, karena minggu berjalan
-- dihitung otomatis dari tanggal hari ini (zona waktu Asia/Jakarta).
insert into public.periods (year, month, current_week, auto_week, is_open)
select y.year, m.month, 1, true, true
from generate_series(2026, 2027) as y(year)
cross join generate_series(1, 12) as m(month)
on conflict (year, month) do nothing;

-- ---------------------------------------------------------------------
-- SETELAH mendaftarkan user lewat Supabase Auth (Authentication > Users),
-- set role & cabangnya di sini. Contoh:
--
--   update public.profiles set role = 'admin'
--    where email = 'admin@perusahaan.co.id';
--
--   update public.profiles set role = 'ho_pic'
--    where email = 'pic.ho@perusahaan.co.id';
--
--   update public.profiles
--      set role = 'cabang',
--          branch_id = (select id from public.branches where code = 'SMP')
--    where email = 'sampit@perusahaan.co.id';
-- ---------------------------------------------------------------------
