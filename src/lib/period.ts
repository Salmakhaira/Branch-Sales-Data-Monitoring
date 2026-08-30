import type { Period } from '@/lib/types';

/* =====================================================================
 *  MINGGU PELAPORAN OTOMATIS
 *
 *  Aturan (disepakati bersama user):
 *    Minggu 1 = tanggal 1  - 7
 *    Minggu 2 = tanggal 8  - 14
 *    Minggu 3 = tanggal 15 - 21
 *    Minggu 4 = tanggal 22 - akhir bulan
 *
 *  Sengaja tidak pernah ada "minggu ke-5": sisa hari di akhir bulan
 *  tetap masuk Minggu 4, sama seperti kolom W1..W4 di Excel.
 *
 *  Semua perhitungan memakai zona waktu Asia/Jakarta (WIB), bukan zona
 *  server. Ini penting karena Vercel menjalankan server dalam UTC —
 *  tanpa penyesuaian ini, pergantian minggu akan terjadi pukul 07:00
 *  WIB, bukan tengah malam.
 * =================================================================== */

export const REPORTING_TIMEZONE = 'Asia/Jakarta';

/** Tanggal hari ini menurut zona waktu Jakarta. */
export function jakartaToday(now: Date = new Date()): {
  year: number;
  month: number;
  day: number;
} {
  // en-CA menghasilkan format YYYY-MM-DD yang mudah dipecah.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: REPORTING_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

  const [year, month, day] = parts.split('-').map(Number);
  return { year, month, day };
}

/** Minggu ke berapa sebuah tanggal jatuh. Selalu 1-4. */
export function weekOfMonth(day: number): number {
  if (day <= 7) return 1;
  if (day <= 14) return 2;
  if (day <= 21) return 3;
  return 4;
}

/** Jumlah hari dalam satu bulan. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Minggu berjalan yang BERLAKU untuk sebuah periode.
 *
 *  - auto_week = false  -> pakai current_week (override manual admin)
 *  - periode = bulan berjalan -> hitung dari tanggal hari ini
 *  - periode bulan lampau -> Minggu 4 (bulan itu sudah lewat seluruhnya)
 *  - periode bulan depan  -> Minggu 1 (belum dimulai)
 */
export function resolveWeek(period: Period, now: Date = new Date()): number {
  if (!period.auto_week) return period.current_week;

  const today = jakartaToday(now);
  const periodStamp = period.year * 100 + period.month;
  const todayStamp = today.year * 100 + today.month;

  if (periodStamp < todayStamp) return 4;
  if (periodStamp > todayStamp) return 1;
  return weekOfMonth(today.day);
}

/** Salinan periode dengan current_week yang sudah diselesaikan. */
export function withResolvedWeek(period: Period, now: Date = new Date()): Period {
  return { ...period, current_week: resolveWeek(period, now) };
}

/** Tanggal berapa minggu ke-n dimulai dan berakhir. */
export function weekRange(
  year: number,
  month: number,
  week: number,
): { start: number; end: number } {
  const start = (week - 1) * 7 + 1;
  const end = week >= 4 ? daysInMonth(year, month) : week * 7;
  return { start, end };
}

/**
 * Kapan minggu berikutnya mulai — dipakai untuk menampilkan
 * "Minggu 3 mulai 15 September" di panel Administrasi.
 * Mengembalikan null bila periode ini sudah di Minggu 4.
 */
export function nextWeekChange(
  period: Period,
  now: Date = new Date(),
): { week: number; day: number } | null {
  const current = resolveWeek(period, now);
  if (current >= 4) return null;
  const next = current + 1;
  return { week: next, day: weekRange(period.year, period.month, next).start };
}

/** Contoh: "22 – 31 Agustus" */
export function describeWeek(year: number, month: number, week: number, monthLabel: string): string {
  const { start, end } = weekRange(year, month, week);
  return `${start} – ${end} ${monthLabel}`;
}
