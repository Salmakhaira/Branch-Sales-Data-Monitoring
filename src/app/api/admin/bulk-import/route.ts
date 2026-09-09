import { NextResponse } from 'next/server';
import { createClient, getProfile } from '@/lib/supabase/server';
import { saveEntries } from '@/lib/saveEntries';
import { parseBranchTemplate, detectMonthSheets } from '@/lib/excel';
import * as XLSX from 'xlsx';

/* =====================================================================
 *  POST /api/admin/bulk-import
 *
 *  Upload SATU file workbook cabang (berisi banyak sheet bulan, seperti
 *  Sampit.xlsx), sistem otomatis mendeteksi SEMUA sheet yang namanya
 *  cocok pola "BULAN TAHUN" dan mengimpor semuanya sekaligus — supaya
 *  backfill data lama tidak perlu upload manual satu-satu per bulan.
 *
 *  Khusus admin. Memakai jalur validasi yang SAMA PERSIS dengan upload
 *  manual biasa (saveEntries.ts) untuk tiap bulan yang terdeteksi —
 *  bukan jalur pintas terpisah.
 * =================================================================== */

interface BulkImportBody {
  branchCode?: string;
  fileContentBase64?: string;
}

export const maxDuration = 120; // parsing + simpan banyak bulan sekaligus bisa agak lama

export async function POST(request: Request) {
  const profile = await getProfile();
  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Hanya administrator.' }, { status: 403 });
  }

  let body: BulkImportBody;
  try {
    body = (await request.json()) as BulkImportBody;
  } catch {
    return NextResponse.json({ error: 'Body tidak valid.' }, { status: 400 });
  }

  const { branchCode, fileContentBase64 } = body;
  if (!branchCode || !fileContentBase64) {
    return NextResponse.json({ error: 'branchCode dan fileContentBase64 wajib diisi.' }, { status: 400 });
  }

  const supabase = createClient();

  const { data: branch } = await supabase
    .from('branches')
    .select('id, code, name')
    .eq('code', branchCode)
    .maybeSingle();
  if (!branch) {
    return NextResponse.json({ error: `Cabang dengan kode "${branchCode}" tidak ditemukan.` }, { status: 404 });
  }

  const { data: salesmenRows } = await supabase
    .from('salesmen')
    .select('id, name')
    .eq('branch_id', branch.id)
    .eq('is_active', true);
  const salesmen = (salesmenRows ?? []).map((s: any) => ({ id: s.id, name: s.name }));

  let buffer: Buffer;
  try {
    buffer = Buffer.from(fileContentBase64, 'base64');
  } catch {
    return NextResponse.json({ error: 'fileContentBase64 tidak valid.' }, { status: 400 });
  }

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: 'buffer' });
  } catch (err: any) {
    return NextResponse.json({ error: `Gagal membaca file: ${err?.message ?? 'format tidak dikenali'}` }, { status: 400 });
  }

  const monthSheets = detectMonthSheets(wb);
  if (monthSheets.length === 0) {
    return NextResponse.json(
      { error: 'Tidak ada sheet berformat "BULAN TAHUN" yang terdeteksi di file ini.' },
      { status: 400 },
    );
  }

  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
  const results: Array<{
    year: number;
    month: number;
    sheetName: string;
    status: 'ok' | 'partial' | 'failed';
    changed?: number;
    skipped?: number;
    error?: string;
  }> = [];

  // Urutkan kronologis (bukan urutan ditemukan) supaya laporan enak dibaca.
  monthSheets.sort((a, b) => a.year - b.year || a.month - b.month);

  for (const { sheetName, year, month } of monthSheets) {
    try {
      // Cari periode yang sudah ada; buat baru kalau belum ada (mis. bulan
      // yang belum pernah dibuka lewat ensure_current_current_period()).
      let { data: period } = await supabase
        .from('periods')
        .select('id, year, month')
        .eq('year', year)
        .eq('month', month)
        .maybeSingle();

      if (!period) {
        const { data: created, error: createErr } = await supabase
          .from('periods')
          .insert({ year, month })
          .select('id, year, month')
          .single();
        if (createErr || !created) {
          results.push({ year, month, sheetName, status: 'failed', error: `Gagal membuat periode: ${createErr?.message}` });
          continue;
        }
        period = created;
      }

      const parsed = parseBranchTemplate(arrayBuffer, {
        salesmen,
        branchCode: branch.code,
        branchName: branch.name,
        year,
        month,
      });

      const blockingIssues = parsed.issues.filter((i) => i.level === 'error');
      if (blockingIssues.length > 0) {
        results.push({
          year,
          month,
          sheetName,
          status: 'failed',
          error: blockingIssues.map((i) => i.message).join('; '),
        });
        continue;
      }

      const normalize = (v: Record<string, number | null | undefined>): Record<string, number | null> =>
        Object.fromEntries(Object.entries(v).map(([k, val]) => [k, val ?? null]));

      const saveResult = await saveEntries({
        supabase,
        actor: { id: profile.id, role: profile.role, branch_id: profile.branch_id },
        periodId: period.id,
        branchId: branch.id,
        rows: parsed.rows.map((r) => ({ salesmanId: r.salesmanId, values: normalize(r.values) })),
        branchValues: parsed.branchValues ? normalize(parsed.branchValues) : undefined,
        source: 'admin',
        allowPartialOnConflict: true,
      });

      if (!saveResult.ok) {
        results.push({ year, month, sheetName, status: 'failed', error: saveResult.error });
        continue;
      }

      results.push({
        year,
        month,
        sheetName,
        status: saveResult.skipped > 0 ? 'partial' : 'ok',
        changed: saveResult.changed,
        skipped: saveResult.skipped,
      });
    } catch (err: any) {
      results.push({ year, month, sheetName, status: 'failed', error: err?.message ?? 'Kesalahan tidak diketahui.' });
    }
  }

  return NextResponse.json({ branch: branch.name, results });
}
