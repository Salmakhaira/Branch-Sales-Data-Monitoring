import { Fragment } from 'react';
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
import { fmtWhole, fmtPercent, periodLabel } from '@/lib/format';
import { buildMosHeaderRows, MOS_TOP_TONE, MOS_SUB_TONE } from '@/lib/mos-header';
import PeriodPicker from '@/components/PeriodPicker';
import ExportButton from '@/components/ExportButton';

export const dynamic = 'force-dynamic';

/* Kolom + header bertingkat tiga sama persis dengan grid input & preview
 * upload (lihat src/lib/mos-header.ts) — supaya "rekap data" ini terasa
 * seperti sheet MOS asli, bukan tabel generik. Kolom rekap nasional cuma
 * subset (m.inNational), tapi grup besarnya (PLAN SALES MASTER, OUTLOOK
 * PRTM, OUTLOOK REVENUE TM, ACTUAL SALES) tetap sama, jadi warnanya tetap
 * konsisten dengan MOS_TOP_TONE/MOS_SUB_TONE yang sudah ada. */
const NATIONAL_COLUMNS = orderedMetrics((m) => m.inNational);
const NATIONAL_HEADER = buildMosHeaderRows(NATIONAL_COLUMNS);

/* Warna baris identitas, diambil dari nilai isian sel yang sesungguhnya di
 * WEEKLY REPORT MOS NASIONAL 2026.xlsx (sheet "MOS AGUSTUS 2026"):
 *   - baris cabang (branch)      -> oranye solid FFC000, nilai biru muda
 *     BDD7EE (sama seperti export Excel di xlsx-styled.ts, supaya layar
 *     ini & file unduhan konsisten satu sama lain)
 *   - baris "AREA n (kode)"      -> label sel diberi warna berbeda tiap
 *     area: AREA 1 oranye FFC000, AREA 2 hijau 92D050, AREA 3 biru
 *     00B0F0 — warna berikutnya diulang bila area lebih dari 3
 *   - baris GRAND TOTAL          -> kuning solid FFFF00, SELURUH sel
 *     (bukan cuma label), persis seperti file aslinya
 * Baris "TOTAL" terpisah di file asli (sebelum baris AREA) tidak ditiru
 * di sini karena isinya #REF! — sisa referensi antar-file yang putus,
 * justru masalah yang mau dihilangkan oleh sistem ini. */
const AREA_ROW_COLORS = ['#FFC000', '#92D050', '#00B0F0', '#F4B183', '#9DC3E6', '#C6E0B4'];
const BRANCH_LABEL_BG = '#FFC000';
const BRANCH_VALUE_BG = '#BDD7EE';
const GRAND_TOTAL_BG = '#FFFF00';

