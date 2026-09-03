'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  orderedMetrics,
  aggregateRows,
  BRANCH_INPUT_KEYS,
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
   *  cabang. Sejak v2.11 ditampilkan sebagai KOLOM di grid salesman yang
   *  sama (baris cabang tersendiri di baris pertama, persis posisi baris
   *  cabang di file Excel asli) — bukan tabel/panel terpisah lagi. Tetap
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

  /* Sejak permintaan user (2 September 2026): begitu "Simpan" berhasil,
   * grid ini langsung tampil BERSIH/kosong lagi — bukan terus menampilkan
   * angka yang baru saja tersimpan. Angka yang sudah tersimpan tetap bisa
   * dilihat di Rekap Nasional; grid ini sengaja diperlakukan seperti
   * "form" yang mengosong setelah dikirim, bukan lembar kerja yang selalu
   * menampilkan isi database.
   *
   * PENTING soal keamanan data — jangan hapus `values`/`branchValues`
   * itu sendiri untuk mewujudkan tampilan kosong ini. Kalau state itu
   * sungguh-sungguh dikosongkan ({}), maka blur tanpa mengetik apa pun
   * (klik lalu pindah fokus, tab-through, dst.) akan membuat `setCell`
   * menyimpan `null` ke sel yang sebenarnya masih berisi data asli —
   * dan `null` itu AKAN terkirim ke server sebagai permintaan mengosongkan
   * angka yang sesungguhnya (lihat /api/entries — field yang benar-benar
   * absen dari payload tidak disentuh, tapi field yang eksplisit `null`
   * TETAP dianggap perubahan yang disengaja). Jadi `values`/`branchValues`
   * di sini tetap menyimpan angka SEBENARNYA seperti sebelumnya (dipakai
   * untuk dirtyCells/needsReasonCells/payload simpan) — yang berubah
   * cuma TAMPILANNYA lewat `justSaved` di bawah, dan `renderInputCell()`
   * sengaja dibuat mengabaikan blur yang tidak mengubah nilai tampilan,
   * supaya "kosong di layar" tidak pernah diam-diam menghapus data asli.
   * Begitu user benar-benar mengetik sesuatu, `justSaved` otomatis mati
   * lagi supaya sisa grid kembali menampilkan angka aslinya sebagai
   * konteks pengeditan. */
  const [justSaved, setJustSaved] = useState(false);

  /* Seluruh kolom W1–W4 selalu tampil, supaya cabang bebas mengisi ke
   * depan maupun memperbaiki ke belakang. Yang terkunci ditandai warna.
   * Sejak v2.11, kolom tingkat cabang (PLAN SALES MASTER, OL MIN PRTM,
   * ACTUAL SALES, dan turunannya BALANCE PRTM) IKUT di sini — tidak lagi
   * difilter berdasar `level`, persis seperti PREVIEW_COLUMNS di
   * UploadPanel.tsx — supaya posisinya otomatis benar di antara kolom
   * salesman lain (mengikuti huruf kolom Excel), bukan digabung sebagai
   * tabel ringkas terpisah lagi. Baris cabang & baris salesman lalu
   * membedakan kolom mana yang berlaku lewat `columnAppliesTo()`. */
  const columns = useMemo(() => orderedMetrics((m) => m.inGrid), []);

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

  /* BALANCE PRTM — turunan dari branchValues (bukan dari salesman mana
   * pun) — dipakai untuk mengisi kolom turunan di baris cabang pada grid
   * (lihat `columnAppliesTo()` di render). */
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
    // Grid tampil bersih lagi setelah simpan berhasil — lihat penjelasan
    // di deklarasi `justSaved` di atas. Hanya dipasang saat benar-benar
    // ada perubahan tersimpan; kalau "Tidak ada perubahan" (changed===0)
    // tidak perlu mengosongkan tampilan karena tidak ada yang berubah.
    if (data.changed > 0) setJustSaved(true);
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

  /** Satu sel input, dipakai baris cabang maupun baris salesman di grid
   *  yang sama — perilaku terkunci/berubah/wajib-alasan identik.
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

    /* Lihat komentar di deklarasi `justSaved` di atas: yang TAMPIL sengaja
     * dikosongkan setelah simpan berhasil, tanpa menyentuh `raw`/state
     * sebenarnya sama sekali. `<input>` di bawah ini uncontrolled
     * (`defaultValue`), jadi sekadar berubahnya nilai `raw` antar-render
     * TIDAK membuat teks di layar ikut berubah — makanya `key` diikutkan
     * supaya React me-remount elemennya (bukan cuma re-render) setiap kali
     * `justSaved` berubah, dan teks di layar benar-benar ikut ter-reset. */
    const displayRaw = justSaved ? null : raw;
    const displayText = displayRaw === null || displayRaw === undefined ? '' : String(displayRaw);

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
          key={justSaved ? 'blank' : 'filled'}
          className="cell-input"
          inputMode="decimal"
          readOnly={readOnly}
          defaultValue={displayText}
          onBlur={(e) => {
            /* Blur tanpa perubahan nyata (klik lalu pindah fokus,
             * tab-through, dst.) tidak boleh menulis apa pun — ini penting
             * terutama saat `justSaved`, karena tampilan sedang kosong
             * padahal nilai sebenarnya masih ada di state (lihat komentar
             * di atas). Tanpa penjagaan ini, blur "kosong" seperti itu bisa
             * menyimpan `null` menimpa angka asli saat tombol Simpan
             * berikutnya ditekan. */
            if (e.target.value === displayText) return;
            setCell(rowId, c.key, e.target.value);
            /* Ada pengeditan sungguhan — grid "bangun" lagi dan kembali
             * menampilkan angka aslinya di seluruh sel sebagai konteks,
             * sesuai desain yang sudah dijelaskan ke user. */
            if (justSaved) setJustSaved(false);
          }}
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

      {justSaved && (
        <p className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-2 text-xs text-slate-600">
          Grid dikosongkan sementara setelah tersimpan. Angka yang baru disimpan sudah bisa dilihat
          di <strong>Rekap Nasional</strong>; untuk melihat/mengedit lagi di sini, muat ulang
          halaman ini.
        </p>
      )}

      {needsReasonCells.size > 0 && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          <strong>{needsReasonCells.size} angka</strong> menyimpang dari yang sudah dilaporkan pada
          Minggu {lastSubmittedWeek}. Saat disimpan, Anda akan diminta mengisi alasan perubahan.
        </p>
      )}

      {/* Grid salesman — sejak v2.11 baris pertama adalah baris CABANG
          (PLAN SALES MASTER/OL MIN PRTM/ACTUAL SALES/BALANCE PRTM), persis
          posisi baris cabang di file Excel asli, bukan tabel terpisah lagi
          di atasnya. */}
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
            {/* Baris CABANG — persis posisi baris cabang di file Excel asli
                (baris 7): kolom level cabang (PLAN SALES MASTER dkk) yang
                editable/dihitung, kolom level salesman ditampilkan dash
                "—" karena memang tidak berlaku di baris ini. */}
            <tr className="bg-sky-50/50">
              <td className="sticky-col bg-sky-50 px-3 py-1.5 font-medium text-sky-900">
                {branchName} · data cabang
              </td>
              {columns.map((c) => {
                if (!columnAppliesTo(c, 'branch')) {
                  return (
                    <td key={c.key} className="cell-derived text-right text-slate-300">
                      —
                    </td>
                  );
                }
                if (c.kind === 'derived') {
                  const v = branchComputed[c.key];
                  return (
                    <td key={c.key} className="cell-derived">
                      {/* Ikut kosong sesaat setelah simpan, konsisten
                          dengan sel input di sebelahnya — lihat `justSaved`. */}
                      {justSaved ? '' : c.format === 'percent' ? fmtPercent(v) : fmtNumber(v)}
                    </td>
                  );
                }
                return renderInputCell('branch', c, branchValues[c.key], true);
              })}
            </tr>
            {salesmen.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50/60">
                <td className="sticky-col px-3 py-1.5 font-medium text-slate-800">{s.name}</td>
                {columns.map((c) => {
                  if (!columnAppliesTo(c, 'salesman')) {
                    return (
                      <td key={c.key} className="cell-derived text-right text-slate-300">
                        —
                      </td>
                    );
                  }
                  if (c.kind === 'derived') {
                    const v = computedRows[s.id]?.[c.key];
                    return (
                      <td key={c.key} className="cell-derived">
                        {justSaved ? '' : c.format === 'percent' ? fmtPercent(v) : fmtNumber(v)}
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
                  {justSaved
                    ? ''
                    : c.format === 'percent'
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

/** Kolom ini berlaku (punya nilai) di baris bertipe `kind`? Sama seperti
 *  `columnAppliesTo()` di UploadPanel.tsx (dua tempat ini sengaja dijaga
 *  sama persis — beda file karena beda tipe baris: `PreviewRow['kind']`
 *  punya varian 'total' juga, di sini cuma 'branch'/'salesman'): kolom
 *  level cabang (PLAN SALES MASTER dkk) cuma berlaku di baris cabang,
 *  kolom level salesman cuma berlaku di baris salesman — sisanya dash. */
function columnAppliesTo(col: Metric, kind: 'branch' | 'salesman'): boolean {
  const isBranchCol = col.level === 'branch';
  return kind === 'branch' ? isBranchCol : !isBranchCol;
}

function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block h-3 w-5 rounded ${className}`} />
      {label}
    </span>
  );
}
