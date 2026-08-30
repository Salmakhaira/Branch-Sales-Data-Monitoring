'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { periodLabel } from '@/lib/format';
import type { Period } from '@/lib/types';

/* Daftar periode kini berisi 24 bulan (Jan 2026 - Des 2027), jadi
 * dikelompokkan per tahun dengan <optgroup> supaya tidak jadi daftar
 * panjang yang sulit dipindai. */

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

  // periods sudah terurut tahun & bulan menurun dari server.
  const years: Array<{ year: number; items: Period[] }> = [];
  for (const p of periods) {
    const last = years[years.length - 1];
    if (last && last.year === p.year) last.items.push(p);
    else years.push({ year: p.year, items: [p] });
  }

  return (
    <select
      value={current}
      onChange={(e) => {
        const next = new URLSearchParams(params.toString());
        next.set('period', e.target.value);
        router.push(`${pathname}?${next.toString()}`);
      }}
      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs outline-none focus:border-brand-500"
    >
      {years.map((g) => (
        <optgroup key={g.year} label={String(g.year)}>
          {g.items.map((p) => (
            <option key={p.id} value={p.id}>
              {periodLabel(p.year, p.month)}
              {p.is_open ? '' : ' (ditutup)'}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
