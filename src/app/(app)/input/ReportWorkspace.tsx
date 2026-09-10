'use client';

import { useState } from 'react';
import InputGrid from './InputGrid';
import UploadPanel from './UploadPanel';
import type { ValueMap } from '@/lib/metrics';

type Mode = 'grid' | 'upload' | 'correction';

interface Props {
  periodId: string;
  branchId: string;
  branchCode: string;
  branchName: string;
  year: number;
  month: number;
  reportingWeek: number;
  alreadySubmitted: boolean;
  readOnly: boolean;
  lastSubmittedWeek: number | null;
  salesmen: { id: string; name: string }[];
  initialValues: Record<string, Record<string, number | null>>;
  snapshotValues: Record<string, Record<string, number | null>>;
  branchInitialValues: ValueMap;
  branchSnapshotValues: ValueMap;
}

export default function ReportWorkspace(props: Props) {
  const [mode, setMode] = useState<Mode>('grid');
  const [justUploaded, setJustUploaded] = useState(false);
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
        <ModeButton
          active={mode === 'correction'}
          onClick={() => setMode('correction')}
          label="Ubah Data"
          hint="Koreksi angka yang sudah terkunci (butuh alasan)"
        />
      </div>

      {mode === 'grid' ? (
        <InputGrid
          key={workspaceKey}
          mode="entry"
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
          initialJustSaved={justUploaded}
          onConsumedInitialJustSaved={() => setJustUploaded(false)}
        />
      ) : mode === 'correction' ? (
        <InputGrid
          key={workspaceKey}
          mode="correction"
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
          onUploadSuccess={() => setJustUploaded(true)}
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
