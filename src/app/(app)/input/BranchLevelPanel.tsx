'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BRANCH_INPUT_KEYS,
  METRIC_BY_KEY,
  computeRow,
  isFieldLocked,
  nearlyEqual,
  type ValueMap,
} from '@/lib/metrics';
import { fmtNumber, fmtPercent, parseNumberInput } from '@/lib/format';
import ReasonModal, { type ReasonInput } from '@/components/ReasonModal';
import type { SaveConflict } from '@/lib/types';

interface Props {
  periodId: string;
  branchId: string;
  branchName: string;
  readOnly: boolean;
  lastSubmittedWeek: number | null;
  initialValues: ValueMap;
  snapshotValues: ValueMap;
}

/* =====================================================================
 *  DATA TINGKAT CABANG
 *
 *  PLAN SALES MASTER, OL MIN PRTM, dan ACTUAL SALES — di Excel asli,
 *  ketiganya SELALU diisi SEKALI di baris TOTAL cabang, tidak pernah
 *  dipecah per salesman. Panel ini meniru itu persis: satu angka per
 *  kolom, bukan tabel per orang seperti grid di bawahnya.
 *
 *  Aturan "wajib alasan" berlaku identik dengan grid — hanya bedanya
 *  disimpan lewat report_branch_entries, bukan report_entries.
 * =================================================================== */

export default function BranchLevelPanel({
  periodId,
  branchId,
  branchName,
  readOnly,
  lastSubmittedWeek,
  initialValues,
  snapshotValues,
}: Props) {
  const router = useRouter();
  const [values, setValues] = useState<ValueMap>(initialValues);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [conflicts, setConflicts] = useState<SaveConflict[] | null>(null);

  const dirtyKeys = useMemo(
    () => BRANCH_INPUT_KEYS.filter((k) => !nearlyEqual(values[k], initialValues[k])),
    [values, initialValues],
  );

  const needsReasonKeys = useMemo(() => {
    if (!lastSubmittedWeek) return new Set<string>();
    const set = new Set<string>();
    for (const key of BRANCH_INPUT_KEYS) {
      if (!isFieldLocked(key, lastSubmittedWeek)) continue;
      if (!nearlyEqual(values[key], snapshotValues[key])) set.add(key);
    }
    return set;
  }, [values, snapshotValues, lastSubmittedWeek]);

  const derived = useMemo(() => computeRow(values, { week: 1 }), [values]);

  function setField(key: string, raw: string) {
    setValues((prev) => ({ ...prev, [key]: parseNumberInput(raw) }));
  }

  async function save(reasons?: Record<string, ReasonInput>) {
    setSaving(true);
    setMessage(null);

    const res = await fetch('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        periodId,
        branchId,
        source: 'grid' as const,
        rows: [],
        branchValues: values,
        reasons,
      }),
    });
    const data = await res.json();
    setSaving(false);

    if (res.status === 409 && data.error === 'reason_required') {
      setConflicts(data.conflicts as SaveConflict[]);
      return;
    }
    if (!res.ok) {
      setMessage({ tone: 'err', text: data.error ?? 'Gagal menyimpan.' });
      return;
    }

    setConflicts(null);
    setMessage({
      tone: 'ok',
      text:
        data.changed === 0
          ? 'Tidak ada perubahan untuk disimpan.'
          : `Tersimpan${data.withReason ? `, ${data.withReason} disertai alasan.` : '.'}`,
    });
    router.refresh();
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Data Tingkat Cabang</h3>
          <p className="mt-0.5 text-[11px] text-slate-500">Diisi sekali untuk seluruh cabang, bukan per salesman.</p>
        </div>
        <button
          onClick={() => save()}
          disabled={saving || readOnly || dirtyKeys.length === 0}
          className="shrink-0 rounded-lg bg-brand-600 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? 'Menyimpan…' : 'Simpan Data Cabang'}
        </button>
      </div>

      {message && (
        <p
          className={`mt-3 rounded-lg px-3 py-1.5 text-xs ${
            message.tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'
          }`}
        >
          {message.text}
        </p>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {BRANCH_INPUT_KEYS.map((key) => {
          const m = METRIC_BY_KEY[key];
          const locked = isFieldLocked(key, lastSubmittedWeek);
          const needsReason = needsReasonKeys.has(key);
          const raw = values[key];
          return (
            <label key={key} className="block">
              <span className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-slate-600">
                {m.label}
                {locked && (
                  <span
                    className="text-amber-600"
                    title={`Sudah dilaporkan pada Minggu ${lastSubmittedWeek}. Mengubahnya wajib disertai alasan.`}
                  >
                    🔒
                  </span>
                )}
              </span>
              <input
                inputMode="decimal"
                readOnly={readOnly}
                defaultValue={raw === null || raw === undefined ? '' : String(raw)}
                onBlur={(e) => setField(key, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
                className={`w-full rounded-lg border px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 ${
                  needsReason
                    ? 'border-amber-400 bg-amber-50'
                    : locked
                      ? 'border-amber-200 bg-amber-50/40'
                      : 'border-slate-300'
                }`}
              />
            </label>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-slate-100 pt-3 text-xs text-slate-600">
        <span>
          BALANCE PRTM (OL - PLAN PRTM):{' '}
          <strong className="tabular-nums text-slate-900">{fmtNumber(derived.balance_prtm)}</strong>
        </span>
        <span>
          RATIO ACTUAL / PLAN:{' '}
          <strong className="tabular-nums text-slate-900">{fmtPercent(derived.ratio_actual)}</strong>
        </span>
      </div>

      {needsReasonKeys.size > 0 && (
        <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <strong>{needsReasonKeys.size} angka</strong> menyimpang dari yang sudah dilaporkan pada
          Minggu {lastSubmittedWeek}. Saat disimpan, Anda akan diminta mengisi alasan perubahan.
        </p>
      )}

      {conflicts && (
        <ReasonModal
          conflicts={conflicts}
          lastSubmittedWeek={lastSubmittedWeek}
          onCancel={() => setConflicts(null)}
          onSubmit={(reasons) => save(reasons)}
          busy={saving}
        />
      )}
    </section>
  );
}
