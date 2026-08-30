-- =====================================================================
--  MIGRASI 003 — Periode bulan baru dibuat otomatis
--
--  Sebelumnya admin harus menekan "Buat Periode" tiap awal bulan.
--  Sekarang periode bulan berjalan dibuat sendiri saat halaman pertama
--  kali dibuka pada bulan tersebut, jadi tidak ada lagi tugas rutin.
--
--  Jalankan HANYA jika database Anda dibuat dengan versi sebelumnya.
--  Untuk instalasi baru, schema.sql terbaru sudah memuat fungsi ini.
--
--  Aman dijalankan berkali-kali.
-- =====================================================================

create or replace function public.ensure_current_period()
returns public.periods
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Tanggal menurut WIB, bukan zona server. Vercel berjalan di UTC,
  -- jadi tanpa ini periode bulan baru akan terbentuk pukul 07:00 WIB
  -- pada tanggal 1, bukan tengah malam.
  today date := (now() at time zone 'Asia/Jakarta')::date;
  y int := extract(year from today)::int;
  m int := extract(month from today)::int;
  result public.periods;
begin
  insert into public.periods (year, month, current_week, auto_week, is_open)
  values (y, m, 1, true, true)
  on conflict (year, month) do nothing;

  select * into result from public.periods where year = y and month = m;
  return result;
end;
$$;

comment on function public.ensure_current_period() is
  'Mengembalikan periode bulan berjalan (WIB), membuatnya lebih dulu bila belum ada. SECURITY DEFINER supaya user cabang pun bisa memicu pembuatannya, tanpa memberi mereka hak tulis ke tabel periods.';

-- SECURITY DEFINER melewati RLS, jadi user cabang bisa memicu pembuatan
-- periode tanpa perlu diberi hak INSERT langsung ke tabel periods.
-- Fungsi ini tidak menerima parameter apa pun — satu-satunya baris yang
-- bisa dibuatnya adalah bulan berjalan.
grant execute on function public.ensure_current_period() to authenticated;

-- ---------------------------------------------------------------------
-- Verifikasi:
--   select * from public.ensure_current_period();
-- ---------------------------------------------------------------------
