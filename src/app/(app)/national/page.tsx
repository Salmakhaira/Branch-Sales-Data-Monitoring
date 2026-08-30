import { getProfile } from '@/lib/supabase/server';
import {
  getActivePeriod,
  listAreas,
  listBranches,
  listBranchEntries,
  listEntries,
  listPeriods,
  listSalesmen,
} from '@/lib/report';
import { aggregateRows, computeRow, orderedMetrics, type ValueMap } from '@/lib/metrics';
import { fmtNumber, fmtPercent, periodLabel } from '@/lib/format';
import PeriodPicker from '@/components/PeriodPicker';
import ExportButton from '@/components/ExportButton';

export const dynamic = 'force-dynamic';

export default async function NationalPage({
  searchParams,
}: {
  searchParams: { period?: string; detail?: string };
}) {
  const profile = await getProfile();
  const periods = await listPeriods();
  const period = await getActivePeriod(searchParams.period);
  const showDetail = searchParams.detail === '1';

  if (!period) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
        Belum ada periode pelaporan.
      </div>
    );
  }

  const [areas, branches, entries, allSalesmen, branchEntries] = await Promise.all([
    listAreas(),
    listBranches(),
    listEntries(period.id),
    listSalesmen(),
    listBranchEntries(period.id),
  ]);

  const ctx = { week: period.current_week };
  const salesmanById = new Map(allSalesmen.map((s) => [s.id, s]));

  // Baris per salesman, sudah dihitung turunannya
  const rowsBySalesman = new Map<string, ValueMap>();
  for (const e of entries) {
    rowsBySalesman.set(e.salesman_id, computeRow(e.values ?? {}, ctx));
  }

  const cols = orderedMetrics((m) => m.inNational);

  const branchBlocks = branches.map((b) => {
    const sms = allSalesmen.filter((s) => s.branch_id === b.id);
    const rows = sms.map((s) => ({
      salesman: s,
      values: rowsBySalesman.get(s.id) ?? computeRow({}, ctx),
    }));
    // PLAN SALES MASTER/OL MIN PRTM/ACTUAL SALES tidak ada di baris
    // salesman manapun (data tingkat cabang) — ditambahkan di sini supaya
    // ikut terjumlah, sama seperti baris TOTAL di Excel asli.
    const branchLevelValues = branchEntries.get(b.id)?.values ?? {};
    return {
      branch: b,
      area: areas.find((a) => a.id === b.area_id) ?? null,
      rows,
      total: aggregateRows([...rows.map((r) => r.values), branchLevelValues], ctx),
    };
  });

  const areaTotals = areas.map((a) => ({
    code: a.code,
    name: a.name,
    values: aggregateRows(
      branchBlocks.filter((bb) => bb.area?.id === a.id).map((bb) => bb.total),
      ctx,
    ),
  }));

  const grandTotal = aggregateRows(branchBlocks.map((bb) => bb.total), ctx);


  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">
            Rekap Nasional — {periodLabel(period.year, period.month)}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Minggu {period.current_week} · dihitung otomatis dari data seluruh cabang. Ini
            menggantikan sheet &ldquo;rekap nasional&rdquo; yang dulu di-link antar file Excel.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PeriodPicker periods={periods} current={period.id} />
          <a
            href={`?period=${period.id}${showDetail ? '' : '&detail=1'}`}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
          >
            {showDetail ? 'Ringkas per cabang' : 'Tampilkan per salesman'}
          </a>
          <ExportButton periodId={period.id} />
        </div>
      </div>

      <div className="scroll-x rounded-xl border border-slate-200 bg-white">
        <table className="grid-table w-full text-xs">
          <thead>
            <tr>
              <th className="sticky-col px-3 py-2 text-left" style={{ minWidth: 240 }}>
                BRANCH / SALESMAN
              </th>
              <th className="px-2 py-2 text-left" style={{ minWidth: 60 }}>
                AREA
              </th>
              {cols.map((c) => (
                <th
                  key={c.key}
                  className="px-2 py-2 text-right font-normal"
                  style={{ minWidth: 104 }}
                  title={`${c.label}${c.excel ? ` (Excel: ${c.excel})` : ''}`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {branchBlocks.map((bb) => (
              <>
                <tr key={bb.branch.id} className="bg-slate-50 font-semibold">
                  <td className="sticky-col bg-slate-50 px-3 py-2 text-slate-900">
                    {bb.branch.name}
                    <span className="ml-2 text-[10px] font-normal text-slate-400">
                      {bb.branch.code}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-slate-500">{bb.area?.code ?? '-'}</td>
                  {cols.map((c) => (
                    <td key={c.key} className="px-2 py-2 text-right tabular-nums text-slate-800">
                      {c.format === 'percent' ? fmtPercent(bb.total[c.key]) : fmtNumber(bb.total[c.key])}
                    </td>
                  ))}
                </tr>
                {showDetail &&
                  bb.rows.map((r) => (
                    <tr key={r.salesman.id} className="hover:bg-slate-50/60">
                      <td className="sticky-col px-3 py-1.5 pl-8 text-slate-600">
                        {r.salesman.name}
                      </td>
                      <td className="px-2 py-1.5" />
                      {cols.map((c) => {
                        // PLAN SALES MASTER/OL MIN PRTM/ACTUAL SALES (dan
                        // turunannya) adalah data TINGKAT CABANG — kosong di
                        // baris salesman, persis seperti Excel asli.
                        if (c.level === 'branch') {
                          return (
                            <td key={c.key} className="px-2 py-1.5 text-right text-slate-300">
                              —
                            </td>
                          );
                        }
                        return (
                          <td key={c.key} className="px-2 py-1.5 text-right tabular-nums text-slate-600">
                            {c.format === 'percent'
                              ? fmtPercent(r.values[c.key])
                              : fmtNumber(r.values[c.key])}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
              </>
            ))}
          </tbody>
          <tfoot>
            {areaTotals.map((a) => (
              <tr key={a.code} className="border-t border-slate-200 bg-brand-50/60">
                <td className="sticky-col bg-brand-50/60 px-3 py-2 font-medium text-brand-900">
                  {a.name}
                </td>
                <td className="px-2 py-2 text-brand-700">{a.code}</td>
                {cols.map((c) => (
                  <td key={c.key} className="px-2 py-2 text-right tabular-nums font-medium text-brand-900">
                    {c.format === 'percent' ? fmtPercent(a.values[c.key]) : fmtNumber(a.values[c.key])}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="border-t-2 border-slate-400 bg-slate-200 font-bold">
              <td className="sticky-col bg-slate-200 px-3 py-2.5 text-slate-900">GRAND TOTAL</td>
              <td className="px-2 py-2.5" />
              {cols.map((c) => (
                <td key={c.key} className="px-2 py-2.5 text-right tabular-nums text-slate-900">
                  {c.format === 'percent'
                    ? fmtPercent(grandTotal[c.key])
                    : fmtNumber(grandTotal[c.key])}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-[11px] text-slate-400">
        Total cabang, total area, dan grand total dihitung ulang dari angka mentah — bukan
        menjumlahkan hasil perhitungan — persis seperti perilaku baris TOTAL di Excel, tapi tanpa
        risiko referensi antar-file putus.
        {profile?.role === 'ho_pic' && ' Anda memiliki akses baca untuk seluruh cabang.'}
      </p>
    </div>
  );
}
