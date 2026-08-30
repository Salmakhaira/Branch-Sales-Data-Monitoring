'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { monthName } from '@/lib/format';
import type { Period } from '@/lib/types';

/* =====================================================================
 *  PEMILIH BULAN & TAHUN TERPISAH
 *
 *  Dipakai di halaman Input Report. Satu daftar berisi 24 periode terlalu
 *  panjang untuk dipindai saat cabang cuma ingin ganti bulan, jadi di
 *  sini dipecah jadi dua kotak: Bulan dan Tahun.
 *
 *  Bulan yang periodenya belum ada di database dinonaktifkan, bukan
 *  disembunyikan — supaya jelas bahwa bulan itu memang belum dibuka,
 *  bukan hilang karena bug.
 *
 *  Mengganti bulan/tahun ikut MENGHAPUS parameter `week`, karena batas
 *  minggu tiap bulan berbeda (bulan berjalan dibatasi minggu kalender).
 *  Tanpa ini, pindah dari Agustus W4 ke bulan depan akan meminta minggu
 *  yang belum tiba.
 * =================================================================== */

const SELECT_CLASS =
  'rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs outline-none transition focus:border-brand-500 disabled:bg-slate-100 disabled:text-slate-400';

export default function MonthYearPicker({
  periods,
  current,
}: {
  periods: Period[];
  current: Period;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const years = Array.from(new Set(periods.map((p) => p.year))).sort((a, b) => a - b);
  const monthsOfYear = new Map<number, Set<number>>();
  for (const p of periods) {
    if (!monthsOfYear.has(p.year)) monthsOfYear.set(p.year, new Set());
    monthsOfYear.get(p.year)!.add(p.month);
  }

  function go(year: number, month: number) {
    // Bila kombinasi bulan+tahun tidak ada, ambil bulan paling awal yang
    // tersedia di tahun itu supaya pemilih tidak pernah buntu.
    const target =
      periods.find((p) => p.year === year && p.month === month) ??
      periods.filter((p) => p.year === year).sort((a, b) => a.month - b.month)[0];
    if (!target || target.id === current.id) return;

    const next = new URLSearchParams(params.toString());
    next.set('period', target.id);
    next.delete('week');
    router.push(`${pathname}?${next.toString()}`);
  }

  const availableMonths = monthsOfYear.get(current.year) ?? new Set<number>();

  return (
    <div className="flex items-center gap-2">
      <label className="flex items-center gap-1.5">
        <span className="text-[11px] font-medium text-slate-500">Bulan</span>
        <select
          value={current.month}
          onChange={(e) => go(current.year, Number(e.target.value))}
          className={SELECT_CLASS}
          style={{ minWidth: 108 }}
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m} disabled={!availableMonths.has(m)}>
              {monthName(m)}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-1.5">
        <span className="text-[11px] font-medium text-slate-500">Tahun</span>
        <select
          value={current.year}
          onChange={(e) => go(Number(e.target.value), current.month)}
          className={SELECT_CLASS}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </label>

      {!current.is_open && (
        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
          Ditutup
        </span>
      )}
    </div>
  );
}
