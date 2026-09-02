'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  orderedMetrics,
  aggregateRows,
  BRANCH_INPUT_KEYS,
  METRIC_BY_KEY,
  SALESMAN_INPUT_KEYS,
  computeRow,
  isFieldLocked,
  nearlyEqual,
  type Metric,
  type ValueMap,
} from '@/lib/metrics';
import { fmtNumber, fmtPercent, parseNumberInput } from '@/lib/format';
import { buildMosHeaderRows, MOS_TOP_TONE, MOS_SUB_TONE } from '@/lib/mos-header';
import ReasonModal, { type ReasonInput } from '@/components/ReasonModal';
import type { SaveConflict } from '@/lib/types';

type Values = Record<string, Record<string, number | null>>; // salesmanId -> field -> value

interface Props {
  periodId: string;
  branchId: string;
  branchName: string;
  reportingWeek: number;
  alreadySubmitted: boolean;
  readOnly: boolean;
  lastSubmittedWeek: number | null;
  salesmen: { id: string; name: string }[];
  initialValues: Values;
  snapshotValues: Values;
  /** PLAN SALES MASTER/OL MIN PRTM/ACTUAL SALES — satu set nilai per
   *  cabang, ditampilkan sebagai tabel ringkas 3 baris (label + nilai) di
   *  atas grid salesman, bukan panel kartu terpisah lagi — tapi tetap
   *  disimpan bersamaan lewat satu tombol Simpan yang sama. */
  branchInitialValues: ValueMap;
  branchSnapshotValues: ValueMap;
}

