import { NextResponse } from 'next/server';
import { createClient, getProfile } from '@/lib/supabase/server';
import {
  BRANCH_INPUT_KEYS,
  METRIC_BY_KEY,
  MIN_REASON_LENGTH,
  SALESMAN_INPUT_KEYS,
  diffAgainstSnapshot,
} from '@/lib/metrics';
import type { SaveConflict, SaveRequest } from '@/lib/types';

/* =====================================================================
 *  POST /api/entries
 *  Menyimpan perubahan data report satu cabang.
 *
 *  Inti aturan bisnis ada di sini:
 *
 *  1. Field yang termasuk "sudah pernah dilaporkan" (kolom bulanan, atau
 *     kolom mingguan W<=minggu terakhir yang di-submit) TIDAK BISA diubah
 *     tanpa alasan.
 *  2. Jika ada perubahan seperti itu tapi alasannya belum diisi, request
 *     ditolak dengan HTTP 409 + daftar sel yang butuh alasan. Frontend
 *     lalu menampilkan modal pengisian alasan.
 *  3. Setiap perubahan - dengan atau tanpa alasan - dicatat di
 *     entry_revisions sebagai jejak audit permanen.
 *
 *  Validasi ini dilakukan DI SERVER, bukan hanya di browser, sehingga
 *  tidak bisa dilewati lewat devtools atau request manual.
 * =================================================================== */

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) {
    return NextResponse.json({ error: 'Belum login.' }, { status: 401 });
  }

  let body: SaveRequest;
  try {
    body = (await request.json()) as SaveRequest;
  } catch {
    return NextResponse.json({ error: 'Payload tidak valid.' }, { status: 400 });
  }

  const { periodId, branchId, rows, branchValues, reasons = {}, source = 'grid' } = body;
  if (!periodId || !branchId || !Array.isArray(rows)) {
    return NextResponse.json({ error: 'periodId, branchId, dan rows wajib diisi.' }, { status: 400 });
  }

  // --- Otorisasi -----------------------------------------------------
  if (profile.role === 'ho_pic') {
    return NextResponse.json(
      { error: 'PIC Head Office hanya memiliki akses baca (monitoring).' },
      { status: 403 },
    );
  }
  if (profile.role === 'cabang' && profile.branch_id !== branchId) {
    return NextResponse.json(
      { error: 'Anda hanya dapat mengisi data cabang Anda sendiri.' },
      { status: 403 },
    );
  }

  const supabase = createClient();

  // --- Periode masih dibuka? -----------------------------------------
  const { data: period } = await supabase
    .from('periods')
    .select('id, year, month, current_week, is_open')
    .eq('id', periodId)
    .single();

  if (!period) {
    return NextResponse.json({ error: 'Periode tidak ditemukan.' }, { status: 404 });
  }
  if (!period.is_open && profile.role !== 'admin') {
    return NextResponse.json(
      { error: 'Periode ini sudah ditutup. Hubungi Administrator.' },
      { status: 423 },
    );
  }

  // --- Minggu terakhir yang sudah di-submit cabang ini ----------------
  const { data: subs } = await supabase
    .from('branch_submissions')
    .select('week_no')
    .eq('period_id', periodId)
    .eq('branch_id', branchId)
    .order('week_no', { ascending: false })
    .limit(1);
  const lastSubmittedWeek: number | null = subs?.[0]?.week_no ?? null;

  // --- Data existing & snapshot --------------------------------------
  const { data: existing } = await supabase
    .from('report_entries')
    .select('id, salesman_id, values')
    .eq('period_id', periodId)
    .eq('branch_id', branchId);

  const existingBySalesman = new Map<string, { id: string; values: Record<string, number | null> }>(
    (existing ?? []).map((e: any) => [e.salesman_id, { id: e.id, values: e.values ?? {} }]),
  );

  const { data: snaps } = await supabase
    .from('report_snapshots')
    .select('salesman_id, week_no, values')
    .eq('period_id', periodId)
    .eq('branch_id', branchId)
    .order('week_no', { ascending: true });

  const snapshotBySalesman = new Map<string, Record<string, number | null>>();
  for (const s of (snaps ?? []) as any[]) {
    snapshotBySalesman.set(s.salesman_id, s.values ?? {});
  }

  // --- Data tingkat cabang & snapshotnya (PLAN SALES MASTER dkk) ------
  const { data: existingBranchEntry } = await supabase
    .from('report_branch_entries')
    .select('id, values')
    .eq('period_id', periodId)
    .eq('branch_id', branchId)
    .maybeSingle();

  const { data: branchSnaps } = await supabase
    .from('report_branch_snapshots')
    .select('week_no, values')
    .eq('period_id', periodId)
    .eq('branch_id', branchId)
    .order('week_no', { ascending: true });
  const branchSnapshot =
    (branchSnaps ?? []).length > 0
      ? ((branchSnaps as any[])[branchSnaps!.length - 1].values as Record<string, number | null>)
      : null;

  // Nama salesman untuk pesan error yang informatif
  const salesmanIds = rows.map((r) => r.salesmanId);
  const { data: salesmen } = await supabase
    .from('salesmen')
    .select('id, name, branch_id')
    .in('id', salesmanIds.length ? salesmanIds : ['00000000-0000-0000-0000-000000000000']);
  const nameById = new Map<string, string>((salesmen ?? []).map((s: any) => [s.id, s.name]));

  // Pastikan semua salesman memang milik cabang ini
  for (const s of (salesmen ?? []) as any[]) {
    if (s.branch_id !== branchId) {
      return NextResponse.json(
        { error: `Salesman "${s.name}" bukan bagian dari cabang ini.` },
        { status: 400 },
      );
    }
  }

  // --- Hitung perubahan & cek kebutuhan alasan -----------------------
  const conflicts: SaveConflict[] = [];
  type PendingRevision = {
    salesmanId: string;
    fieldKey: string;
    fieldLabel: string;
    oldValue: number | null;
    newValue: number | null;
    requiresReason: boolean;
    lockedWeek: number | null;
    reasonCategory: string | null;
    reason: string | null;
  };
  const pendingRevisions: PendingRevision[] = [];
  const upserts: Array<{
    period_id: string;
    branch_id: string;
    salesman_id: string;
    values: Record<string, number | null>;
    updated_by: string;
    updated_at: string;
  }> = [];

  for (const row of rows) {
    const prev = existingBySalesman.get(row.salesmanId)?.values ?? {};
    const snapshot = snapshotBySalesman.get(row.salesmanId) ?? null;

    // Bersihkan payload: hanya kolom input PER SALESMAN yang diterima
    // (PLAN SALES MASTER/OL MIN PRTM/ACTUAL SALES ditangani terpisah di
    // bawah, sebagai data tingkat cabang). Kolom turunan diabaikan —
    // selalu dihitung ulang oleh sistem.
    const cleaned: Record<string, number | null> = { ...prev };
    for (const key of SALESMAN_INPUT_KEYS) {
      if (Object.prototype.hasOwnProperty.call(row.values, key)) {
        const raw = row.values[key];
        cleaned[key] = raw === null || raw === undefined || !Number.isFinite(Number(raw))
          ? null
          : Number(raw);
      }
    }

    const changes = diffAgainstSnapshot(prev, cleaned, snapshot, lastSubmittedWeek);
    if (!changes.length) continue;

    for (const c of changes) {
      const reasonKey = `${row.salesmanId}:${c.key}`;
      const provided = reasons[reasonKey];

      if (c.requiresReason) {
        const ok =
          provided &&
          typeof provided.reason === 'string' &&
          provided.reason.trim().length >= MIN_REASON_LENGTH &&
          typeof provided.category === 'string' &&
          provided.category.length > 0;

        if (!ok) {
          conflicts.push({
            salesmanId: row.salesmanId,
            salesmanName: nameById.get(row.salesmanId) ?? '(tidak dikenal)',
            fieldKey: c.key,
            fieldLabel: c.label,
            oldValue: c.oldValue,
            newValue: c.newValue,
            lockedWeek: c.lockedWeek,
          });
          continue;
        }
      }

      pendingRevisions.push({
        salesmanId: row.salesmanId,
        fieldKey: c.key,
        fieldLabel: METRIC_BY_KEY[c.key]?.label ?? c.key,
        oldValue: c.oldValue,
        newValue: c.newValue,
        requiresReason: c.requiresReason,
        lockedWeek: c.lockedWeek,
        reasonCategory: c.requiresReason ? provided!.category : provided?.category ?? null,
        reason: c.requiresReason ? provided!.reason.trim() : provided?.reason?.trim() ?? null,
      });
    }

    upserts.push({
      period_id: periodId,
      branch_id: branchId,
      salesman_id: row.salesmanId,
      values: cleaned,
      updated_by: profile.id,
      updated_at: new Date().toISOString(),
    });
  }

  // --- Data tingkat cabang (PLAN SALES MASTER / OL MIN PRTM / ACTUAL SALES) ---
  // Satu set nilai untuk seluruh cabang — bukan per salesman — jadi diperiksa
  // sekali di sini, terpisah dari loop per-salesman di atas, tapi dengan
  // aturan wajib-alasan yang identik.
  type PendingBranchRevision = Omit<PendingRevision, 'salesmanId'>;
  const branchPendingRevisions: PendingBranchRevision[] = [];
  let cleanedBranchValues: Record<string, number | null> | null = null;

  if (branchValues && typeof branchValues === 'object') {
    const prevBranch = (existingBranchEntry?.values as Record<string, number | null>) ?? {};
    const cleaned: Record<string, number | null> = { ...prevBranch };
    for (const key of BRANCH_INPUT_KEYS) {
      if (Object.prototype.hasOwnProperty.call(branchValues, key)) {
        const raw = branchValues[key];
        cleaned[key] = raw === null || raw === undefined || !Number.isFinite(Number(raw))
          ? null
          : Number(raw);
      }
    }

    const changes = diffAgainstSnapshot(prevBranch, cleaned, branchSnapshot, lastSubmittedWeek);
    if (changes.length) {
      cleanedBranchValues = cleaned;

      for (const c of changes) {
        const reasonKey = `branch:${c.key}`;
        const provided = reasons[reasonKey];

        if (c.requiresReason) {
          const ok =
            provided &&
            typeof provided.reason === 'string' &&
            provided.reason.trim().length >= MIN_REASON_LENGTH &&
            typeof provided.category === 'string' &&
            provided.category.length > 0;

          if (!ok) {
            conflicts.push({
              salesmanId: 'branch',
              salesmanName: 'Data Tingkat Cabang',
              fieldKey: c.key,
              fieldLabel: c.label,
              oldValue: c.oldValue,
              newValue: c.newValue,
              lockedWeek: c.lockedWeek,
            });
            continue;
          }
        }

        branchPendingRevisions.push({
          fieldKey: c.key,
          fieldLabel: METRIC_BY_KEY[c.key]?.label ?? c.key,
          oldValue: c.oldValue,
          newValue: c.newValue,
          requiresReason: c.requiresReason,
          lockedWeek: c.lockedWeek,
          reasonCategory: c.requiresReason ? provided!.category : provided?.category ?? null,
          reason: c.requiresReason ? provided!.reason.trim() : provided?.reason?.trim() ?? null,
        });
      }
    }
  }

  // --- Ada yang butuh alasan tapi belum diisi -> tolak ----------------
  if (conflicts.length) {
    return NextResponse.json(
      {
        error: 'reason_required',
        message:
          'Beberapa angka yang sudah dilaporkan pada minggu sebelumnya berubah. ' +
          'Isi alasan perubahan terlebih dahulu.',
        conflicts,
        lastSubmittedWeek,
      },
      { status: 409 },
    );
  }

  if (!upserts.length && !cleanedBranchValues) {
    return NextResponse.json({ ok: true, changed: 0, message: 'Tidak ada perubahan.' });
  }

  // --- Simpan (per salesman) ------------------------------------------
  let entryIdBySalesman = new Map<string, string>();
  if (upserts.length) {
    const { data: saved, error: saveError } = await supabase
      .from('report_entries')
      .upsert(upserts, { onConflict: 'period_id,salesman_id' })
      .select('id, salesman_id');

    if (saveError) {
      return NextResponse.json({ error: saveError.message }, { status: 500 });
    }
    entryIdBySalesman = new Map<string, string>(
      (saved ?? []).map((e: any) => [e.salesman_id, e.id]),
    );
  }

  if (pendingRevisions.length) {
    const revisionRows = pendingRevisions.map((r) => ({
      entry_id: entryIdBySalesman.get(r.salesmanId)!,
      period_id: periodId,
      branch_id: branchId,
      salesman_id: r.salesmanId,
      field_key: r.fieldKey,
      field_label: r.fieldLabel,
      old_value: r.oldValue,
      new_value: r.newValue,
      requires_reason: r.requiresReason,
      // Di mode website alasan selalu sudah terisi saat baris ini dibuat,
      // karena UI menolak menyimpan tanpanya.
      reason_status: r.requiresReason ? 'provided' : 'not_required',
      reason_category: r.reasonCategory,
      reason: r.reason,
      locked_week: r.lockedWeek,
      source,
      changed_by: profile.id,
    }));

    const { error: revError } = await supabase.from('entry_revisions').insert(revisionRows);
    if (revError) {
      return NextResponse.json(
        { error: `Data tersimpan, tapi jejak audit gagal dicatat: ${revError.message}` },
        { status: 500 },
      );
    }
  }

  // --- Simpan (tingkat cabang) -----------------------------------------
  if (cleanedBranchValues) {
    const { data: savedBranch, error: branchSaveError } = await supabase
      .from('report_branch_entries')
      .upsert(
        {
          period_id: periodId,
          branch_id: branchId,
          values: cleanedBranchValues,
          updated_by: profile.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'period_id,branch_id' },
      )
      .select('id')
      .single();

    if (branchSaveError) {
      return NextResponse.json({ error: branchSaveError.message }, { status: 500 });
    }

    if (branchPendingRevisions.length) {
      const branchRevisionRows = branchPendingRevisions.map((r) => ({
        branch_entry_id: savedBranch!.id,
        period_id: periodId,
        branch_id: branchId,
        field_key: r.fieldKey,
        field_label: r.fieldLabel,
        old_value: r.oldValue,
        new_value: r.newValue,
        requires_reason: r.requiresReason,
        reason_status: r.requiresReason ? 'provided' : 'not_required',
        reason_category: r.reasonCategory,
        reason: r.reason,
        locked_week: r.lockedWeek,
        source,
        changed_by: profile.id,
      }));

      const { error: revError } = await supabase.from('entry_revisions').insert(branchRevisionRows);
      if (revError) {
        return NextResponse.json(
          { error: `Data tersimpan, tapi jejak audit gagal dicatat: ${revError.message}` },
          { status: 500 },
        );
      }
    }
  }

  const totalRevisions = pendingRevisions.length + branchPendingRevisions.length;
  const totalWithReason =
    pendingRevisions.filter((r) => r.requiresReason).length +
    branchPendingRevisions.filter((r) => r.requiresReason).length;

  return NextResponse.json({
    ok: true,
    changed: upserts.length + (cleanedBranchValues ? 1 : 0),
    revisions: totalRevisions,
    withReason: totalWithReason,
  });
}
