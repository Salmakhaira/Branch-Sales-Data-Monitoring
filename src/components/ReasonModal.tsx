'use client';

import { useState } from 'react';
import { MIN_REASON_LENGTH, REASON_CATEGORIES } from '@/lib/metrics';
import { fmtNumber } from '@/lib/format';
import type { SaveConflict } from '@/lib/types';

export interface ReasonInput {
  category: string;
  reason: string;
}

/* =====================================================================
 *  Modal wajib-isi-alasan.
 *
 *  Muncul ketika user mengubah angka yang sudah dilaporkan minggu
 *  sebelumnya. Isian di sini yang nantinya dibaca PIC Head Office di
 *  menu "Monitoring Perubahan".
 * =================================================================== */

export default function ReasonModal({
  conflicts,
  lastSubmittedWeek,
  onCancel,
  onSubmit,
  busy,
}: {
  conflicts: SaveConflict[];
  lastSubmittedWeek: number | null;
  onCancel: () => void;
  onSubmit: (reasons: Record<string, ReasonInput>) => void;
  busy?: boolean;
}) {
  const [reasons, setReasons] = useState<Record<string, ReasonInput>>({});
  const [applyToAll, setApplyToAll] = useState(false);
  const [bulk, setBulk] = useState<ReasonInput>({ category: '', reason: '' });

  const keyOf = (c: SaveConflict) => `${c.salesmanId}:${c.fieldKey}`;

  function effective(c: SaveConflict): ReasonInput {
    if (applyToAll) return bulk;
    return reasons[keyOf(c)] ?? { category: '', reason: '' };
  }

  const allValid = conflicts.every((c) => {
    const r = effective(c);
    return r.category && r.reason.trim().length >= MIN_REASON_LENGTH;
  });

  function handleSubmit() {
    const out: Record<string, ReasonInput> = {};
    for (const c of conflicts) {
      const r = effective(c);
      out[keyOf(c)] = { category: r.category, reason: r.reason.trim() };
    }
    onSubmit(out);
  }

  // Kelompokkan per salesman supaya mudah dibaca
  const grouped = conflicts.reduce<Record<string, SaveConflict[]>>((acc, c) => {
    (acc[c.salesmanName] ??= []).push(c);
    return acc;
  }, {});

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="border-b border-slate-200 px-6 py-4">
          <h3 className="text-sm font-semibold text-slate-900">Alasan Perubahan Data</h3>
          <p className="mt-1 text-xs text-slate-500">
            {conflicts.length} angka yang sudah dilaporkan
            {lastSubmittedWeek ? ` pada Minggu ${lastSubmittedWeek}` : ''} akan berubah. Setiap
            perubahan wajib disertai alasan — catatan ini akan muncul di panel monitoring PIC Head
            Office.
          </p>
        </div>

        <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-6 py-2.5">
          <input
            id="applyAll"
            type="checkbox"
            checked={applyToAll}
            onChange={(e) => setApplyToAll(e.target.checked)}
            className="rounded border-slate-300"
          />
          <label htmlFor="applyAll" className="text-xs text-slate-700">
            Gunakan satu alasan yang sama untuk semua perubahan
          </label>
        </div>

        {applyToAll && (
          <div className="space-y-2 border-b border-slate-200 px-6 py-4">
            <ReasonFields value={bulk} onChange={setBulk} />
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {Object.entries(grouped).map(([salesman, items]) => (
            <div key={salesman} className="mb-5 last:mb-0">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {salesman}
              </p>
              <div className="space-y-3">
                {items.map((c) => {
                  const k = keyOf(c);
                  const delta = (c.newValue ?? 0) - (c.oldValue ?? 0);
                  return (
                    <div key={k} className="rounded-lg border border-slate-200 p-3">
                      <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
                        <span className="font-medium text-slate-800">{c.fieldLabel}</span>
                        <span className="tabular-nums text-slate-500">
                          {fmtNumber(c.oldValue)} → <strong>{fmtNumber(c.newValue)}</strong>
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums ${
                            delta >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                          }`}
                        >
                          {delta >= 0 ? '+' : ''}
                          {fmtNumber(delta)}
                        </span>
                      </div>
                      {!applyToAll && (
                        <ReasonFields
                          value={reasons[k] ?? { category: '', reason: '' }}
                          onChange={(v) => setReasons((prev) => ({ ...prev, [k]: v }))}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-6 py-3">
          <p className="text-[11px] text-slate-400">
            Minimal {MIN_REASON_LENGTH} karakter per keterangan.
          </p>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              disabled={busy}
              className="rounded-lg border border-slate-300 px-4 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
            >
              Batal
            </button>
            <button
              onClick={handleSubmit}
              disabled={!allValid || busy}
              className="rounded-lg bg-brand-600 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
            >
              {busy ? 'Menyimpan…' : 'Simpan dengan Alasan'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReasonFields({
  value,
  onChange,
}: {
  value: ReasonInput;
  onChange: (v: ReasonInput) => void;
}) {
  const tooShort = value.reason.length > 0 && value.reason.trim().length < MIN_REASON_LENGTH;

  return (
    <div className="grid gap-2 sm:grid-cols-[200px_1fr]">
      <select
        value={value.category}
        onChange={(e) => onChange({ ...value, category: e.target.value })}
        className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-brand-500"
      >
        <option value="">— Pilih kategori —</option>
        {REASON_CATEGORIES.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
      <div>
        <textarea
          rows={2}
          value={value.reason}
          onChange={(e) => onChange({ ...value, reason: e.target.value })}
          placeholder="Contoh: SO 4500123 terbit tanggal 12/08, sebelumnya masih berstatus quotation."
          className={`w-full resize-none rounded-lg border px-2 py-1.5 text-xs outline-none focus:border-brand-500 ${
            tooShort ? 'border-rose-300' : 'border-slate-300'
          }`}
        />
        {tooShort && (
          <p className="mt-0.5 text-[10px] text-rose-600">
            Keterangan terlalu singkat (min. {MIN_REASON_LENGTH} karakter).
          </p>
        )}
      </div>
    </div>
  );
}