export default function InputGrid({
  periodId,
  branchId,
  branchName,
  reportingWeek,
  alreadySubmitted,
  readOnly,
  lastSubmittedWeek,
  salesmen,
  initialValues,
  snapshotValues,
  branchInitialValues,
  branchSnapshotValues,
}: Props) {
  const router = useRouter();
  const [values, setValues] = useState<Values>(initialValues);
  const [branchValues, setBranchValues] = useState<ValueMap>(branchInitialValues);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [conflicts, setConflicts] = useState<SaveConflict[] | null>(null);

  /* Seluruh kolom W1–W4 selalu tampil, supaya cabang bebas mengisi ke
   * depan maupun memperbaiki ke belakang. Yang terkunci ditandai warna.
   * PLAN SALES MASTER/OL MIN PRTM/ACTUAL SALES (dan turunannya BALANCE
   * PRTM/RATIO ACTUAL) tidak ikut di sini — itu data TINGKAT CABANG,
   * ditampilkan di tabel ringkas terpisah di atas grid ini. */
  const columns = useMemo(
    () => orderedMetrics((m) => m.inGrid && (m.level ?? 'salesman') === 'salesman'),
    [],
  );

  /* Header BERTINGKAT TIGA, sama seperti sheet MOS di file Excel cabang:
   *   baris 1 = grup besar   (OUTLOOK PRTM / OUTLOOK REVENUE TM)
   *   baris 2 = judul kolom  (ACT PRTM by SO SAP W1, QUOT CONFIDENCE W1, POCO, …)
   *   baris 3 = rincian      (>80%, >50%-80%, <50%, NOT ACTIVE, PLAFOND, …)
   * Kolom tanpa rincian: judulnya memanjang ke bawah (rowSpan 2). */
  const headerRows = useMemo(() => buildMosHeaderRows(columns), [columns]);

  /* Sel yang belum disimpan — kunci 'branch:<key>' untuk 3 baris ringkas
   * cabang, '<salesmanId>:<key>' untuk baris salesman di grid, satu Set
   * gabungan supaya tombol Simpan & indikator jumlah sel mencakup
   * keduanya sekaligus (satu tombol Simpan untuk semuanya). */
  const dirtyCells = useMemo(() => {
    const set = new Set<string>();
    for (const s of salesmen) {
      const now = values[s.id] ?? {};
      const before = initialValues[s.id] ?? {};
      for (const key of SALESMAN_INPUT_KEYS) {
        if (!nearlyEqual(now[key], before[key])) set.add(`${s.id}:${key}`);
      }
    }
    for (const key of BRANCH_INPUT_KEYS) {
      if (!nearlyEqual(branchValues[key], branchInitialValues[key])) set.add(`branch:${key}`);
    }
    return set;
  }, [values, initialValues, salesmen, branchValues, branchInitialValues]);

  /** Sel yang perubahannya akan memicu permintaan alasan. */
  const needsReasonCells = useMemo(() => {
    const set = new Set<string>();
    if (!lastSubmittedWeek) return set;
    for (const s of salesmen) {
      const now = values[s.id] ?? {};
      const snap = snapshotValues[s.id] ?? {};
      for (const key of SALESMAN_INPUT_KEYS) {
        if (!isFieldLocked(key, lastSubmittedWeek)) continue;
        if (!nearlyEqual(now[key], snap[key])) set.add(`${s.id}:${key}`);
      }
    }
    for (const key of BRANCH_INPUT_KEYS) {
      if (!isFieldLocked(key, lastSubmittedWeek)) continue;
      if (!nearlyEqual(branchValues[key], branchSnapshotValues[key])) set.add(`branch:${key}`);
    }
    return set;
  }, [values, snapshotValues, salesmen, lastSubmittedWeek, branchValues, branchSnapshotValues]);

  /* Kolom turunan dihitung memakai minggu yang SEDANG DILAPORKAN,
   * bukan minggu kalender — sehingga TOTAL OL PRTM dsb. mengambil kolom
   * W yang benar saat cabang menyusul laporan minggu sebelumnya. */
  const computedRows = useMemo(() => {
    const out: Record<string, ValueMap> = {};
    for (const s of salesmen) {
      out[s.id] = computeRow(values[s.id] ?? {}, {
        week: reportingWeek,
      });
    }
    return out;
  }, [values, salesmen, reportingWeek]);

  /* BALANCE PRTM & RATIO ACTUAL/PLAN — turunan dari branchValues (bukan
   * dari salesman mana pun), ditampilkan sebagai info kecil di bawah
   * tabel ringkas cabang. */
  const branchComputed = useMemo(
    () => computeRow(branchValues, { week: reportingWeek }),
    [branchValues, reportingWeek],
  );

  const branchTotal = useMemo<ValueMap>(
    () =>
      aggregateRows(
        [...salesmen.map((s) => values[s.id] ?? {}), branchValues],
        { week: reportingWeek },
      ),
    [values, salesmen, branchValues, reportingWeek],
  );

  function setCell(rowId: string, key: string, raw: string) {
    const parsed = parseNumberInput(raw);
    if (rowId === 'branch') {
      setBranchValues((prev) => ({ ...prev, [key]: parsed }));
    } else {
      setValues((prev) => ({
        ...prev,
        [rowId]: { ...(prev[rowId] ?? {}), [key]: parsed },
      }));
    }
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
        rows: salesmen.map((s) => ({ salesmanId: s.id, values: values[s.id] ?? {} })),
        branchValues,
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
          : `Tersimpan. ${data.revisions} perubahan tercatat` +
            (data.withReason ? `, ${data.withReason} di antaranya disertai alasan.` : '.'),
    });
    router.refresh();
  }

  async function submitWeek() {
    if (
      !confirm(
        `Submit report ${branchName} untuk Minggu ${reportingWeek}?\n\n` +
          'Setelah submit, angka yang sudah dilaporkan akan terkunci. ' +
          'Perubahan masih bisa dilakukan, tapi wajib disertai alasan yang akan ' +
          'dilihat oleh PIC Head Office.',
      )
    )
      return;

    setSaving(true);
    const res = await fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ periodId, branchId, week: reportingWeek }),
    });
    const data = await res.json();
    setSaving(false);

    setMessage(
      res.ok
        ? { tone: 'ok', text: `Report Minggu ${data.week} berhasil di-submit dan dikunci.` }
        : { tone: 'err', text: data.error ?? 'Gagal submit.' },
    );
    if (res.ok) router.refresh();
  }

  /** Satu sel input, dipakai baris cabang (tabel ringkas) maupun baris
   *  salesman (grid) — perilaku terkunci/berubah/wajib-alasan identik.
   *
   *  `requiredEmpty` = true bila kolom ini wajib diisi untuk konteks
   *  saat ini (3 field cabang: selalu; kolom salesman: hanya kolom
   *  minggu yang sedang dilaporkan) DAN belum ada isinya — sel ditandai
   *  kuning, warna yang sama dengan 🟨 di halaman Ringkasan, supaya user
   *  langsung tahu mana yang masih harus diisi. */
  function renderInputCell(
    rowId: string,
    c: Metric,
    raw: number | null | undefined,
    requiredEmpty = false,
  ) {
    const cellKey = `${rowId}:${c.key}`;
    const locked = isFieldLocked(c.key, lastSubmittedWeek);
    const dirty = dirtyCells.has(cellKey);
    const needsReason = needsReasonCells.has(cellKey);
    const empty = raw === null || raw === undefined;
    const highlightRequired = requiredEmpty && empty && !dirty && !needsReason;

    return (
      <td
        key={c.key}
        className={`p-0 ${
          dirty || needsReason
            ? 'cell-changed'
            : highlightRequired
              ? 'cell-required'
              : locked
                ? 'cell-locked'
                : ''
        }`}
        title={
          highlightRequired
            ? 'Wajib diisi.'
            : locked
              ? `Angka ini sudah dilaporkan pada Minggu ${lastSubmittedWeek}. Mengubahnya memerlukan alasan.`
              : undefined
        }
      >
        <input
          className="cell-input"
          inputMode="decimal"
          readOnly={readOnly}
          defaultValue={raw === null || raw === undefined ? '' : String(raw)}
          onBlur={(e) => setCell(rowId, c.key, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      </td>
    );
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-600">
          <LegendSwatch className="bg-white ring-1 ring-slate-200" label="Bisa diisi" />
          <LegendSwatch className="cell-required" label="Wajib diisi, belum diisi" />
          <LegendSwatch
            className="cell-locked ring-1 ring-amber-200"
            label="Terkunci — ubah = wajib alasan"
          />
          <LegendSwatch className="cell-changed" label="Diubah, belum disimpan" />
          <LegendSwatch className="bg-slate-100" label="Dihitung otomatis" />
        </div>

        <div className="flex items-center gap-2">
          {dirtyCells.size > 0 && (
            <span className="text-[11px] font-medium text-amber-700">
              {dirtyCells.size} sel belum disimpan
            </span>
          )}
          <button
            onClick={() => save()}
            disabled={saving || readOnly || dirtyCells.size === 0}
            className="rounded-lg bg-brand-600 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? 'Menyimpan…' : 'Simpan'}
          </button>
          <button
            onClick={submitWeek}
            disabled={saving || readOnly || alreadySubmitted || dirtyCells.size > 0}
            title={
              alreadySubmitted
                ? `Minggu ${reportingWeek} sudah di-submit`
                : dirtyCells.size > 0
                  ? 'Simpan dulu perubahan sebelum submit'
                  : ''
            }
            className="rounded-lg border border-emerald-600 px-4 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-50"
          >
            {alreadySubmitted
              ? `Minggu ${reportingWeek} sudah di-submit`
              : `Submit Minggu ${reportingWeek}`}
          </button>
        </div>
      </div>

      {message && (
        <p
          className={`rounded-lg px-4 py-2 text-xs ${
            message.tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'
          }`}
        >
          {message.text}
        </p>
      )}

      {needsReasonCells.size > 0 && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          <strong>{needsReasonCells.size} angka</strong> menyimpang dari yang sudah dilaporkan pada
          Minggu {lastSubmittedWeek}. Saat disimpan, Anda akan diminta mengisi alasan perubahan.
        </p>
      )}

      {/* Tabel ringkas DATA TINGKAT CABANG — 3 baris (label + nilai),
          bukan bagian dari grid salesman yang lebar, karena tiga angka ini
          cuma diisi SEKALI untuk seluruh cabang, bebas kapan saja dalam
          bulan berjalan. Tetap disimpan lewat tombol "Simpan" yang sama
          di toolbar atas (satu kali klik, satu jejak audit gabungan). */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Data Tingkat Cabang</h3>
        <p className="mt-0.5 text-[11px] text-slate-500">
          Diisi sekali per bulan untuk seluruh cabang, bebas kapan saja — bukan per salesman.
          🟨 Kuning = belum diisi.
        </p>
        <table className="mt-3 w-full max-w-xs text-xs">
          <tbody>
            {BRANCH_INPUT_KEYS.map((key) => {
              const c = METRIC_BY_KEY[key];
              return (
                <tr key={key} className="border-b border-slate-100 last:border-0">
                  <td className="py-1.5 pr-3 font-medium text-slate-600">{c.label}</td>
                  {renderInputCell('branch', c, branchValues[key], true)}
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-600">
          <span>
            BALANCE PRTM (OL - PLAN PRTM):{' '}
            <strong className="tabular-nums text-slate-900">
              {fmtNumber(branchComputed.balance_prtm)}
            </strong>
          </span>
        </div>
      </div>

      {/* Grid salesman */}
      <div className="scroll-x rounded-xl border border-slate-200 bg-white">
        <table className="grid-table w-full text-xs">
          <thead>
            {/* Tingkat 1 — grup besar */}
            <tr>
              <th className="sticky-col px-3 py-2 text-left" rowSpan={3} style={{ minWidth: 220 }}>
                SALESMAN
              </th>
              {headerRows.tops.map((g, i) => (
                <th
                  key={`${g.label}-${i}`}
                  colSpan={g.span}
                  className={`px-3 py-1.5 text-left ${MOS_TOP_TONE[g.label] ?? '!bg-slate-100'}`}
                >
                  {/* Grup di-merge sangat lebar; label dibuat menempel di
                      kiri area gulir supaya tetap terbaca saat digulir. */}
                  <span className="sticky left-[232px] inline-block">{g.label}</span>
                </th>
              ))}
            </tr>
            {/* Tingkat 2 — judul kolom */}
            <tr>
              {headerRows.subs.map((sh, i) => (
                <th
                  key={`${sh.top}-${sh.label}-${i}`}
                  colSpan={sh.span}
                  rowSpan={sh.hasTier ? 1 : 2}
                  className={`px-2 py-1.5 text-center font-normal ${
                    MOS_SUB_TONE[sh.top] ?? '!bg-slate-50'
                  }`}
                  style={{ minWidth: sh.span === 1 ? 96 : undefined }}
                >
                  {sh.label}
                </th>
              ))}
            </tr>
            {/* Tingkat 3 — rincian; hanya kolom yang punya tier */}
            <tr>
              {columns.map((c) => {
                const tier = (c.mos ?? {}).tier;
                if (!tier) return null;
                return (
                  <th
                    key={c.key}
                    title={`${c.label}${c.excel ? ` (kolom Excel ${c.excel})` : ''}${c.hint ? `\n${c.hint}` : ''}`}
                    className={`px-2 py-1.5 text-center font-normal ${
                      MOS_SUB_TONE[(c.mos ?? { top: c.group }).top] ?? '!bg-slate-50'
                    } ${c.week === reportingWeek ? 'ring-1 ring-inset ring-brand-400' : ''}`}
                    style={{ minWidth: 96 }}
                  >
                    {tier}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {salesmen.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50/60">
                <td className="sticky-col px-3 py-1.5 font-medium text-slate-800">{s.name}</td>
                {columns.map((c) => {
                  if (c.kind === 'derived') {
                    const v = computedRows[s.id]?.[c.key];
                    return (
                      <td key={c.key} className="cell-derived">
                        {c.format === 'percent' ? fmtPercent(v) : fmtNumber(v)}
                      </td>
                    );
                  }
                  return renderInputCell(
                    s.id,
                    c,
                    values[s.id]?.[c.key],
                    c.scope === 'weekly' && c.week === reportingWeek,
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-slate-100 font-semibold">
              <td className="sticky-col bg-slate-100 px-3 py-2 text-slate-900">
                TOTAL {branchName}
              </td>
              {columns.map((c) => (
                <td key={c.key} className="px-2 py-2 text-right tabular-nums text-slate-800">
                  {c.format === 'percent'
                    ? fmtPercent(branchTotal[c.key])
                    : fmtNumber(branchTotal[c.key])}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      {conflicts && (
        <ReasonModal
          conflicts={conflicts}
          lastSubmittedWeek={lastSubmittedWeek}
          onCancel={() => setConflicts(null)}
          onSubmit={(reasons) => save(reasons)}
          busy={saving}
        />
      )}
    </div>
  );
}

function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block h-3 w-5 rounded ${className}`} />
      {label}
    </span>
  );
}
