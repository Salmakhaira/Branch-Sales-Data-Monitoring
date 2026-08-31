import Link from 'next/link';
import { getProfile, createClient } from '@/lib/supabase/server';
import {
  getActivePeriod,
  getSubmissionMatrix,
  listAreas,
  listBranches,
  listBranchEntries,
  listEntries,
  listPeriods,
} from '@/lib/report';
import { aggregateRows, computeRow, type ValueMap } from '@/lib/metrics';
import { fmtDateTime, fmtNumber, fmtWhole, monthName, periodLabel } from '@/lib/format';
import { describeWeek } from '@/lib/period';
import PeriodPicker from '@/components/PeriodPicker';
import RevisionMonitor from '@/components/RevisionMonitor';
import LockWeekButton from '@/components/LockWeekButton';

export const dynamic = 'force-dynamic';

export default async function SummaryPage({
  searchParams,
}: {
  searchParams: { period?: string; branch?: string; status?: string };
}) {
  const profile = await getProfile();
  const period = await getActivePeriod(searchParams.period);

  if (!period) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
        <h3 className="text-sm font-semibold text-slate-800">Belum ada periode pelaporan</h3>
        <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
          Administrator perlu membuat periode terlebih dahulu di menu Administrasi.
        </p>
      </div>
    );
  }

  const [periods, areas, branches, entries, submissions, branchEntries] = await Promise.all([
    listPeriods(),
    listAreas(),
    listBranches(),
    listEntries(period.id),
    getSubmissionMatrix(period.id),
    listBranchEntries(period.id),
  ]);

  const ctx = { week: period.current_week };
  const areaByBranch = new Map(branches.map((b) => [b.id, b.area_id]));
  const rowsByBranch = new Map<string, ValueMap[]>();
  for (const e of entries) {
    const list = rowsByBranch.get(e.branch_id) ?? [];
    list.push(computeRow(e.values ?? {}, ctx));
    rowsByBranch.set(e.branch_id, list);
  }
  // PLAN SALES MASTER/OL MIN PRTM/ACTUAL SALES — data tingkat cabang,
  // ditambahkan sebagai "baris" tambahan per cabang supaya ikut terjumlah.
  for (const b of branches) {
    const values = branchEntries.get(b.id)?.values;
    if (!values) continue;
    const list = rowsByBranch.get(b.id) ?? [];
    list.push(values);
    rowsByBranch.set(b.id, list);
  }

  const national = aggregateRows([...rowsByBranch.values()].flat(), ctx);

  const submittedThisWeek = branches.filter((b) =>
    (submissions.get(b.id)?.weeks ?? []).includes(period.current_week),
  ).length;

  const supabase = createClient();
  const { count: openRevisions } = await supabase
    .from('entry_revisions')
    .select('id', { count: 'exact', head: true })
    .eq('period_id', period.id)
    .eq('requires_reason', true)
    .eq('review_status', 'open');

  const isHO = profile?.role === 'ho_pic' || profile?.role === 'admin';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">
            Periode {periodLabel(period.year, period.month)}
          </h2>
          <p className="mt-0.5 text-sm text-slate-500">
            <strong>Minggu {period.current_week}</strong> ·{' '}
            {describeWeek(period.year, period.month, period.current_week, monthName(period.month))}
            {!period.is_open && ' · periode ditutup'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PeriodPicker periods={periods} current={period.id} />
          {isHO && period.is_open && (
            <LockWeekButton
              periodId={period.id}
              week={period.current_week}
              periodLabel={periodLabel(period.year, period.month)}
            />
          )}
          {profile?.role !== 'ho_pic' && (
            <Link
              href="/input"
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700"
            >
              Isi Report Cabang
            </Link>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Cabang sudah submit"
          value={`${submittedThisWeek} / ${branches.length}`}
          sub={`Minggu ${period.current_week}`}
        />
        <Stat
          label="Total OL Revenue"
          value={fmtNumber(national.total_ol_revenue)}
          sub="Nasional, minggu berjalan"
        />
        {/* RATIO OL/PO sudah dihapus dari daftar kolom, jadi kartu ini
            diganti TOTAL PO OUTLOOK yang masih ada dan sama informatifnya. */}
        <Stat
          label="Total PO Outlook"
          value={fmtWhole(national.total_po_outlook)}
          sub="Nasional, minggu berjalan"
        />
        <Stat
          label="Perubahan perlu ditinjau"
          value={String(openRevisions ?? 0)}
          sub="Angka berubah setelah submit"
          tone={openRevisions && openRevisions > 0 ? 'warn' : 'normal'}
          href="#perubahan"
        />
      </div>

      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-3">
          <h3 className="text-sm font-semibold text-slate-900">Status Pengisian per Cabang</h3>
          <p className="text-xs text-slate-500">
            Kotak berwarna = minggu tersebut sudah di-submit dan angkanya terkunci.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-5 py-2 font-medium">Cabang</th>
                <th className="px-3 py-2 font-medium">Area</th>
                <th className="px-3 py-2 text-center font-medium">W1</th>
                <th className="px-3 py-2 text-center font-medium">W2</th>
                <th className="px-3 py-2 text-center font-medium">W3</th>
                <th className="px-3 py-2 text-center font-medium">W4</th>
                <th className="px-3 py-2 text-right font-medium">Total OL Revenue</th>
                <th className="px-3 py-2 text-right font-medium">Actual Sales</th>
                <th className="px-5 py-2 text-right font-medium">Update terakhir</th>
              </tr>
            </thead>
            <tbody>
              {branches.map((b) => {
                const sub = submissions.get(b.id);
                const rows = rowsByBranch.get(b.id) ?? [];
                const agg = aggregateRows(rows, ctx);
                const area = areas.find((a) => a.id === areaByBranch.get(b.id));
                return (
                  <tr key={b.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-2.5">
                      <span className="font-medium text-slate-800">{b.name}</span>
                      <span className="ml-2 text-[11px] text-slate-400">{b.code}</span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-500">{area?.code ?? '-'}</td>
                    {[1, 2, 3, 4].map((w) => (
                      <td key={w} className="px-3 py-2.5 text-center">
                        <span
                          className={`inline-block h-4 w-8 rounded ${
                            sub?.weeks.includes(w)
                              ? 'bg-emerald-500'
                              : w === period.current_week
                                ? 'bg-amber-200'
                                : 'bg-slate-100'
                          }`}
                          title={
                            sub?.weeks.includes(w)
                              ? `Minggu ${w} sudah submit`
                              : `Minggu ${w} belum submit`
                          }
                        />
                      </td>
                    ))}
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                      {fmtNumber(agg.total_ol_revenue)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                      {fmtNumber(agg.actual_sales)}
                    </td>
                    <td className="px-5 py-2.5 text-right text-xs text-slate-500">
                      {fmtDateTime(sub?.lastAt) || '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                <td className="px-5 py-2.5 text-slate-800" colSpan={6}>
                  GRAND TOTAL NASIONAL
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-900">
                  {fmtNumber(national.total_ol_revenue)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-900">
                  {fmtNumber(national.actual_sales)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <div id="perubahan" className="scroll-mt-24">
        <RevisionMonitor
          period={period}
          branches={branches}
          isHO={isHO}
          branchFilter={searchParams.branch}
          statusFilter={searchParams.status}
        />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = 'normal',
  href,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'normal' | 'warn';
  href?: string;
}) {
  const inner = (
    <div
      className={`h-full rounded-xl border p-4 ${
        tone === 'warn' ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'
      } ${href ? 'transition hover:shadow-sm' : ''}`}
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p>}
    </div>
  );
  return href ? (
    <a href={href} className="block">
      {inner}
    </a>
  ) : (
    inner
  );
}
