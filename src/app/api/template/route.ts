import { getProfile } from '@/lib/supabase/server';
import { getActivePeriod, listBranches, listEntries, listSalesmen } from '@/lib/report';
import { buildBranchTemplateWorkbook } from '@/lib/xlsx-styled';
import { monthName } from '@/lib/format';

export const dynamic = 'force-dynamic';

/* GET /api/template?branch=<uuid>&period=<uuid>
 * Template Excel satu cabang, sudah terisi data terakhir. */

export async function GET(request: Request) {
  const profile = await getProfile();
  if (!profile) return new Response('Belum login.', { status: 401 });
  if (profile.role === 'ho_pic') {
    return new Response('PIC Head Office tidak mengisi report.', { status: 403 });
  }

  const url = new URL(request.url);
  const period = await getActivePeriod(url.searchParams.get('period') ?? undefined);
  if (!period) return new Response('Periode tidak ditemukan.', { status: 404 });

  const requested = url.searchParams.get('branch');
  const branchId = profile.role === 'admin' ? requested : profile.branch_id;

  if (!branchId) return new Response('Cabang tidak ditentukan.', { status: 400 });
  if (profile.role === 'cabang' && requested && requested !== profile.branch_id) {
    return new Response('Anda hanya dapat mengunduh template cabang Anda sendiri.', {
      status: 403,
    });
  }

  const branches = await listBranches();
  const branch = branches.find((b) => b.id === branchId);
  if (!branch) return new Response('Cabang tidak ditemukan.', { status: 404 });

  const [salesmen, entries] = await Promise.all([
    listSalesmen(branchId),
    listEntries(period.id, branchId),
  ]);

  // Minggu yang dilaporkan boleh dipilih cabang; hanya dipakai untuk
  // judul di dalam file, jadi cukup divalidasi rentangnya.
  const requestedWeek = Number(url.searchParams.get('week'));
  const week =
    Number.isInteger(requestedWeek) && requestedWeek >= 1 && requestedWeek <= 4
      ? requestedWeek
      : period.current_week;

  const buffer = await buildBranchTemplateWorkbook({
    branchCode: branch.code,
    branchName: branch.name,
    year: period.year,
    month: period.month,
    week,
    rows: salesmen.map((s) => ({
      salesmanId: s.id,
      salesmanName: s.name,
      values: entries.find((e) => e.salesman_id === s.id)?.values ?? {},
    })),
  });

  const filename = `MOS_${branch.code}_${monthName(period.month)}_${period.year}_W${week}.xlsx`;

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
