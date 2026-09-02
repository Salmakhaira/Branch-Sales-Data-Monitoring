import { getProfile } from '@/lib/supabase/server';
import {
  getActivePeriod,
  listAreas,
  listBranches,
  listBranchEntries,
  listEntries,
  listSalesmen,
} from '@/lib/report';
import { aggregateRows, computeRow, type ValueMap } from '@/lib/metrics';
import { buildNationalWorkbook, type NationalRow } from '@/lib/xlsx-styled';
import { monthName } from '@/lib/format';

export const dynamic = 'force-dynamic';

/* GET /api/export?period=<uuid>
 * Menghasilkan file rekap nasional bergaya seperti MOS Nasional.
 *
 * Dibangun di server supaya ExcelJS tidak ikut diunduh browser. Data ANGKA
 * (report_entries dkk.) memang sudah tunduk pada RLS — user cabang hanya
 * bisa mengambil baris cabangnya sendiri. Tapi tabel `areas`/`branches`/
 * `salesmen` policy-nya "master read" (bisa dibaca bebas oleh siapa pun
 * yang login, lihat schema.sql) — jadi TANPA filter di bawah ini, user
 * cabang tetap bisa mengunduh file berisi nama/kode SELURUH cabang & area
 * lain (dengan sel angka kosong). Filter ini menyamakan pembatasan export
 * dengan halaman web /national sejak v2.14 (lihat national/page.tsx). */

export async function GET(request: Request) {
  const profile = await getProfile();
  if (!profile) {
    return new Response('Belum login.', { status: 401 });
  }

  const url = new URL(request.url);
  const period = await getActivePeriod(url.searchParams.get('period') ?? undefined);
  if (!period) {
    return new Response('Periode tidak ditemukan.', { status: 404 });
  }

  const [allAreas, allBranches, entries, allSalesmen, branchEntries] = await Promise.all([
    listAreas(),
    listBranches(),
    listEntries(period.id),
    listSalesmen(),
    listBranchEntries(period.id),
  ]);

  const isHO = profile.role === 'ho_pic' || profile.role === 'admin';
  const branches = isHO ? allBranches : allBranches.filter((b) => b.id === profile.branch_id);
  const areas = isHO ? allAreas : allAreas.filter((a) => a.id === branches[0]?.area_id);

  if (!isHO && branches.length === 0) {
    return new Response('Akun Anda belum ditautkan ke cabang mana pun. Hubungi Administrator.', {
      status: 403,
    });
  }

  const ctx = { week: period.current_week };

  const rowsBySalesman = new Map<string, ValueMap>();
  for (const e of entries) {
    rowsBySalesman.set(e.salesman_id, computeRow(e.values ?? {}, ctx));
  }

  const blocks = branches.map((b) => {
    const sms = allSalesmen.filter((s) => s.branch_id === b.id);
    const rows = sms.map((s) => ({
      name: s.name,
      values: rowsBySalesman.get(s.id) ?? computeRow({}, ctx),
    }));
    // PLAN SALES MASTER/OL MIN PRTM/ACTUAL SALES — data tingkat cabang,
    // tidak ada di baris salesman manapun, ditambahkan di sini supaya
    // ikut terjumlah — sama seperti baris TOTAL di Excel asli.
    const branchLevelValues = branchEntries.get(b.id)?.values ?? {};
    return {
      branch: b,
      area: areas.find((a) => a.id === b.area_id) ?? null,
      rows,
      total: aggregateRows(
        [...rows.map((x) => x.values), branchLevelValues],
        ctx,
      ),
    };
  });

  const exportRows: NationalRow[] = blocks.flatMap((bb) => [
    {
      branchCode: bb.branch.code,
      branchName: bb.branch.name,
      areaCode: bb.area?.code ?? null,
      salesmanName: null,
      values: bb.total,
      isBranchTotal: true,
    },
    ...bb.rows.map((x) => ({
      branchCode: bb.branch.code,
      branchName: bb.branch.name,
      areaCode: bb.area?.code ?? null,
      salesmanName: x.name,
      values: x.values,
      isBranchTotal: false,
    })),
  ]);

  const areaTotals = areas.map((a) => ({
    code: a.code,
    name: a.name,
    values: aggregateRows(
      blocks.filter((bb) => bb.area?.id === a.id).map((bb) => bb.total),
      ctx,
    ),
  }));

  const grandTotal = aggregateRows(
    blocks.map((bb) => bb.total),
    ctx,
  );

  const generatedAt = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(new Date());

  const buffer = await buildNationalWorkbook({
    year: period.year,
    month: period.month,
    week: period.current_week,
    rows: exportRows,
    areaTotals,
    grandTotal,
    generatedAt: `${generatedAt} WIB`,
  });

  const filename = `MOS_NASIONAL_${monthName(period.month)}_${period.year}_W${period.current_week}.xlsx`;

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
