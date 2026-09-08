import type { SupabaseClient } from '@supabase/supabase-js';
import {
  BRANCH_INPUT_KEYS,
  METRIC_BY_KEY,
  MIN_REASON_LENGTH,
  SALESMAN_INPUT_KEYS,
  diffAgainstSnapshot,
} from '@/lib/metrics';
import type { SaveConflict, UserRole } from '@/lib/types';

/* =====================================================================
 *  saveEntries()
 *
 *  Inti aturan bisnis penyimpanan data report — diekstrak dari
 *  /api/entries supaya bisa dipakai DUA jalur dengan kode yang PERSIS
 *  SAMA, bukan cuma mirip:
 *
 *   1. POST /api/entries        — grid manual & upload Excel manual,
 *      dipanggil user yang login (actor terisi, RLS client biasa).
 *   2. POST /api/webhook/onedrive-sync — Power Automate, tidak ada
 *      sesi login sama sekali (actor null, service-role client).
 *
 *  Perbedaan perilaku HANYA pada dua hal, dikendalikan oleh parameter
 *  eksplisit — bukan ditebak dari ada/tidaknya actor:
 *
 *   - Otorisasi role (cabang hanya boleh isi cabang sendiri, ho_pic
 *     read-only) DILEWATI bila actor null, karena di jalur webhook
 *     otorisasinya sudah terjadi lebih dulu lewat secret key di route
 *     handler-nya, bukan di sini.
 *   - allowPartialOnConflict: bila true, sel yang butuh alasan tapi
 *     tidak diberikan CUKUP DILEWATI (dikembalikan ke nilai lama, dicatat
 *     sebagai skipped) — sisanya tetap tersimpan. Bila false (default,
 *     dipakai jalur interaktif), perilakunya SAMA PERSIS seperti semula:
 *     seluruh request ditolak 409 supaya frontend menampilkan modal
 *     alasan. Kami TIDAK PERNAH mengarang alasan otomatis atas nama
 *     sistem — itu akan melemahkan jejak audit yang justru menjadi inti
 *     sistem ini.
 * =================================================================== */

export interface SaveEntriesActor {
  id: string;
  role: UserRole;
  branch_id?: string | null;
}

export interface SaveEntriesInput {
  supabase: SupabaseClient;
  /** null = pemanggil sistem otomatis (Power Automate) — bukan user login. */
  actor: SaveEntriesActor | null;
  periodId: string;
  branchId: string;
  rows: Array<{ salesmanId: string; values: Record<string, number | null> }>;
  branchValues?: Record<string, number | null>;
  reasons?: Record<string, { category: string; reason: string }>;
  source?: 'grid' | 'excel_upload' | 'admin' | 'power_automate';
  allowPartialOnConflict?: boolean;
}

export interface SaveEntriesResult {
  ok: boolean;
  status: number;
  error?: string;
  message?: string;
  changed: number;
  revisions: number;
  withReason: number;
  skipped: number;
  conflicts: SaveConflict[];
  lastSubmittedWeek?: number | null;
}

