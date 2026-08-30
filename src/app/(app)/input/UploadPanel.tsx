'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { parseBranchTemplate, type ParseIssue, type TemplateRow } from '@/lib/excel';
import { SALESMAN_INPUT_KEYS, METRIC_BY_KEY, isFieldLocked, nearlyEqual } from '@/lib/metrics';
import { fmtNumber } from '@/lib/format';
import ReasonModal, { type ReasonInput } from '@/components/ReasonModal';
import type { SaveConflict } from '@/lib/types';

interface Props {
  periodId: string;
  branchId: string;
  /** Minggu yang sedang dilaporkan — ikut ke judul template. */
  reportingWeek: number;
  readOnly: boolean;
  lastSubmittedWeek: number | null;
  salesmen: { id: string; name: string }[];
  currentValues: Record<string, Record<string, number | null>>;
  snapshotValues: Record<string, Record<string, number | null>>;
}

interface DiffCell {
  salesmanId: string;
  salesmanName: string;
  fieldKey: string;
  fieldLabel: string;
  oldValue: number | null;
  newValue: number | null;
  requiresReason: boolean;
}

export default function UploadPanel({
  periodId,
  branchId,
  reportingWeek,
  readOnly,
  lastSubmittedWeek,
  salesmen,
  currentValues,
  snapshotValues,
}: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [parsed, setParsed] = useState<TemplateRow[] | null>(null);
  const [issues, setIssues] = useState<ParseIssue[]>([]);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [conflicts, setConflicts] = useState<SaveConflict[] | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  /* Template dibangun di server (/api/template) supaya formatnya lengkap
   * — header bermerge, warna per grup, format angka akunting. */
  const templateUrl = `/api/template?branch=${branchId}&period=${periodId}&week=${reportingWeek}`;

  /* --- Baca file --------------------------------------------------- */
  async function handleFile(file: File) {
    setMessage(null);
    setFileName(file.name);
    const buf = await file.arrayBuffer();
    const result = parseBranchTemplate(buf, salesmen);
    setParsed(result.rows);
    setIssues(result.issues);
  }

  /* --- Hitung diff untuk preview ----------------------------------- */
  const diffs = useMemo<DiffCell[]>(() => {
    if (!parsed) return [];
    const out: DiffCell[] = [];
    for (const row of parsed) {
      const before = currentValues[row.salesmanId] ?? {};
      const snap = snapshotValues[row.salesmanId] ?? {};
      for (const key of SALESMAN_INPUT_KEYS) {
        if (!(key in row.values)) continue;
        const newVal = row.values[key] ?? null;
        if (nearlyEqual(before[key], newVal)) continue;

        const locked = isFieldLocked(key, lastSubmittedWeek);
        const deviates = lastSubmittedWeek ? !nearlyEqual(snap[key], newVal) : false;

        out.push({
          salesmanId: row.salesmanId,
          salesmanName: row.salesmanName,
          fieldKey: key,
          fieldLabel: METRIC_BY_KEY[key]?.label ?? key,
          oldValue: (before[key] as number | null) ?? null,
          newValue: newVal as number | null,
          requiresReason: locked && deviates,
        });
      }
    }
    return out;
  }, [parsed, currentValues, snapshotValues, lastSubmittedWeek]);

  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');
  const needReason = diffs.filter((d) => d.requiresReason);

  /* --- Commit ------------------------------------------------------ */
  async function commit(reasons?: Record<string, ReasonInput>) {
    if (!parsed) return;
    setBusy(true);
    setMessage(null);

    const res = await fetch('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        periodId,
        branchId,
        source: 'excel_upload',
        rows: parsed.map((r) => ({ salesmanId: r.salesmanId, values: r.values })),
        reasons,
      }),
    });
    const data = await res.json();
    setBusy(false);

    if (res.status === 409 && data.error === 'reason_required') {
      setConflicts(data.conflicts as SaveConflict[]);
      return;
    }
    if (!res.ok) {
      setMessage({ tone: 'err', text: data.error ?? 'Gagal menyimpan.' });
      return;
    }

    setConflicts(null);
    setParsed(null);
    setIssues([]);
    setFileName('');
    if (fileRef.current) fileRef.current.value = '';
    setMessage({
      tone: 'ok',
      text: `Berhasil. ${data.revisions} perubahan tercatat${
        data.withReason ? `, ${data.withReason} disertai alasan.` : '.'
      }`,
    });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {/* Langkah 1 */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Langkah 1 — Unduh template terisi
            </h3>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-slate-500">
              Template sudah berisi data terakhir cabang Anda, jadi Anda cukup memperbarui
              angka yang berubah. Kolom hasil perhitungan sengaja tidak disertakan — sistem yang
              menghitungnya, sehingga rumus tidak bisa rusak atau menjadi #REF!.
            </p>
          </div>
          <a
            href={templateUrl}
            className="shrink-0 rounded-lg border border-brand-600 px-4 py-2 text-xs font-medium text-brand-700 transition hover:bg-brand-50"
          >
            ⬇ Unduh Template .xlsx
          </a>
        </div>
      </section>

      {/* Langkah 2 */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-slate-900">Langkah 2 — Upload file terisi</h3>
        <p className="mt-1 text-xs text-slate-500">
          File diperiksa dulu di layar ini. Tidak ada data yang tersimpan sebelum Anda menekan
          tombol konfirmasi.
        </p>

        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) handleFile(f);
          }}
          className="mt-3 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-center transition hover:border-brand-400 hover:bg-brand-50/40"
        >
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          <span className="text-2xl">📄</span>
          <span className="mt-2 text-xs font-medium text-slate-700">
            {fileName || 'Klik atau tarik file .xlsx ke sini'}
          </span>
          <span className="mt-0.5 text-[11px] text-slate-400">Maksimal 1 file per unggahan</span>
        </label>
      </section>

      {message && (
        <p
          className={`rounded-lg px-4 py-2 text-xs ${
            message.tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'
          }`}
        >
          {message.text}
        </p>
      )}

      {/* Langkah 3 — preview */}
      {parsed && (
        <section className="rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-4">
            <h3 className="text-sm font-semibold text-slate-900">
              Langkah 3 — Periksa hasil pembacaan
            </h3>
            <div className="mt-2 flex flex-wrap gap-4 text-xs">
              <Chip tone="neutral" label={`${parsed.length} baris salesman terbaca`} />
              <Chip tone={diffs.length ? 'info' : 'neutral'} label={`${diffs.length} sel berubah`} />
              <Chip
                tone={needReason.length ? 'warn' : 'neutral'}
                label={`${needReason.length} perlu alasan`}
              />
              <Chip tone={errors.length ? 'err' : 'neutral'} label={`${errors.length} error`} />
              <Chip tone={warnings.length ? 'warn' : 'neutral'} label={`${warnings.length} peringatan`} />
            </div>
          </div>

          {(errors.length > 0 || warnings.length > 0) && (
            <ul className="space-y-1 border-b border-slate-200 px-5 py-3 text-xs">
              {errors.map((i, idx) => (
                <li key={`e${idx}`} className="text-rose-700">
                  ✕ {i.row ? `Baris ${i.row}: ` : ''}
                  {i.message}
                </li>
              ))}
              {warnings.map((i, idx) => (
                <li key={`w${idx}`} className="text-amber-700">
                  ⚠ {i.message}
                </li>
              ))}
            </ul>
          )}

          {diffs.length === 0 ? (
            <p className="px-5 py-6 text-center text-xs text-slate-500">
              Tidak ada perbedaan dengan data yang tersimpan.
            </p>
          ) : (
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50">
                  <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-2 font-medium">Salesman</th>
                    <th className="px-3 py-2 font-medium">Kolom</th>
                    <th className="px-3 py-2 text-right font-medium">Sebelum</th>
                    <th className="px-3 py-2 text-right font-medium">Sesudah</th>
                    <th className="px-3 py-2 text-right font-medium">Selisih</th>
                    <th className="px-5 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {diffs.map((d, i) => {
                    const delta = (d.newValue ?? 0) - (d.oldValue ?? 0);
                    return (
                      <tr
                        key={i}
                        className={`border-t border-slate-100 ${d.requiresReason ? 'bg-amber-50/60' : ''}`}
                      >
                        <td className="px-5 py-1.5 text-slate-700">{d.salesmanName}</td>
                        <td className="px-3 py-1.5 text-slate-600">{d.fieldLabel}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">
                          {fmtNumber(d.oldValue)}
                        </td>
                        <td className="px-3 py-1.5 text-right font-medium tabular-nums text-slate-800">
                          {fmtNumber(d.newValue)}
                        </td>
                        <td
                          className={`px-3 py-1.5 text-right tabular-nums ${
                            delta >= 0 ? 'text-emerald-600' : 'text-rose-600'
                          }`}
                        >
                          {delta >= 0 ? '+' : ''}
                          {fmtNumber(delta)}
                        </td>
                        <td className="px-5 py-1.5">
                          {d.requiresReason ? (
                            <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-medium text-amber-900">
                              Perlu alasan
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-400">Input baru</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-5 py-3">
            <p className="text-[11px] text-slate-400">
              {errors.length > 0
                ? 'Perbaiki error di file lalu unggah ulang, atau lanjutkan — baris bermasalah akan dilewati.'
                : 'Semua baris terbaca dengan baik.'}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setParsed(null);
                  setIssues([]);
                  setFileName('');
                  if (fileRef.current) fileRef.current.value = '';
                }}
                className="rounded-lg border border-slate-300 px-4 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
              >
                Batal
              </button>
              <button
                onClick={() => commit()}
                disabled={busy || readOnly || diffs.length === 0}
                className="rounded-lg bg-brand-600 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
              >
                {busy ? 'Menyimpan…' : `Konfirmasi & Simpan (${diffs.length} perubahan)`}
              </button>
            </div>
          </div>
        </section>
      )}

      {conflicts && (
        <ReasonModal
          conflicts={conflicts}
          lastSubmittedWeek={lastSubmittedWeek}
          onCancel={() => setConflicts(null)}
          onSubmit={(reasons) => commit(reasons)}
          busy={busy}
        />
      )}
    </div>
  );
}

function Chip({ tone, label }: { tone: 'neutral' | 'info' | 'warn' | 'err'; label: string }) {
  const cls = {
    neutral: 'bg-slate-100 text-slate-600',
    info: 'bg-sky-100 text-sky-700',
    warn: 'bg-amber-100 text-amber-800',
    err: 'bg-rose-100 text-rose-700',
  }[tone];
  return <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${cls}`}>{label}</span>;
}
