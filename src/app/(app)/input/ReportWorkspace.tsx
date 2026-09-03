'use client';

import { useState } from 'react';
import InputGrid from './InputGrid';
import UploadPanel from './UploadPanel';
import type { ValueMap } from '@/lib/metrics';

type Mode = 'grid' | 'upload';

interface Props {
  periodId: string;
  branchId: string;
  branchCode: string;
  branchName: string;
  year: number;
  month: number;
  /** Minggu yang sedang dilaporkan — dipilih user, default ikut kalender. */
  reportingWeek: number;
  alreadySubmitted: boolean;
  readOnly: boolean;
  lastSubmittedWeek: number | null;
  salesmen: { id: string; name: string }[];
  initialValues: Record<string, Record<string, number | null>>;
  /** Snapshot terakhir — pembanding untuk aturan wajib alasan. */
  snapshotValues: Record<string, Record<string, number | null>>;
  /** Snapshot minggu sebelum reportingWeek — sumber "OL Revenue last week". */
  /** PLAN SALES MASTER/OL MIN PRTM/ACTUAL SALES — satu set nilai per cabang. */
  branchInitialValues: ValueMap;
  branchSnapshotValues: ValueMap;
}

/* Satu halaman, dua cara mengisi. Keduanya memakai periode, minggu, dan
 * snapshot yang sama, dan menyimpan lewat API yang sama — jadi aturan
 * "wajib alasan" berlaku identik apa pun cara pengisiannya. */

export default function ReportWorkspace(props: Props) {
  const [mode, setMode] = useState<Mode>('grid');

  /* Ditemukan saat menyisir alur (3 September 2026): InputGrid & UploadPanel
   * menyimpan draf yang sedang diketik di STATE React lokal (`values`,
   * `branchValues` di InputGrid; `parsed`, dst. di UploadPanel), diisi
   * SEKALI dari `initialValues` saat komponennya mount. BranchPicker /
   * MonthYearPicker / WeekPicker berpindah halaman lewat `router.push()`
   * (navigasi sisi klien) — di Next.js App Router, ini membuat Server
   * Component (`page.tsx`) mengambil data baru dan mengirim props baru ke
   * bawah, TAPI Client Component yang sudah ter-mount (`InputGrid`/
   * `UploadPanel`) TIDAK ikut di-mount ulang hanya karena propnya berubah —
   * state lokalnya bertahan apa adanya kecuali diberi `key` yang berubah.
   *
   * Akibatnya, tanpa `key` di bawah ini: berpindah CABANG atau
   * BULAN/TAHUN lewat pemilih di atas halaman akan meninggalkan angka
   * cabang/bulan SEBELUMNYA tetap "menempel" di state `values`/
   * `branchValues` — termasuk tiga field tingkat cabang (PLAN SALES
   * MASTER dkk.) yang kuncinya `'branch'` selalu sama apa pun cabangnya.
   * Ini bukan cuma tampilan basi: kalau setelah berpindah cabang user
   * menekan Simpan tanpa sadar datanya belum ter-refresh, `branchValues`
   * milik cabang LAMA bisa terkirim ke `branchId` yang BARU. `key` di
   * bawah ini (gabungan `periodId:branchId`) memaksa React me-mount ULANG
   * `InputGrid`/`UploadPanel` (state lokal dibuang, dimulai lagi dari
   * `initialValues` yang baru) setiap kali periode atau cabang berganti.
   *
   * Berpindah MINGGU saja sengaja TIDAK ikut membuang `key` ini — kolom
   * W1-W4 memang selalu tampil sekaligus di grid yang sama (lihat catatan
   * "Aturan minggu & periode"), jadi `values`/`branchValues` untuk
   * periode+cabang yang sama tetap valid dipakai lintas minggu; me-mount
   * ulang di sana cuma akan membuang draf yang sedang diketik tanpa
   * alasan. */
  const workspaceKey = `${props.periodId}:${props.branchId}`;

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="Cara mengisi report"
        className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5"
      >
        <ModeButton
          active={mode === 'grid'}
          onClick={() => setMode('grid')}
          label="Isi Langsung"
          hint="Ketik di grid ala Excel"
        />
        <ModeButton
          active={mode === 'upload'}
          onClick={() => setMode('upload')}
          label="Upload Excel"
          hint="Unggah file MOS cabang apa adanya"
        />
      </div>

      {mode === 'grid' ? (
        <InputGrid
          key={workspaceKey}
          periodId={props.periodId}
          branchId={props.branchId}
          branchName={props.branchName}
          reportingWeek={props.reportingWeek}
          alreadySubmitted={props.alreadySubmitted}
          readOnly={props.readOnly}
          lastSubmittedWeek={props.lastSubmittedWeek}
          salesmen={props.salesmen}
          initialValues={props.initialValues}
          snapshotValues={props.snapshotValues}
          branchInitialValues={props.branchInitialValues}
          branchSnapshotValues={props.branchSnapshotValues}
        />
      ) : (
        <UploadPanel
          key={workspaceKey}
          periodId={props.periodId}
          branchId={props.branchId}
          branchCode={props.branchCode}
          branchName={props.branchName}
          year={props.year}
          month={props.month}
          reportingWeek={props.reportingWeek}
          readOnly={props.readOnly}
          lastSubmittedWeek={props.lastSubmittedWeek}
          salesmen={props.salesmen}
          currentValues={props.initialValues}
          snapshotValues={props.snapshotValues}
          branchCurrentValues={props.branchInitialValues}
          branchSnapshotValues={props.branchSnapshotValues}
        />
      )}
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      title={hint}
      className={`rounded-md px-3.5 py-1.5 text-xs font-medium transition ${
        active ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-50'
      }`}
    >
      {label}
    </button>
  );
}