export async function saveEntries(input: SaveEntriesInput): Promise<SaveEntriesResult> {
  const {
    supabase,
    actor,
    periodId,
    branchId,
    rows,
    branchValues,
    reasons = {},
    source = 'grid',
    allowPartialOnConflict = false,
  } = input;

  if (!periodId || !branchId || !Array.isArray(rows)) {
    return {
      ok: false,
      status: 400,
      error: 'periodId, branchId, dan rows wajib diisi.',
      changed: 0,
      revisions: 0,
      withReason: 0,
      skipped: 0,
      conflicts: [],
    };
  }

  // --- Otorisasi (dilewati untuk actor null / pemanggil sistem) --------
  if (actor) {
    if (actor.role === 'ho_pic') {
      return {
        ok: false,
        status: 403,
        error: 'PIC Head Office hanya memiliki akses baca (monitoring).',
        changed: 0,
        revisions: 0,
        withReason: 0,
        skipped: 0,
        conflicts: [],
      };
    }
    if (actor.role === 'cabang' && actor.branch_id !== branchId) {
      return {
        ok: false,
        status: 403,
        error: 'Anda hanya dapat mengisi data cabang Anda sendiri.',
        changed: 0,
        revisions: 0,
        withReason: 0,
        skipped: 0,
        conflicts: [],
      };
    }
  }

  // --- Periode masih dibuka? -------------------------------------------
  const { data: period } = await supabase
    .from('periods')
    .select('id, year, month, current_week, is_open')
    .eq('id', periodId)
    .single();

  if (!period) {
    return {
      ok: false,
      status: 404,
      error: 'Periode tidak ditemukan.',
      changed: 0,
      revisions: 0,
      withReason: 0,
      skipped: 0,
      conflicts: [],
    };
  }
  const isAdminActor = actor?.role === 'admin';
  if (!period.is_open && !isAdminActor) {
    return {
      ok: false,
      status: 423,
      error: 'Periode ini sudah ditutup. Hubungi Administrator.',
      changed: 0,
      revisions: 0,
      withReason: 0,
      skipped: 0,
      conflicts: [],
    };
  }

  // --- Minggu terakhir yang sudah di-submit cabang ini ------------------
  const { data: subs } = await supabase
    .from('branch_submissions')
    .select('week_no')
    .eq('period_id', periodId)
    .eq('branch_id', branchId)
    .order('week_no', { ascending: false })
    .limit(1);
  const lastSubmittedWeek: number | null = subs?.[0]?.week_no ?? null;

  // --- Data existing & snapshot -----------------------------------------
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

  // --- Data tingkat cabang & snapshotnya ---------------------------------
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

  const salesmanIds = rows.map((r) => r.salesmanId);
  const { data: salesmen } = await supabase
    .from('salesmen')
    .select('id, name, branch_id')
    .in('id', salesmanIds.length ? salesmanIds : ['00000000-0000-0000-0000-000000000000']);
  const nameById = new Map<string, string>((salesmen ?? []).map((s: any) => [s.id, s.name]));

  for (const s of (salesmen ?? []) as any[]) {
    if (s.branch_id !== branchId) {
      return {
        ok: false,
        status: 400,
        error: `Salesman "${s.name}" bukan bagian dari cabang ini.`,
        changed: 0,
        revisions: 0,
        withReason: 0,
        skipped: 0,
        conflicts: [],
      };
    }
  }

  // --- Hitung perubahan & cek kebutuhan alasan ---------------------------
  const conflicts: SaveConflict[] = [];
  let skippedCount = 0;

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
    updated_by: string | null;
    updated_at: string;
  }> = [];

  for (const row of rows) {
    const prev = existingBySalesman.get(row.salesmanId)?.values ?? {};
    const snapshot = snapshotBySalesman.get(row.salesmanId) ?? null;

    const cleaned: Record<string, number | null> = { ...prev };
    for (const key of SALESMAN_INPUT_KEYS) {
      if (Object.prototype.hasOwnProperty.call(row.values, key)) {
        const raw = row.values[key];
        cleaned[key] =
          raw === null || raw === undefined || !Number.isFinite(Number(raw)) ? null : Number(raw);
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
          if (allowPartialOnConflict) {
            // Jalur otomatis: lewati SEL INI SAJA, jangan gagalkan file.
            cleaned[c.key] = (prev[c.key] as number | null) ?? null;
            skippedCount += 1;
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
      updated_by: actor?.id ?? null,
      updated_at: new Date().toISOString(),
    });
  }

  // --- Data tingkat cabang -----------------------------------------------
  type PendingBranchRevision = Omit<PendingRevision, 'salesmanId'>;
  const branchPendingRevisions: PendingBranchRevision[] = [];
  let cleanedBranchValues: Record<string, number | null> | null = null;

  if (branchValues && typeof branchValues === 'object') {
    const prevBranch = (existingBranchEntry?.values as Record<string, number | null>) ?? {};
    const cleaned: Record<string, number | null> = { ...prevBranch };
    for (const key of BRANCH_INPUT_KEYS) {
      if (Object.prototype.hasOwnProperty.call(branchValues, key)) {
        const raw = branchValues[key];
        cleaned[key] =
          raw === null || raw === undefined || !Number.isFinite(Number(raw)) ? null : Number(raw);
      }
    }

    const changes = diffAgainstSnapshot(prevBranch, cleaned, branchSnapshot, lastSubmittedWeek);
    if (changes.length) {
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
            if (allowPartialOnConflict) {
              cleaned[c.key] = (prevBranch[c.key] as number | null) ?? null;
              skippedCount += 1;
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

      cleanedBranchValues = cleaned;
    }
  }

  // --- Ada konflik yang MEMBLOKIR (bukan mode partial) -> tolak ----------
  if (!allowPartialOnConflict && conflicts.length) {
    return {
      ok: false,
      status: 409,
      error: 'reason_required',
      message:
        'Beberapa angka yang sudah dilaporkan pada minggu sebelumnya berubah. ' +
        'Isi alasan perubahan terlebih dahulu.',
      conflicts,
      lastSubmittedWeek,
      changed: 0,
      revisions: 0,
      withReason: 0,
      skipped: 0,
    };
  }

  if (!upserts.length && !cleanedBranchValues) {
    return {
      ok: true,
      status: 200,
      message: 'Tidak ada perubahan.',
      changed: 0,
      revisions: 0,
      withReason: 0,
      skipped: skippedCount,
      conflicts: allowPartialOnConflict ? conflicts : [],
    };
  }

  // --- Simpan (per salesman) ----------------------------------------------
  let entryIdBySalesman = new Map<string, string>();
  if (upserts.length) {
    const { data: saved, error: saveError } = await supabase
      .from('report_entries')
      .upsert(upserts, { onConflict: 'period_id,salesman_id' })
      .select('id, salesman_id');

    if (saveError) {
      return {
        ok: false,
        status: 500,
        error: saveError.message,
        changed: 0,
        revisions: 0,
        withReason: 0,
        skipped: skippedCount,
        conflicts: [],
      };
    }
    entryIdBySalesman = new Map<string, string>((saved ?? []).map((e: any) => [e.salesman_id, e.id]));
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
      reason_status: r.requiresReason ? 'provided' : 'not_required',
      reason_category: r.reasonCategory,
      reason: r.reason,
      locked_week: r.lockedWeek,
      source,
      changed_by: actor?.id ?? null,
    }));

    const { error: revError } = await supabase.from('entry_revisions').insert(revisionRows);
    if (revError) {
      return {
        ok: false,
        status: 500,
        error: `Data tersimpan, tapi jejak audit gagal dicatat: ${revError.message}`,
        changed: upserts.length,
        revisions: 0,
        withReason: 0,
        skipped: skippedCount,
        conflicts: [],
      };
    }
  }

  // --- Simpan (tingkat cabang) ---------------------------------------------
  if (cleanedBranchValues) {
    const { data: savedBranch, error: branchSaveError } = await supabase
      .from('report_branch_entries')
      .upsert(
        {
          period_id: periodId,
          branch_id: branchId,
          values: cleanedBranchValues,
          updated_by: actor?.id ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'period_id,branch_id' },
      )
      .select('id')
      .single();

    if (branchSaveError) {
      return {
        ok: false,
        status: 500,
        error: branchSaveError.message,
        changed: upserts.length,
        revisions: pendingRevisions.length,
        withReason: pendingRevisions.filter((r) => r.requiresReason).length,
        skipped: skippedCount,
        conflicts: [],
      };
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
        changed_by: actor?.id ?? null,
      }));

      const { error: revError } = await supabase.from('entry_revisions').insert(branchRevisionRows);
      if (revError) {
        return {
          ok: false,
          status: 500,
          error: `Data tersimpan, tapi jejak audit gagal dicatat: ${revError.message}`,
          changed: upserts.length + 1,
          revisions: pendingRevisions.length,
          withReason: pendingRevisions.filter((r) => r.requiresReason).length,
          skipped: skippedCount,
          conflicts: [],
        };
      }
    }
  }

  const totalRevisions = pendingRevisions.length + branchPendingRevisions.length;
  const totalWithReason =
    pendingRevisions.filter((r) => r.requiresReason).length +
    branchPendingRevisions.filter((r) => r.requiresReason).length;

  return {
    ok: true,
    status: 200,
    changed: upserts.length + (cleanedBranchValues ? 1 : 0),
    revisions: totalRevisions,
    withReason: totalWithReason,
    skipped: skippedCount,
    conflicts: allowPartialOnConflict ? conflicts : [],
  };
}
