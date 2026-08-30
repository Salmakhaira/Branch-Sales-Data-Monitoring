import { createClient } from '@/lib/supabase/server';
import { REASON_CATEGORIES } from '@/lib/metrics';
import { fmtDateTime, fmtNumber } from '@/lib/format';
import BranchPicker from '@/components/BranchPicker';
import ReviewControls from '@/components/ReviewControls';
import type { Branch, Period, RevisionMonitorRow } from '@/lib/types';

const CATEGORY_LABEL = Object.fromEntries(REASON_CATEGORIES.map((c) => [c.value, c.label]));

/* =====================================================================
 *  MONITORING PERUBAHAN  (bagian bawah halaman Ringkasan)
 *
 *  Menampilkan angka yang BERUBAH setelah dilaporkan pada minggu
 *  sebelumnya, lengkap dengan alasan yang diisi cabang. Inilah pengganti
 *  pertanyaan "kenapa angka ini berbeda dengan minggu lalu?" di rapat.
 * =================================================================== */

export default async function RevisionMonitor({
  period,
  branches,
  isHO,
  branchFilter,
  statusFilter,
}: {
  period: Period;
  branches: Branch[];
  isHO: boolean;
  branchFilter?: string;
  statusFilter?: string;
}) {
  const supabase = createClient();

  let query = supabase
    .from('v_revision_monitor')
    .select('*')
    .eq('period_id', period.id)
    .order('changed_at', { ascending: false })
    .limit(300);

  if (branchFilter) {
    const b = branches.find((x) => x.id === branchFilter);
    if (b) query = query.eq('branch_code', b.code);
  }
  if (statusFilter && statusFilter !== 'all') {
    query = query.eq('review_status', statusFilter);
  }

  const { data, error } = await query;
  const rows = (data as RevisionMonitorRow[]) ?? [];

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Monitoring Perubahan Data</h3>
          <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-slate-500">
            Angka yang berubah <strong>setelah</strong> dilaporkan pada minggu sebelumnya, beserta
            alasan yang diisi cabang.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isHO && (
            <BranchPicker
              branches={branches}
              current={branchFilter}
              paramName="branch"
              allowAll
            />
          )}
          <StatusFilter
            current={statusFilter ?? 'all'}
            periodId={period.id}
            branchFilter={branchFilter}
          />
        </div>
      </div>

      {error && (
        <p className="mx-5 my-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error.message}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="px-5 py-10 text-center text-xs text-slate-500">
          {statusFilter && statusFilter !== 'all'
            ? 'Tidak ada perubahan dengan status tersebut.'
            : 'Belum ada perubahan atas angka yang sudah dilaporkan pada periode ini.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-5 py-2 font-medium">Waktu</th>
                <th className="px-3 py-2 font-medium">Cabang</th>
                <th className="px-3 py-2 font-medium">Salesman</th>
                <th className="px-3 py-2 font-medium">Kolom</th>
                <th className="px-3 py-2 text-center font-medium">Mg</th>
                <th className="px-3 py-2 text-right font-medium">Sebelum</th>
                <th className="px-3 py-2 text-right font-medium">Sesudah</th>
                <th className="px-3 py-2 text-right font-medium">Selisih</th>
                <th className="px-3 py-2 font-medium">Alasan</th>
                <th className="px-5 py-2 font-medium">Tinjauan</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 align-top last:border-0">
                  <td className="whitespace-nowrap px-5 py-2.5 text-[11px] text-slate-500">
                    {fmtDateTime(r.changed_at)}
                    <div className="text-[10px] text-slate-400">{r.changed_by_name}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-slate-700">{r.branch_code}</div>
                    <div className="text-[10px] text-slate-400">{r.area_code}</div>
                  </td>
                  <td className="px-3 py-2.5 text-slate-600">{r.salesman_name}</td>
                  <td className="px-3 py-2.5 text-slate-700">{r.field_label ?? r.field_key}</td>
                  <td className="px-3 py-2.5 text-center text-slate-500">
                    {r.locked_week ? `W${r.locked_week}` : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">
                    {fmtNumber(r.old_value)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-medium tabular-nums text-slate-800">
                    {fmtNumber(r.new_value)}
                  </td>
                  <td
                    className={`px-3 py-2.5 text-right font-medium tabular-nums ${
                      (r.delta ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'
                    }`}
                  >
                    {(r.delta ?? 0) >= 0 ? '+' : ''}
                    {fmtNumber(r.delta)}
                  </td>
                  <td className="max-w-xs px-3 py-2.5">
                    <span className="mb-0.5 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                      {CATEGORY_LABEL[r.reason_category ?? ''] ?? r.reason_category ?? '—'}
                    </span>
                    <p className="whitespace-normal leading-relaxed text-slate-600">{r.reason}</p>
                    {r.source === 'excel_upload' && (
                      <span className="mt-0.5 inline-block text-[10px] text-slate-400">
                        via upload Excel
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-2.5">
                    {isHO ? (
                      <ReviewControls
                        revisionId={r.id}
                        status={r.review_status ?? 'open'}
                        note={r.review_note}
                      />
                    ) : (
                      <StatusBadge status={r.review_status ?? 'open'} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function StatusFilter({
  current,
  periodId,
  branchFilter,
}: {
  current: string;
  periodId: string;
  branchFilter?: string;
}) {
  const options = [
    { value: 'all', label: 'Semua' },
    { value: 'open', label: 'Belum ditinjau' },
    { value: 'acknowledged', label: 'Sudah ditinjau' },
    { value: 'flagged', label: 'Perlu klarifikasi' },
  ];

  return (
    <div className="flex gap-1 rounded-lg border border-slate-300 bg-white p-0.5">
      {options.map((o) => {
        const params = new URLSearchParams({ period: periodId, status: o.value });
        if (branchFilter) params.set('branch', branchFilter);
        return (
          <a
            key={o.value}
            href={`/?${params.toString()}#perubahan`}
            className={`rounded px-2 py-1 text-[11px] font-medium transition ${
              current === o.value ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            {o.label}
          </a>
        );
      })}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    open: { cls: 'bg-amber-100 text-amber-800', label: 'Belum ditinjau' },
    acknowledged: { cls: 'bg-emerald-100 text-emerald-700', label: 'Sudah ditinjau' },
    flagged: { cls: 'bg-rose-100 text-rose-700', label: 'Perlu klarifikasi' },
  };
  const s = map[status] ?? map.open;
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${s.cls}`}>{s.label}</span>;
}
