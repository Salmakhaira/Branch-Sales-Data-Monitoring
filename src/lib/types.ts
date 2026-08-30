export type UserRole = 'cabang' | 'ho_pic' | 'admin';

export interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  role: UserRole;
  branch_id: string | null;
  is_active: boolean;
}

export interface Area {
  id: string;
  code: string;
  name: string;
  sort_order: number;
}

export interface Branch {
  id: string;
  code: string;
  name: string;
  area_id: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface Salesman {
  id: string;
  branch_id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}

export interface Period {
  id: string;
  year: number;
  month: number;
  /** Minggu berjalan. Bila auto_week true, nilai ini sudah diselesaikan
   *  dari tanggal hari ini oleh withResolvedWeek() di src/lib/period.ts. */
  current_week: number;
  /** true = minggu mengikuti kalender; false = override manual admin. */
  auto_week: boolean;
  is_open: boolean;
}

export interface ReportEntry {
  id: string;
  period_id: string;
  branch_id: string;
  salesman_id: string;
  values: Record<string, number | null>;
  updated_at: string;
  updated_by: string | null;
}

export interface ReportSnapshot {
  id: string;
  period_id: string;
  branch_id: string;
  salesman_id: string;
  week_no: number;
  values: Record<string, number | null>;
  submitted_at: string;
}

/** Data tingkat cabang: PLAN SALES MASTER, OL MIN PRTM, ACTUAL SALES —
 *  satu baris per cabang per periode, TIDAK per salesman (lihat metrics.ts). */
export interface BranchEntry {
  id: string;
  period_id: string;
  branch_id: string;
  values: Record<string, number | null>;
  updated_at: string;
  updated_by: string | null;
}

export interface BranchSnapshot {
  id: string;
  period_id: string;
  branch_id: string;
  week_no: number;
  values: Record<string, number | null>;
  submitted_at: string;
}

export interface EntryRevision {
  id: string;
  entry_id: string;
  period_id: string;
  branch_id: string;
  salesman_id: string;
  field_key: string;
  field_label: string | null;
  old_value: number | null;
  new_value: number | null;
  delta: number | null;
  requires_reason: boolean;
  reason_category: string | null;
  reason: string | null;
  locked_week: number | null;
  source: 'grid' | 'excel_upload' | 'admin';
  changed_by: string | null;
  changed_at: string;
  review_status: 'open' | 'acknowledged' | 'flagged' | null;
  review_note: string | null;
}

export interface RevisionMonitorRow {
  id: string;
  period_id: string;
  year: number;
  month: number;
  branch_code: string;
  branch_name: string;
  area_code: string | null;
  salesman_name: string;
  is_branch_level: boolean;
  field_key: string;
  field_label: string | null;
  old_value: number | null;
  new_value: number | null;
  delta: number | null;
  locked_week: number | null;
  reason_category: string | null;
  reason: string | null;
  source: string;
  review_status: 'open' | 'acknowledged' | 'flagged' | null;
  review_note: string | null;
  changed_at: string;
  changed_by_name: string | null;
}

/** Payload yang dikirim grid / uploader ke API. */
export interface SaveRequest {
  periodId: string;
  branchId: string;
  rows: Array<{
    salesmanId: string;
    values: Record<string, number | null>;
  }>;
  /** PLAN SALES MASTER / OL MIN PRTM / ACTUAL SALES — satu set nilai untuk
   *  seluruh cabang, bukan per salesman. Opsional: hanya dikirim saat
   *  panel "Data Tingkat Cabang" ikut disimpan. */
  branchValues?: Record<string, number | null>;
  // key salesman: `${salesmanId}:${fieldKey}` — key cabang: `branch:${fieldKey}`
  reasons?: Record<string, { category: string; reason: string }>;
  source?: 'grid' | 'excel_upload' | 'admin';
}

export interface SaveConflict {
  /** 'branch' untuk konflik pada data tingkat cabang (bukan salesman asli). */
  salesmanId: string;
  salesmanName: string;
  fieldKey: string;
  fieldLabel: string;
  oldValue: number | null;
  newValue: number | null;
  lockedWeek: number | null;
}
