'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/* Pemilih minggu pelaporan.
 *
 * Default-nya minggu menurut kalender, tapi cabang boleh memilih minggu
 * lain — misalnya menyusul laporan Minggu 2 padahal hari ini sudah
 * Minggu 4. Minggu yang sudah di-submit ditandai, dan minggu yang belum
 * tiba (pada bulan berjalan) dinonaktifkan. */

export default function WeekPicker({
  current,
  maxWeek,
  submittedWeeks,
  monthLabel,
}: {
  current: number;
  maxWeek: number;
  submittedWeeks: number[];
  monthLabel: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function select(week: number) {
    const next = new URLSearchParams(params.toString());
    next.set('week', String(week));
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] text-slate-500">Minggu:</span>
      <div className="flex gap-1 rounded-lg border border-slate-300 bg-white p-0.5">
        {[1, 2, 3, 4].map((w) => {
          const submitted = submittedWeeks.includes(w);
          const future = w > maxWeek;
          const active = current === w;
          return (
            <button
              key={w}
              onClick={() => select(w)}
              disabled={future}
              title={
                future
                  ? `Minggu ${w} ${monthLabel} belum tiba`
                  : submitted
                    ? `Minggu ${w} sudah di-submit — perubahan wajib disertai alasan`
                    : `Lapor untuk Minggu ${w}`
              }
              className={`relative h-7 w-10 rounded text-[11px] font-medium transition ${
                active
                  ? 'bg-brand-600 text-white'
                  : future
                    ? 'cursor-not-allowed text-slate-300'
                    : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              W{w}
              {submitted && (
                <span
                  aria-hidden
                  className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full ${
                    active ? 'bg-white' : 'bg-emerald-500'
                  }`}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
