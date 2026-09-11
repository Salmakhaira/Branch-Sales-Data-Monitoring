import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { saveEntries } from '@/lib/saveEntries';
import { parseBranchTemplate } from '@/lib/excel';

interface WebhookBody {
  branchCode?: string;
  fileName?: string;
  fileContentBase64?: string;
}

async function logSyncRun(
  supabase: ReturnType<typeof createServiceClient>,
  row: {
    branch_id: string | null;
    branch_code: string;
    period_id: string | null;
    file_name: string | null;
    status: 'ok' | 'partial' | 'failed';
    rows_parsed?: number;
    rows_saved?: number;
    rows_skipped?: number;
    parse_issues?: unknown;
    skipped_fields?: unknown;
    error_message?: string | null;
  },
) {
  try {
    await supabase.from('onedrive_sync_runs').insert({
      rows_parsed: 0,
      rows_saved: 0,
      rows_skipped: 0,
      ...row,
    });
  } catch (err) {
    // Kegagalan mencatat log sendiri tidak boleh menutupi hasil asli.
    console.error('[onedrive-sync] gagal menulis onedrive_sync_runs:', err);
  }
}

export async function POST(request: Request) {
  const secretHeader = request.headers.get('x-webhook-secret');
  const expectedSecret = process.env.ONEDRIVE_WEBHOOK_SECRET;

  if (!expectedSecret) {
    return NextResponse.json(
      { error: 'ONEDRIVE_WEBHOOK_SECRET belum diatur di server.' },
      { status: 500 },
    );
  }
  if (secretHeader !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: WebhookBody;
  try {
    body = (await request.json()) as WebhookBody;
  } catch {
    return NextResponse.json({ error: 'Body bukan JSON yang valid.' }, { status: 400 });
  }

  const { branchCode, fileName, fileContentBase64 } = body;
  const supabase = createServiceClient();

  if (!branchCode || !fileContentBase64) {
    await logSyncRun(supabase, {
      branch_id: null,
      branch_code: branchCode ?? '(tidak dikirim)',
      period_id: null,
      file_name: fileName ?? null,
      status: 'failed',
      error_message: "Field 'branchCode' atau 'fileContentBase64' tidak dikirim.",
    });
    return NextResponse.json(
      { error: "Field 'branchCode' dan 'fileContentBase64' wajib diisi." },
      { status: 400 },
    );
  }

  // --- Resolusi cabang ---------------------------------------------------
  const { data: branch } = await supabase
    .from('branches')
    .select('id, code, name')
    .eq('code', branchCode)
    .maybeSingle();

  if (!branch) {
    await logSyncRun(supabase, {
      branch_id: null,
      branch_code: branchCode,
      period_id: null,
      file_name: fileName ?? null,
      status: 'failed',
      error_message: `Cabang dengan kode "${branchCode}" tidak ditemukan.`,
    });
    return NextResponse.json({ error: `Cabang dengan kode "${branchCode}" tidak ditemukan.` }, { status: 404 });
  }

  // --- Resolusi periode berjalan (sama seperti alur interaktif) ----------
  const { data: periodRaw, error: periodError } = await supabase.rpc('ensure_current_period');
  const period = Array.isArray(periodRaw) ? periodRaw[0] : periodRaw;

  if (periodError || !period) {
    await logSyncRun(supabase, {
      branch_id: branch.id,
      branch_code: branch.code,
      period_id: null,
      file_name: fileName ?? null,
      status: 'failed',
      error_message: `Gagal menentukan periode berjalan: ${periodError?.message ?? 'tidak diketahui'}`,
    });
    return NextResponse.json({ error: 'Gagal menentukan periode berjalan.' }, { status: 500 });
  }

  // --- Salesman aktif milik cabang ini ------------------------------------
  const { data: salesmenRows } = await supabase
    .from('salesmen')
    .select('id, name')
    .eq('branch_id', branch.id)
    .eq('is_active', true);
  const salesmen = (salesmenRows ?? []).map((s: any) => ({ id: s.id, name: s.name }));

  // --- Decode & parsing file ----------------------------------------------
  let buffer: ArrayBuffer;
  try {
    const bin = Buffer.from(fileContentBase64, 'base64');
    buffer = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
  } catch {
    await logSyncRun(supabase, {
      branch_id: branch.id,
      branch_code: branch.code,
      period_id: period.id,
      file_name: fileName ?? null,
      status: 'failed',
      error_message: 'fileContentBase64 tidak valid (gagal decode base64).',
    });
    return NextResponse.json({ error: 'fileContentBase64 tidak valid.' }, { status: 400 });
  }

  let parsed;
  try {
    parsed = parseBranchTemplate(buffer, {
      salesmen,
      branchCode: branch.code,
      branchName: branch.name,
      year: period.year,
      month: period.month,
    });
  } catch (err: any) {
    await logSyncRun(supabase, {
      branch_id: branch.id,
      branch_code: branch.code,
      period_id: period.id,
      file_name: fileName ?? null,
      status: 'failed',
      error_message: `Gagal membaca file: ${err?.message ?? 'format tidak dikenali'}`,
    });
    return NextResponse.json({ error: `Gagal membaca file: ${err?.message ?? 'format tidak dikenali'}` }, { status: 400 });
  }

  // Error level = file tidak bisa dipercaya sama sekali (mis. salah cabang,
  // sheet tidak ditemukan) — jangan lanjut simpan apa pun. Warning level
  // tetap lanjut, cukup dicatat untuk ditinjau.
  const blockingIssues = parsed.issues.filter((i) => i.level === 'error');
  if (blockingIssues.length > 0) {
    await logSyncRun(supabase, {
      branch_id: branch.id,
      branch_code: branch.code,
      period_id: period.id,
      file_name: fileName ?? null,
      status: 'failed',
      parse_issues: parsed.issues,
      error_message: blockingIssues.map((i) => i.message).join('; '),
    });
    return NextResponse.json(
      { error: 'File tidak dapat diproses.', issues: parsed.issues },
      { status: 400 },
    );
  }

  // --- Simpan lewat jalur validasi yang sama dengan grid/upload manual ---
  const normalize = (v: Record<string, number | null | undefined>): Record<string, number | null> =>
    Object.fromEntries(Object.entries(v).map(([k, val]) => [k, val ?? null]));

  const result = await saveEntries({
    supabase,
    actor: null,
    periodId: period.id,
    branchId: branch.id,
    rows: parsed.rows.map((r) => ({ salesmanId: r.salesmanId, values: normalize(r.values) })),
    branchValues: parsed.branchValues ? normalize(parsed.branchValues) : undefined,
    source: 'power_automate',
    allowPartialOnConflict: true,
  });

  if (!result.ok) {
    await logSyncRun(supabase, {
      branch_id: branch.id,
      branch_code: branch.code,
      period_id: period.id,
      file_name: fileName ?? null,
      status: 'failed',
      parse_issues: parsed.issues.length ? parsed.issues : null,
      error_message: result.error ?? 'Gagal menyimpan tanpa keterangan.',
    });
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  await logSyncRun(supabase, {
    branch_id: branch.id,
    branch_code: branch.code,
    period_id: period.id,
    file_name: fileName ?? null,
    status: result.skipped > 0 ? 'partial' : 'ok',
    rows_parsed: parsed.rows.length,
    rows_saved: result.changed,
    rows_skipped: result.skipped,
    parse_issues: parsed.issues.length ? parsed.issues : null,
    skipped_fields: result.conflicts.length ? result.conflicts : null,
  });

  return NextResponse.json({
    ok: true,
    changed: result.changed,
    revisions: result.revisions,
    skipped: result.skipped,
    skippedFields: result.conflicts,
  });
}
