import type { SupabaseClient } from '@supabase/supabase-js';
import { jakartaToday, weekOfMonth } from '@/lib/period';
import type { UserRole } from '@/lib/types';

export interface SubmitWeekActor {
  id: string;
  role: UserRole;
  branch_id?: string | null;
}

export interface SubmitWeekInput {
  supabase: SupabaseClient;
  actor: SubmitWeekActor | null;
  periodId: string;
  branchId: string;
  week: number;
  note?: string;
  allowAlreadySubmitted?: boolean;
}

export interface SubmitWeekResult {
  ok: boolean;
  status: number;
  error?: string;
  week?: number;
  rows?: number;
  alreadySubmitted?: boolean;
}

export async function submitWeek(input: SubmitWeekInput): Promise<SubmitWeekResult> {
  const { supabase, actor, periodId, branchId, week, note, allowAlreadySubmitted = false } = input;

  if (actor?.role === 'ho_pic') {
    return { ok: false, status: 403, error: 'PIC Head Office tidak melakukan submit.' };
  }
  if (actor?.role === 'cabang' && actor.branch_id !== branchId) {
    return { ok: false, status: 403, error: 'Bukan cabang Anda.' };
  }

  const { data: period } = await supabase
    .from('periods')
    .select('id, year, month, is_open')
    .eq('id', periodId)
    .single();

  if (!period) return { ok: false, status: 404, error: 'Periode tidak ditemukan.' };
  if (!period.is_open && actor?.role !== 'admin') {
    return { ok: false, status: 423, error: 'Periode sudah ditutup.' };
  }

  const today = jakartaToday();
  const isCurrentMonth = period.year === today.year && period.month === today.month;
  const isFutureMonth = period.year * 100 + period.month > today.year * 100 + today.month;

  if (isFutureMonth) {
    return { ok: false, status: 400, error: 'Periode ini belum dimulai, jadi belum bisa di-submit.' };
  }

  const maxWeek = isCurrentMonth ? weekOfMonth(today.day) : 4;
  const requested = Number(week);

  if (!Number.isInteger(requested) || requested < 1 || requested > 4) {
    return { ok: false, status: 400, error: 'Minggu harus antara 1 dan 4.' };
  }
  if (requested > maxWeek) {
    return {
      ok: false,
      status: 400,
      error: `Minggu ${requested} belum tiba — hari ini masih Minggu ${maxWeek}.`,
    };
  }

  const { data: dup } = await supabase
    .from('branch_submissions')
    .select('id')
    .eq('period_id', periodId)
    .eq('branch_id', branchId)
    .eq('week_no', requested)
    .maybeSingle();

  if (dup) {
    if (allowAlreadySubmitted) {
      return { ok: true, status: 200, week: requested, rows: 0, alreadySubmitted: true };
    }
    return {
      ok: false,
      status: 409,
      error: `Cabang ini sudah submit untuk Minggu ${requested}.`,
    };
  }

  const { data: entries, error: readErr } = await supabase
    .from('report_entries')
    .select('salesman_id, values')
    .eq('period_id', periodId)
    .eq('branch_id', branchId);

  if (readErr) return { ok: false, status: 500, error: readErr.message };
  if (!entries?.length) {
    return { ok: false, status: 400, error: 'Belum ada data yang bisa di-submit.' };
  }

  const submittedBy = actor?.id ?? null;

  const snapshotRows = entries.map((e: { salesman_id: string; values: unknown }) => ({
    period_id: periodId,
    branch_id: branchId,
    salesman_id: e.salesman_id,
    week_no: requested,
    values: e.values ?? {},
    submitted_by: submittedBy,
  }));

  const { error: snapErr } = await supabase.from('report_snapshots').insert(snapshotRows);
  if (snapErr) return { ok: false, status: 500, error: snapErr.message };

  const { data: branchEntry } = await supabase
    .from('report_branch_entries')
    .select('values')
    .eq('period_id', periodId)
    .eq('branch_id', branchId)
    .maybeSingle();

  if (branchEntry) {
    const { error: branchSnapErr } = await supabase.from('report_branch_snapshots').insert({
      period_id: periodId,
      branch_id: branchId,
      week_no: requested,
      values: branchEntry.values ?? {},
      submitted_by: submittedBy,
    });
    if (branchSnapErr) return { ok: false, status: 500, error: branchSnapErr.message };
  }

  const { error: subErr } = await supabase.from('branch_submissions').insert({
    period_id: periodId,
    branch_id: branchId,
    week_no: requested,
    submitted_by: submittedBy,
    note: note ?? null,
  });
  if (subErr) return { ok: false, status: 500, error: subErr.message };

  return { ok: true, status: 200, week: requested, rows: snapshotRows.length };
}
