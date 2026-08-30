import { createClient } from '@/lib/supabase/server';
import { withResolvedWeek } from '@/lib/period';
import type {
  Area,
  Branch,
  BranchEntry,
  BranchSnapshot,
  Period,
  ReportEntry,
  ReportSnapshot,
  Salesman,
} from '@/lib/types';

/**
 * Periode yang sedang ditampilkan.
 *
 *  - Bila periodId diberikan (dari pemilih periode), itu yang dipakai.
 *  - Bila tidak, dipakai periode BULAN BERJALAN. Periode itu dibuat
 *    otomatis oleh fungsi ensure_current_period() bila belum ada,
 *    sehingga admin tidak perlu membuatnya tiap awal bulan.
 *
 * Nilai current_week yang dikembalikan SUDAH diselesaikan — bila periode
 * memakai mode otomatis, minggunya dihitung dari tanggal hari ini.
 */
export async function getActivePeriod(periodId?: string): Promise<Period | null> {
  const supabase = createClient();

  if (periodId) {
    const { data } = await supabase.from('periods').select('*').eq('id', periodId).single();
    return data ? withResolvedWeek(data as Period) : null;
  }

  const { data, error } = await supabase.rpc('ensure_current_period');
  if (!error && data) {
    const row = Array.isArray(data) ? data[0] : data;
    if (row) return withResolvedWeek(row as Period);
  }

  // Cadangan: bila migrasi 003 belum dijalankan, fungsi di atas belum ada.
  // Pakai perilaku lama supaya aplikasi tetap jalan.
  return getLatestPeriodFallback();
}

async function getLatestPeriodFallback(): Promise<Period | null> {
  const supabase = createClient();

  const { data: open } = await supabase
    .from('periods')
    .select('*')
    .eq('is_open', true)
    .order('year', { ascending: false })
    .order('month', { ascending: false })
    .limit(1);

  if (open && open.length) return withResolvedWeek(open[0] as Period);

  const { data: latest } = await supabase
    .from('periods')
    .select('*')
    .order('year', { ascending: false })
    .order('month', { ascending: false })
    .limit(1);

  return latest?.[0] ? withResolvedWeek(latest[0] as Period) : null;
}

/** Semua periode, minggunya sudah diselesaikan. */
export async function listPeriods(): Promise<Period[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from('periods')
    .select('*')
    .order('year', { ascending: false })
    .order('month', { ascending: false });
  return ((data as Period[]) ?? []).map((p) => withResolvedWeek(p));
}

export async function listAreas(): Promise<Area[]> {
  const supabase = createClient();
  const { data } = await supabase.from('areas').select('*').order('sort_order');
  return (data as Area[]) ?? [];
}

export async function listBranches(): Promise<Branch[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from('branches')
    .select('*')
    .eq('is_active', true)
    .order('sort_order');
  return (data as Branch[]) ?? [];
}

export async function listSalesmen(branchId?: string): Promise<Salesman[]> {
  const supabase = createClient();
  let q = supabase.from('salesmen').select('*').eq('is_active', true).order('sort_order');
  if (branchId) q = q.eq('branch_id', branchId);
  const { data } = await q;
  return (data as Salesman[]) ?? [];
}

export async function listEntries(periodId: string, branchId?: string): Promise<ReportEntry[]> {
  const supabase = createClient();
  let q = supabase.from('report_entries').select('*').eq('period_id', periodId);
  if (branchId) q = q.eq('branch_id', branchId);
  const { data } = await q;
  return (data as ReportEntry[]) ?? [];
}

/**
 * Snapshot terakhir (minggu terbesar) per salesman.
 * Dipakai untuk: (a) mendeteksi perubahan, (b) kolom "OL Revenue last week".
 */
export async function getLatestSnapshots(
  periodId: string,
  branchId?: string,
): Promise<Map<string, ReportSnapshot>> {
  const supabase = createClient();
  let q = supabase
    .from('report_snapshots')
    .select('*')
    .eq('period_id', periodId)
    .order('week_no', { ascending: true });
  if (branchId) q = q.eq('branch_id', branchId);

  const { data } = await q;
  const map = new Map<string, ReportSnapshot>();
  for (const s of (data as ReportSnapshot[]) ?? []) {
    map.set(s.salesman_id, s); // urutan ascending -> yang terakhir menang
  }
  return map;
}

/**
 * Snapshot minggu TEPAT SEBELUM minggu yang sedang dilaporkan.
 *
 * Dipakai untuk kolom "TOTAL OL REVENUE LAST WEEK". Kalau cabang sedang
 * mengisi Minggu 3, pembandingnya harus laporan Minggu 2 — bukan sekadar
 * snapshot terakhir, yang bisa saja Minggu 4 kalau mereka mengisi mundur.
 *
 * Bila Minggu (n-1) tidak ada (mis. cabang melewatkan satu minggu),
 * dipakai minggu terdekat yang lebih kecil.
 */
