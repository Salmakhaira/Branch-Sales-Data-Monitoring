'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { parseBranchTemplate, type ParseIssue, type TemplateRow } from '@/lib/excel';
import {
  BRANCH_INPUT_KEYS,
  INPUT_KEYS,
  SALESMAN_INPUT_KEYS,
  METRIC_BY_KEY,
  isFieldLocked,
  nearlyEqual,
  type ValueMap,
} from '@/lib/metrics';
import { fmtNumber, monthName } from '@/lib/format';
import ReasonModal, { type ReasonInput } from '@/components/ReasonModal';
import type { SaveConflict } from '@/lib/types';

interface Props {
  periodId: string;
  branchId: string;
  /** Kode & nama cabang dipakai untuk MENEMUKAN baris cabang di file MOS
   *  asli, sekaligus memastikan file yang diunggah memang milik cabang ini. */
  branchCode: string;
  branchName: string;
  year: number;
  month: number;
  /** Minggu yang sedang dilaporkan — ikut ke judul template. */
  reportingWeek: number;
  readOnly: boolean;
  lastSubmittedWeek: number | null;
  salesmen: { id: string; name: string }[];
  currentValues: Record<string, Record<string, number | null>>;
  snapshotValues: Record<string, Record<string, number | null>>;
  /** Data tingkat cabang yang tersimpan & snapshot-nya — pembanding untuk
   *  nilai PLAN SALES MASTER / OL MIN PRTM / ACTUAL SALES dari file. */
  branchCurrentValues: ValueMap;
  branchSnapshotValues: ValueMap;
}

interface DiffCell {
  /** 'branch' untuk baris data tingkat cabang. */
  salesmanId: string;
  salesmanName: string;
  fieldKey: string;
  fieldLabel: string;
  oldValue: number | null;
  newValue: number | null;
  requiresReason: boolean;
}

/** Satu baris pada tabel ringkasan — meniru bentuk grid: satu baris per
 *  salesman (plus satu baris data cabang), satu kolom per kolom yang berubah. */
interface SummaryRow {
  id: string;
  name: string;
  isBranch: boolean;
  /** Nilai hasil pembacaan file untuk baris ini — dipakai mengisi sel yang
   *  tidak berubah supaya tabel tetap terbaca sebagai data, bukan daftar. */
  values: ValueMap;
  cells: Record<string, DiffCell>;
  changed: number;
  needReason: number;
}

