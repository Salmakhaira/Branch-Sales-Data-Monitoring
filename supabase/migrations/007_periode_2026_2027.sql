-- =====================================================================
--  007. PERIODE JANUARI 2026 - DESEMBER 2027
-- =====================================================================
--
--  Sebelumnya hanya ada satu periode (Agustus 2026) dan sisanya dibuat
--  sendiri oleh ensure_current_period() saat bulannya tiba. Akibatnya
--  pemilih bulan di halaman Input Report cuma berisi satu-dua pilihan,
--  sehingga cabang tidak bisa menyusul bulan lampau atau menyiapkan
--  bulan depan.
--
--  Migrasi ini membuat SELURUH 24 periode Januari 2026 - Desember 2027
--  sekaligus, semuanya terbuka (is_open = true) dan auto_week = true.
--
--  Aman dijalankan berkali-kali: baris yang sudah ada dilewati oleh
--  "on conflict (year, month) do nothing", jadi periode yang sudah
--  berisi data TIDAK tersentuh sama sekali.
--
-- =====================================================================

insert into public.periods (year, month, current_week, auto_week, is_open)
select
  y.year,
  m.month,
  1,      -- diabaikan selama auto_week = true
  true,   -- minggu dihitung dari tanggal hari ini (zona WIB)
  true    -- terbuka; admin bisa menutup per bulan bila perlu
from generate_series(2026, 2027) as y(year)
cross join generate_series(1, 12) as m(month)
on conflict (year, month) do nothing;