export default async function NationalPage({
  searchParams,
}: {
  searchParams: { period?: string; detail?: string };
}) {
  const profile = await getProfile();
  const periods = await listPeriods();
  const period = await getActivePeriod(searchParams.period);
  // File MOS asli selalu menampilkan baris salesman di bawah tiap cabang
  // (baris-baris itu memang bisa dilipat lewat grouping Excel, tapi
  // tampil secara default) — jadi di sini defaultnya juga tampil, dan
  // hanya disembunyikan kalau eksplisit diminta lewat ?detail=0.
  const showDetail = searchParams.detail !== '0';

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

  // Baris per salesman, sudah dihitung turunannya
  const rowsBySalesman = new Map<string, ValueMap>();
  for (const e of entries) {
    rowsBySalesman.set(e.salesman_id, computeRow(e.values ?? {}, ctx));
  }

  const cols = NATIONAL_COLUMNS;

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

  const areaTotals = areas.map((a, i) => ({
    code: a.code,
    name: a.name,
    color: AREA_ROW_COLORS[i % AREA_ROW_COLORS.length],
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
            menggantikan sheet &ldquo;rekap nasional&rdquo; yang dulu di-link antar file Excel —
            tampilannya dibuat semirip mungkin dengan sheet MOS aslinya.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PeriodPicker periods={periods} current={period.id} />
          <a
            href={`?period=${period.id}${showDetail ? '&detail=0' : ''}`}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
          >
            {showDetail ? 'Ringkas per cabang' : 'Tampilkan per salesman'}
          </a>
          <ExportButton periodId={period.id} />
        </div>
      </div>

      <div className="max-h-[calc(100vh-260px)] overflow-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              <th
                className="sticky left-0 top-0 z-30 border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-slate-500"
                rowSpan={3}
                style={{ minWidth: 220 }}
              >
                BRANCH / SALESMAN
              </th>
              <th
                className="sticky top-0 z-20 border-b border-slate-200 bg-slate-50 px-2 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-slate-500"
                rowSpan={3}
                style={{ minWidth: 56 }}
              >
                AREA
              </th>
              {NATIONAL_HEADER.tops.map((g, i) => (
                <th
                  key={`${g.label}-${i}`}
                  colSpan={g.span}
                  className={`sticky top-0 z-20 whitespace-nowrap px-3 py-1.5 text-left ${
                    MOS_TOP_TONE[g.label] ?? '!bg-slate-100'
                  }`}
                >
                  {g.label}
                </th>
              ))}
            </tr>
            <tr>
              {NATIONAL_HEADER.subs.map((sh, i) => (
                <th
                  key={`${sh.top}-${sh.label}-${i}`}
                  colSpan={sh.span}
                  rowSpan={sh.hasTier ? 1 : 2}
                  className={`sticky top-6 z-20 whitespace-nowrap px-2 py-1.5 text-center font-normal ${
                    MOS_SUB_TONE[sh.top] ?? '!bg-slate-50'
                  }`}
                  style={{ minWidth: sh.span === 1 ? 96 : undefined }}
                >
                  {sh.label}
                </th>
              ))}
            </tr>
            <tr>
              {NATIONAL_COLUMNS.map((c) => {
                const tier = (c.mos ?? {}).tier;
                if (!tier) return null;
                return (
                  <th
                    key={c.key}
                    title={`${c.label}${c.excel ? ` (kolom Excel ${c.excel})` : ''}`}
                    className={`sticky top-[3.25rem] z-20 whitespace-nowrap px-2 py-1.5 text-center font-normal ${
                      MOS_SUB_TONE[(c.mos ?? { top: c.group }).top] ?? '!bg-slate-50'
                    }`}
                    style={{ minWidth: 96 }}
                  >
                    {tier}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {branchBlocks.map((bb) => (
              <Fragment key={bb.branch.id}>
                <tr className="font-semibold">
                  <td
                    className="sticky left-0 z-10 whitespace-nowrap border-b border-r border-slate-200 px-3 py-2 text-slate-900"
                    style={{ backgroundColor: BRANCH_LABEL_BG }}
                  >
                    {bb.branch.name}
                    <span className="ml-2 text-[10px] font-normal text-slate-700/70">
                      {bb.branch.code}
                    </span>
                  </td>
                  <td
                    className="border-b border-slate-200 px-2 py-2 text-slate-800"
                    style={{ backgroundColor: BRANCH_LABEL_BG }}
                  >
                    {bb.area?.code ?? '-'}
                  </td>
                  {cols.map((c) => (
                    <td
                      key={c.key}
                      className="border-b border-slate-200 px-2 py-2 text-right tabular-nums text-slate-900"
                      style={{ backgroundColor: BRANCH_VALUE_BG }}
                    >
                      {c.format === 'percent' ? fmtPercent(bb.total[c.key]) : fmtWhole(bb.total[c.key])}
                    </td>
                  ))}
                </tr>
                {showDetail &&
                  bb.rows.map((r) => (
                    <tr key={r.salesman.id} className="hover:bg-slate-50/60">
                      <td className="sticky left-0 z-10 whitespace-nowrap border-b border-r border-slate-100 bg-white px-3 py-1.5 pl-8 text-slate-600">
                        {r.salesman.name}
                      </td>
                      <td className="border-b border-slate-100 bg-white px-2 py-1.5" />
                      {cols.map((c) => {
                        // PLAN SALES MASTER/OL MIN PRTM/ACTUAL SALES (dan
                        // turunannya) adalah data TINGKAT CABANG — kosong di
                        // baris salesman, persis seperti Excel asli.
                        if (c.level === 'branch') {
                          return (
                            <td
                              key={c.key}
                              className="border-b border-slate-100 px-2 py-1.5 text-right text-slate-300"
                            >
                              —
                            </td>
                          );
                        }
                        return (
                          <td
                            key={c.key}
                            className="border-b border-slate-100 px-2 py-1.5 text-right tabular-nums text-slate-600"
                          >
                            {c.format === 'percent'
                              ? fmtPercent(r.values[c.key])
                              : fmtWhole(r.values[c.key])}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
              </Fragment>
            ))}
          </tbody>
          <tfoot>
            {areaTotals.map((a) => (
              <tr key={a.code} className="border-t border-slate-300 font-medium">
                <td
                  className="sticky left-0 z-10 whitespace-nowrap border-b border-r border-slate-200 px-3 py-2 text-slate-900"
                  style={{ backgroundColor: a.color }}
                >
                  {a.name}
                </td>
                <td
                  className="border-b border-slate-200 px-2 py-2 text-slate-800"
                  style={{ backgroundColor: a.color }}
                >
                  {a.code}
                </td>
                {cols.map((c) => (
                  <td
                    key={c.key}
                    className="border-b border-slate-200 px-2 py-2 text-right tabular-nums font-medium text-slate-900"
                  >
                    {c.format === 'percent' ? fmtPercent(a.values[c.key]) : fmtWhole(a.values[c.key])}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="border-t-2 border-slate-400 font-bold">
              <td
                className="sticky left-0 z-10 whitespace-nowrap px-3 py-2.5 text-slate-900"
                style={{ backgroundColor: GRAND_TOTAL_BG }}
              >
                GRAND TOTAL
              </td>
              <td className="px-2 py-2.5" style={{ backgroundColor: GRAND_TOTAL_BG }} />
              {cols.map((c) => (
                <td
                  key={c.key}
                  className="px-2 py-2.5 text-right tabular-nums text-slate-900"
                  style={{ backgroundColor: GRAND_TOTAL_BG }}
                >
                  {c.format === 'percent'
                    ? fmtPercent(grandTotal[c.key])
                    : fmtWhole(grandTotal[c.key])}
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