export default function UploadPanel({
  periodId,
  branchId,
  branchCode,
  branchName,
  year,
  month,
  reportingWeek,
  readOnly,
  lastSubmittedWeek,
  salesmen,
  currentValues,
  snapshotValues,
  branchCurrentValues,
  branchSnapshotValues,
}: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [parsed, setParsed] = useState<TemplateRow[] | null>(null);
  const [parsedBranch, setParsedBranch] = useState<ValueMap | null>(null);
  const [sourceInfo, setSourceInfo] = useState<{ format: string; sheetName: string } | null>(null);
  const [issues, setIssues] = useState<ParseIssue[]>([]);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [conflicts, setConflicts] = useState<SaveConflict[] | null>(null);
  const [view, setView] = useState<'table' | 'detail'>('table');
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  /* Template dibangun di server (/api/template) supaya formatnya lengkap
   * — header bermerge, warna per grup, format angka akunting. */
  const templateUrl = `/api/template?branch=${branchId}&period=${periodId}&week=${reportingWeek}`;

  /* --- Baca file --------------------------------------------------- */
  const [reading, setReading] = useState(false);

  async function handleFile(file: File) {
    setMessage(null);
    setFileName(file.name);
    setReading(true);
    try {
      const buf = await file.arrayBuffer();
      // File cabang bisa ~10 MB; beri jeda satu frame supaya indikator
      // "membaca" sempat tampil sebelum parsing memblokir thread UI.
      await new Promise((r) => setTimeout(r, 0));
      const result = parseBranchTemplate(buf, {
        salesmen,
        branchCode,
        branchName,
        year,
        month,
      });
      setParsed(result.rows);
      setParsedBranch(result.branchValues);
      setSourceInfo({ format: result.format, sheetName: result.sheetName });
      setIssues(result.issues);
    } finally {
      setReading(false);
    }
  }

  function reset() {
    setParsed(null);
    setParsedBranch(null);
    setSourceInfo(null);
    setIssues([]);
    setFileName('');
    if (fileRef.current) fileRef.current.value = '';
  }

  /* --- Hitung diff untuk preview ----------------------------------- */
  const diffs = useMemo<DiffCell[]>(() => {
    if (!parsed) return [];
    const out: DiffCell[] = [];

    /* Data tingkat cabang ikut terbaca dari baris cabang di file MOS,
     * jadi ikut ditampilkan sebagai perubahan — pakai kunci 'branch'
     * yang sama dengan panel Data Tingkat Cabang. */
    if (parsedBranch) {
      for (const key of BRANCH_INPUT_KEYS) {
        if (!(key in parsedBranch)) continue;
        const newVal = parsedBranch[key] ?? null;
        if (nearlyEqual(branchCurrentValues[key], newVal)) continue;
        const locked = isFieldLocked(key, lastSubmittedWeek);
        const deviates = lastSubmittedWeek
          ? !nearlyEqual(branchSnapshotValues[key], newVal)
          : false;
        out.push({
          salesmanId: 'branch',
          salesmanName: `${branchName} (data cabang)`,
          fieldKey: key,
          fieldLabel: METRIC_BY_KEY[key]?.label ?? key,
          oldValue: (branchCurrentValues[key] as number | null) ?? null,
          newValue: newVal as number | null,
          requiresReason: locked && deviates,
        });
      }
    }

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
  }, [
    parsed,
    parsedBranch,
    currentValues,
    snapshotValues,
    branchCurrentValues,
    branchSnapshotValues,
    branchName,
    lastSubmittedWeek,
  ]);

  /* --- Ringkasan berbentuk tabel ------------------------------------
   * Diff mentah bentuknya panjang ke bawah (satu baris per sel). Untuk
   * dilihat sebelum submit, bentuk itu diputar jadi matriks seperti grid:
   * baris = salesman, kolom = kolom yang berubah, sel = angka baru. */
  const summary = useMemo(() => {
    if (!parsed) return { columns: [] as string[], rows: [] as SummaryRow[] };

    const touched = new Set(diffs.map((d) => d.fieldKey));
    const columns = INPUT_KEYS.filter((k) => touched.has(k));

    const rowMap = new Map<string, SummaryRow>();
    const add = (id: string, name: string, isBranch: boolean, values: ValueMap) => {
      if (!rowMap.has(id))
        rowMap.set(id, { id, name, isBranch, values, cells: {}, changed: 0, needReason: 0 });
    };
    if (parsedBranch) add('branch', `${branchName} · data cabang`, true, parsedBranch);
    for (const row of parsed) add(row.salesmanId, row.salesmanName, false, row.values);

    for (const d of diffs) {
      const r = rowMap.get(d.salesmanId);
      if (!r) continue;
      r.cells[d.fieldKey] = d;
      r.changed += 1;
      if (d.requiresReason) r.needReason += 1;
    }

    return { columns, rows: [...rowMap.values()].filter((r) => r.changed > 0) };
  }, [parsed, parsedBranch, diffs, branchName]);

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
        ...(parsedBranch ? { branchValues: parsedBranch } : {}),
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
    reset();
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
      {/* Unggah file MOS apa adanya */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-slate-900">
          Unggah file MOS cabang Anda — apa adanya
        </h3>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-500">
          Pakai <strong>file Excel yang selama ini Anda isi</strong>. Tidak perlu menyalin
          datanya ke template baru: sistem membaca sheet{' '}
          <strong>{monthName(month)} {year}</strong>, mencari baris cabang{' '}
          <strong>{branchName} ({branchCode})</strong>, lalu membaca baris salesman di
          bawahnya berdasarkan huruf kolom aslinya (O, S, AE, AI, dan seterusnya).
          Angka PLAN SALES MASTER, OL MIN PRTM, dan ACTUAL SALES di baris cabang ikut terbaca.
        </p>
        <p className="mt-2 max-w-3xl text-xs leading-relaxed text-slate-500">
          File diperiksa dulu di layar ini — <strong>tidak ada data yang tersimpan</strong>{' '}
          sebelum Anda menekan tombol konfirmasi. Kolom hasil perhitungan (TOTAL OL PRTM,
          TOTAL PO, dan seterusnya) diabaikan karena dihitung ulang oleh sistem, jadi rumus
          rusak atau <code className="rounded bg-slate-100 px-1">#REF!</code> di file lama
          tidak ikut masuk.
        </p>
        <div className="mt-3">
          <a
            href={templateUrl}
            className="text-[11px] font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800"
          >
            Belum punya filenya? Unduh contoh berformat sama (.xlsx)
          </a>
        </div>

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
          <span className="text-2xl">{reading ? '⏳' : '📄'}</span>
          <span className="mt-2 text-xs font-medium text-slate-700">
            {reading ? 'Membaca file…' : fileName || 'Klik atau tarik file .xlsx ke sini'}
          </span>
          <span className="mt-0.5 text-[11px] text-slate-400">
            Satu file per unggahan. File besar (10 MB ke atas) perlu beberapa detik.
          </span>
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
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-900">Periksa hasil pembacaan</h3>
              {diffs.length > 0 && (
                <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5">
                  <ViewButton
                    active={view === 'table'}
                    onClick={() => setView('table')}
                    label="Tabel ringkasan"
                  />
                  <ViewButton
                    active={view === 'detail'}
                    onClick={() => setView('detail')}
                    label="Rincian per sel"
                  />
                </div>
              )}
            </div>
            {sourceInfo && (
              <p className="mt-1 text-[11px] text-slate-500">
                Dibaca dari sheet <strong>{sourceInfo.sheetName}</strong> ·{' '}
                {sourceInfo.format === 'mos'
                  ? 'format file MOS cabang'
                  : 'format template sistem'}
              </p>
            )}
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
          ) : view === 'table' ? (
            <>
              <SummaryTable summary={summary} />
              <p className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 px-5 py-2 text-[11px] text-slate-500">
                <span>
                  <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-sky-100 align-middle" />
                  angka berubah
                </span>
                <span>
                  <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-amber-100 align-middle" />
                  berubah &amp; perlu alasan
                </span>
                <span className="text-slate-400">
                  angka abu-abu = tidak berubah · titik (·) = kosong di file
                </span>
              </p>
            </>
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
                onClick={reset}
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

/* Tabel ringkasan: bentuknya sama dengan grid input — baris salesman ke
 * bawah, kolom ke samping — supaya sekali lihat ketahuan angka mana yang
 * berubah dan berapa totalnya, tanpa menggulung daftar panjang. */
function SummaryTable({
  summary,
}: {
  summary: { columns: string[]; rows: SummaryRow[] };
}) {
  const { columns, rows } = summary;

  return (
    <div className="max-h-[28rem] overflow-auto">
      <table className="min-w-full border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-30 border-b border-r border-slate-200 bg-slate-50 px-4 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Salesman
            </th>
            <th className="sticky top-0 z-20 border-b border-slate-200 bg-slate-50 px-3 py-2 text-center text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Berubah
            </th>
            {columns.map((k) => {
              const m = METRIC_BY_KEY[k];
              return (
                <th
                  key={k}
                  className="sticky top-0 z-20 whitespace-nowrap border-b border-slate-200 bg-slate-50 px-3 py-2 text-right align-bottom text-[11px] font-medium text-slate-600"
                >
                  <span className="block">{m?.label ?? k}</span>
                  {m?.excel && (
                    <span className="block text-[10px] font-normal text-slate-400">
                      kolom {m.excel}
                    </span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.isBranch ? 'bg-sky-50/50' : ''}>
              <th
                className={`sticky left-0 z-10 whitespace-nowrap border-b border-r border-slate-200 px-4 py-1.5 text-left font-medium ${
                  r.isBranch ? 'bg-sky-50 text-sky-900' : 'bg-white text-slate-700'
                }`}
              >
                {r.name}
                {r.needReason > 0 && (
                  <span className="ml-2 rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-medium text-amber-900">
                    {r.needReason} perlu alasan
                  </span>
                )}
              </th>
              <td className="border-b border-slate-100 px-3 py-1.5 text-center tabular-nums text-slate-500">
                {r.changed}
              </td>
              {columns.map((k) => {
                const d = r.cells[k];
                if (!d) {
                  const v = r.values[k];
                  return (
                    <td
                      key={k}
                      className="border-b border-slate-100 px-3 py-1.5 text-right tabular-nums text-slate-300"
                    >
                      {typeof v === 'number' ? fmtNumber(v) : '·'}
                    </td>
                  );
                }
                const delta = (d.newValue ?? 0) - (d.oldValue ?? 0);
                return (
                  <td
                    key={k}
                    title={`Sebelum ${fmtNumber(d.oldValue)} → sesudah ${fmtNumber(d.newValue)}`}
                    className={`border-b border-slate-100 px-3 py-1.5 text-right tabular-nums ${
                      d.requiresReason ? 'bg-amber-50' : 'bg-sky-50/60'
                    }`}
                  >
                    <span className="font-semibold text-slate-800">{fmtNumber(d.newValue)}</span>
                    <span
                      className={`block text-[10px] ${
                        delta >= 0 ? 'text-emerald-600' : 'text-rose-600'
                      }`}
                    >
                      {delta >= 0 ? '+' : ''}
                      {fmtNumber(delta)}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>

        <tfoot>
          <tr>
            <th className="sticky left-0 z-10 border-t-2 border-r border-slate-300 bg-slate-50 px-4 py-2 text-left font-semibold text-slate-800">
              TOTAL
            </th>
            <td className="border-t-2 border-slate-300 bg-slate-50 px-3 py-2 text-center tabular-nums font-semibold text-slate-700">
              {rows.reduce((s, r) => s + r.changed, 0)}
            </td>
            {columns.map((k) => {
              let total = 0;
              let delta = 0;
              for (const r of rows) {
                const d = r.cells[k];
                if (d) {
                  total += d.newValue ?? 0;
                  delta += (d.newValue ?? 0) - (d.oldValue ?? 0);
                } else {
                  const v = r.values[k];
                  if (typeof v === 'number') total += v;
                }
              }
              return (
                <td
                  key={k}
                  className="border-t-2 border-slate-300 bg-slate-50 px-3 py-2 text-right tabular-nums font-semibold text-slate-900"
                >
                  {fmtNumber(total)}
                  <span
                    className={`block text-[10px] font-normal ${
                      delta >= 0 ? 'text-emerald-600' : 'text-rose-600'
                    }`}
                  >
                    {delta >= 0 ? '+' : ''}
                    {fmtNumber(delta)}
                  </span>
                </td>
              );
            })}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function ViewButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-md px-3 py-1 text-[11px] font-medium transition ${
        active ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-50'
      }`}
    >
      {label}
    </button>
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