export async function getSnapshotsBeforeWeek(
  periodId: string,
  branchId: string,
  week: number,
): Promise<Map<string, ReportSnapshot>> {
  const supabase = createClient();
  const { data } = await supabase
    .from('report_snapshots')
    .select('*')
    .eq('period_id', periodId)
    .eq('branch_id', branchId)
    .lt('week_no', week)
    .order('week_no', { ascending: true });

  const map = new Map<string, ReportSnapshot>();
  for (const s of (data as ReportSnapshot[]) ?? []) {
    map.set(s.salesman_id, s); // ascending -> minggu terbesar yang < week menang
  }
  return map;
}

/** Minggu terakhir yang sudah di-submit oleh satu cabang. Null = belum pernah. */
export async function getLastSubmittedWeek(
  periodId: string,
  branchId: string,
): Promise<number | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from('branch_submissions')
    .select('week_no')
    .eq('period_id', periodId)
    .eq('branch_id', branchId)
    .order('week_no', { ascending: false })
    .limit(1);
  return data?.[0]?.week_no ?? null;
}

/* --------------------------------------------------------------------
 * DATA TINGKAT CABANG (PLAN SALES MASTER / OL MIN PRTM / ACTUAL SALES)
 * Satu baris per cabang per periode — bukan per salesman. Lihat
 * src/lib/metrics.ts (BRANCH_INPUT_KEYS) untuk daftar kolomnya.
 * ------------------------------------------------------------------ */

/** Nilai tingkat cabang untuk SATU cabang (dipakai di halaman Input). */
export async function getBranchEntry(
  periodId: string,
  branchId: string,
): Promise<BranchEntry | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from('report_branch_entries')
    .select('*')
    .eq('period_id', periodId)
    .eq('branch_id', branchId)
    .maybeSingle();
  return (data as BranchEntry) ?? null;
}

/** Nilai tingkat cabang untuk SEMUA cabang (dipakai di Ringkasan/Rekap Nasional). */
export async function listBranchEntries(periodId: string): Promise<Map<string, BranchEntry>> {
  const supabase = createClient();
  const { data } = await supabase
    .from('report_branch_entries')
    .select('*')
    .eq('period_id', periodId);
  const map = new Map<string, BranchEntry>();
  for (const e of (data as BranchEntry[]) ?? []) map.set(e.branch_id, e);
  return map;
}

/** Snapshot tingkat cabang TERAKHIR — pembanding aturan wajib-alasan. */
export async function getLatestBranchSnapshot(
  periodId: string,
  branchId: string,
): Promise<BranchSnapshot | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from('report_branch_snapshots')
    .select('*')
    .eq('period_id', periodId)
    .eq('branch_id', branchId)
    .order('week_no', { ascending: false })
    .limit(1);
  return (data?.[0] as BranchSnapshot) ?? null;
}

/** Snapshot tingkat cabang TEPAT SEBELUM minggu yang sedang dilaporkan —
 *  sumber "TOTAL OL REVENUE LAST WEEK" bila suatu saat dibutuhkan di
 *  tingkat cabang juga. Sama logikanya dengan getSnapshotsBeforeWeek(). */
export async function getBranchSnapshotBeforeWeek(
  periodId: string,
  branchId: string,
  week: number,
): Promise<BranchSnapshot | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from('report_branch_snapshots')
    .select('*')
    .eq('period_id', periodId)
    .eq('branch_id', branchId)
    .lt('week_no', week)
    .order('week_no', { ascending: false })
    .limit(1);
  return (data?.[0] as BranchSnapshot) ?? null;
}

/** Status submit seluruh cabang pada satu periode (untuk dashboard HO). */
export async function getSubmissionMatrix(
  periodId: string,
): Promise<Map<string, { weeks: number[]; lastAt: string | null }>> {
  const supabase = createClient();
  const { data } = await supabase
    .from('branch_submissions')
    .select('branch_id, week_no, submitted_at')
    .eq('period_id', periodId);

  const map = new Map<string, { weeks: number[]; lastAt: string | null }>();
  for (const row of (data as { branch_id: string; week_no: number; submitted_at: string }[]) ?? []) {
    const cur = map.get(row.branch_id) ?? { weeks: [], lastAt: null };
    cur.weeks.push(row.week_no);
    if (!cur.lastAt || row.submitted_at > cur.lastAt) cur.lastAt = row.submitted_at;
    map.set(row.branch_id, cur);
  }
  return map;
}
