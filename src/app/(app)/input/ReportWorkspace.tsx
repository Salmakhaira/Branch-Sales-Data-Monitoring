'use client';

import { useState } from 'react';
import InputGrid from './InputGrid';
import UploadPanel from './UploadPanel';
import BranchLevelPanel from './BranchLevelPanel';
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

  return (
    <div className="space-y-4">
      <BranchLevelPanel
        periodId={props.periodId}
        branchId={props.branchId}
        branchName={props.branchName}
        readOnly={props.readOnly}
        lastSubmittedWeek={props.lastSubmittedWeek}
        initialValues={props.branchInitialValues}
        snapshotValues={props.branchSnapshotValues}
      />

      <div className="flex flex-wrap items-center gap-3">
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

        <p className="text-[11px] text-slate-400">
          {mode === 'grid'
            ? 'Perubahan tercatat per sel — jejak audit paling rinci.'
            : 'File diperiksa dan ditampilkan dulu sebelum ada yang tersimpan.'}
        </p>
      </div>

      {mode === 'grid' ? (
        <InputGrid
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
        />
      ) : (
        <UploadPanel
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
