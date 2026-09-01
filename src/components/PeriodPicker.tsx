'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { monthName } from '@/lib/format';
import type { Period } from '@/lib/types';

/* Filter Bulan & Tahun dipisah jadi dua <select>: satu daftar tahun (2026,
 * 2027, …), satu daftar bulan (Januari..Desember) untuk tahun yang sedang
 * dipilih. Keduanya sama-sama menunjuk ke satu `period` (kombinasi
 * tahun+bulan), jadi memilih salah satu tetap harus mencari `period.id`
 * yang cocok sebelum pindah halaman. */

export default function PeriodPicker({
  periods,
  current,
}: {
  periods: Period[];
  current: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const currentPeriod = periods.find((p) => p.id === current);

  const years = Array.from(new Set(periods.map((p) => p.year))).sort((a, b) => b - a);
  const monthsInYear = periods
    .filter((p) => p.year === currentPeriod?.year)
    .sort((a, b) => a.month - b.month);

  const goTo = (id: string) => {
    const next = new URLSearchParams(params.toString());
    next.set('period', id);
    router.push(`${pathname}?${next.toString()}`);
  };

  const handleMonthChange = (month: number) => {
    const target = periods.find((p) => p.year === currentPeriod?.year && p.month === month);
    if (target) goTo(target.id);
  };

  const handleYearChange = (year: number) => {
    // Pindah tahun tapi tetap coba pertahankan bulan yang sama; kalau bulan
    // itu belum ada di tahun tujuan, pakai bulan pertama yang tersedia.
    const sameMonth = periods.find((p) => p.year === year && p.month === currentPeriod?.month);
    const fallback = periods.filter((p) => p.year === year).sort((a, b) => a.month - b.month)[0];
    const target = sameMonth ?? fallback;
    if (target) goTo(target.id);
  };

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={currentPeriod?.month ?? ''}
        onChange={(e) => handleMonthChange(Number(e.target.value))}
        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs outline-none focus:border-brand-500"
      >
        {monthsInYear.map((p) => (
          <option key={p.id} value={p.month}>
            {monthName(p.month)}
            {p.is_open ? '' : ' (ditutup)'}
          </option>
        ))}
      </select>
      <select
        value={currentPeriod?.year ?? ''}
        onChange={(e) => handleYearChange(Number(e.target.value))}
        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs outline-none focus:border-brand-500"
      >
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </div>
  );
}
