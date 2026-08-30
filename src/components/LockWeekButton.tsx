'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

/* PIC Head Office mengunci minggu berjalan untuk SELURUH cabang sekaligus
 * (fitur bulk-lock, terpisah dari tombol Submit per cabang) — biasanya
 * ditekan tepat sebelum rapat monitoring. */

export default function LockWeekButton({
  periodId,
  week,
  periodLabel,
}: {
  periodId: string;
  week: number;
  periodLabel: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  async function lock() {
    if (
      !confirm(
        `Kunci Minggu ${week} ${periodLabel} untuk semua cabang?\n\n` +
          'Angka yang ada sekarang akan disimpan sebagai laporan resmi minggu ini. ' +
          'Perubahan file setelah ini akan terdeteksi sebagai revisi dan ditagih penjelasannya.',
      )
    )
      return;

    setBusy(true);
    setResult(null);

    const supabase = createClient();
    const { data, error } = await supabase.rpc('lock_week', {
      p_period_id: periodId,
      p_week: week,
    });

    setBusy(false);

    if (error) {
      setResult({ tone: 'err', text: error.message });
      return;
    }

    const row = Array.isArray(data) ? data[0] : data;
    setResult({
      tone: 'ok',
      text: `Minggu ${week} terkunci — ${row?.branches_locked ?? 0} cabang, ${row?.rows_snapshotted ?? 0} baris tersimpan.`,
    });
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={lock}
        disabled={busy}
        className="rounded-lg border border-brand-600 bg-white px-3 py-1.5 text-xs font-medium text-brand-700 transition hover:bg-brand-50 disabled:opacity-50"
      >
        {busy ? 'Mengunci…' : `🔒 Kunci Minggu ${week}`}
      </button>
      {result && (
        <span
          className={`text-[11px] ${
            result.tone === 'ok' ? 'text-emerald-700' : 'text-rose-700'
          }`}
        >
          {result.text}
        </span>
      )}
    </div>
  );
}
