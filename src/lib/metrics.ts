/* =====================================================================
 *  DEFINISI KOLOM MOS  +  MESIN PERHITUNGAN TURUNAN
 *  ---------------------------------------------------------------
 *  File ini adalah "single source of truth". Semua bagian aplikasi
 *  (grid input, parser Excel, rekap nasional, export) membaca dari sini.
 *
 *  Rumus di bawah adalah port 1:1 dari sheet MOS Excel:
 *    AF  TOTAL OL PRTM       = ACT PRTM W(n) + QUOT CONF W(n) >80% + PO NON SAP
 *    AH  BALANCE PRTM        = AF - AG
 *    AJ  TOTAL PO            = ACT PRTM W(n) + PO LAST MONTH by SAP
 *    AK  TOTAL PO OUTLOOK    = AF + PO LAST MONTH by SAP
 *    AT  OL REVENUE          = SUM(AL:AS)
 *    AY  TOTAL OL REVENUE    = SUM(AT:AX)
 *    BN  RATIO ACTUAL        = BM / PLAN SALES
 *
 *  URUTAN KOLOM di seluruh aplikasi mengikuti huruf kolom Excel pada
 *  field `excel` (lihat ORDERED_METRICS di bawah), sehingga susunannya
 *  sama persis dengan sheet MOS aslinya tanpa perlu daftar urutan
 *  terpisah yang gampang ketinggalan.
 *
 *  TIDAK DIPAKAI (dihapus atas permintaan pengguna): AZ TOTAL OL REVENUE
 *  LAST WEEK, BA DEFICIT FROM LAST WEEK, BD RATIO OL/PO. Karena ketiganya
 *  hilang, tidak ada lagi rumus yang butuh nilai snapshot minggu
 *  sebelumnya — itu sebabnya CalcContext hanya berisi `week`.
 * ===================================================================== */

export type MetricKind = 'input' | 'derived';
export type MetricScope = 'monthly' | 'weekly';
/** Tingkat pengisian: 'salesman' = diisi per salesman lalu dijumlah;
 *  'branch' = SATU angka untuk seluruh cabang (tidak dipecah per orang). */
export type MetricLevel = 'salesman' | 'branch';

export interface Metric {
  key: string;
  label: string;
  /** Judul grup, meniru header bertingkat di Excel */
  group: string;
  kind: MetricKind;
  scope: MetricScope;
  /** Diisi untuk scope 'weekly': 1..4 */
  week?: number;
  /** Referensi kolom Excel asal, untuk jejak audit & training user */
  excel?: string;
  /** Ditampilkan di grid input cabang */
  inGrid: boolean;
  /** Ditampilkan di tabel rekap nasional */
  inNational: boolean;
  /** Rumus untuk kind 'derived' */
  formula?: (v: ValueMap, ctx: CalcContext) => number;
  /** Format angka */
  format?: 'number' | 'percent';
  /** Keterangan singkat, muncul sebagai tooltip di grid */
  hint?: string;
  /** Default 'salesman'. Lihat MetricLevel. */
  level?: MetricLevel;
  /** Posisi kolom ini pada header BERTINGKAT TIGA di file MOS asli
   *  (Sampit.xlsx, sheet MOS baris 3-4-5). Dipakai template Excel supaya
   *  headernya sama persis dengan file yang biasa dipakai cabang:
   *    top  = baris 3 (judul grup besar, di-merge lebar)
   *    sub  = baris 4 (judul kolom; di-merge ke baris 5 bila tidak ada tier)
   *    tier = baris 5 (rincian, mis. '>80%' atau 'NOT ACTIVE')
   *  Bila sub kosong, judul top di-merge dari baris 3 sampai 5. */
  mos?: { top: string; sub?: string; tier?: string };
}

/** Judul grup baris 3 pada file MOS asli — dipakai untuk mewarnai header
 *  template persis seperti aslinya (lihat MOS_FILL di xlsx-styled.ts). */
export type MosTopGroup =
  | 'PLAN SALES MASTER'
  | 'OUTLOOK PRTM'
  | 'OUTLOOK REVENUE TM'
  | 'ACTUAL SALES';

export type ValueMap = Record<string, number | null | undefined>;

export interface CalcContext {
  /** Minggu berjalan (1..4). Menentukan kolom W mana yang dipakai rumus. */
  week: number;
}

const n = (x: number | null | undefined): number =>
  typeof x === 'number' && Number.isFinite(x) ? x : 0;

const div = (a: number, b: number): number => (b === 0 ? 0 : a / b);

/** Kolom mingguan yang dipakai rumus, mengikuti minggu berjalan. */
const wk = (base: string, ctx: CalcContext) => `${base}_w${Math.min(Math.max(ctx.week, 1), 4)}`;

/* --------------------------------------------------------------------
 * A. KOLOM INPUT (diisi cabang)
 * ------------------------------------------------------------------ */

const weeklyMetrics = (): Metric[] => {
  const out: Metric[] = [];
  const cols = ['O', 'P', 'Q', 'R'];
  for (let w = 1; w <= 4; w++) {
    out.push({
      key: `act_prtm_w${w}`,
      label: `ACT PRTM by SO SAP W${w}`,
      group: 'OUTLOOK PRTM',
      kind: 'input',
      scope: 'weekly',
      week: w,
      excel: cols[w - 1],
      inGrid: true,
      inNational: true,
      hint: 'Actual PRTM berdasarkan Sales Order di SAP pada minggu tersebut',
      mos: { top: 'OUTLOOK PRTM', sub: `ACT PRTM by SO SAP W${w}` },
    });
  }
  const confCols: Record<number, [string, string, string]> = {
    1: ['S', 'T', 'U'],
    2: ['V', 'W', 'X'],
    3: ['Y', 'Z', 'AA'],
    4: ['AB', 'AC', 'AD'],
  };
  for (let w = 1; w <= 4; w++) {
    const [c80, c5080, c50] = confCols[w];
    out.push({
      key: `quot_w${w}_80`,
      label: `QUOT CONF W${w} >80%`,
      group: 'QUOTATION CONFIDENCE',
      kind: 'input',
      scope: 'weekly',
      week: w,
      excel: c80,
      inGrid: true,
      inNational: true,
      mos: { top: 'OUTLOOK PRTM', sub: `QUOT CONFIDENCE W${w}`, tier: '>80%' },
    });
    out.push({
      key: `quot_w${w}_5080`,
      label: `QUOT CONF W${w} >50%-80%`,
      group: 'QUOTATION CONFIDENCE',
      kind: 'input',
      scope: 'weekly',
      week: w,
      excel: c5080,
      inGrid: true,
      inNational: false,
      mos: { top: 'OUTLOOK PRTM', sub: `QUOT CONFIDENCE W${w}`, tier: '>50%-80%' },
    });
    out.push({
      key: `quot_w${w}_50`,
      label: `QUOT CONF W${w} <50%`,
      group: 'QUOTATION CONFIDENCE',
      kind: 'input',
      scope: 'weekly',
      week: w,
      excel: c50,
      inGrid: true,
      inNational: false,
      mos: { top: 'OUTLOOK PRTM', sub: `QUOT CONFIDENCE W${w}`, tier: '<50%' },
    });
  }
  return out;
};

const inputMetrics: Metric[] = [
  {
    key: 'plan_sales',
    label: 'PLAN SALES MASTER',
    group: 'PLAN',
    kind: 'input',
    scope: 'monthly',
    excel: 'N',
    inGrid: true,
    inNational: true,
    level: 'branch',
    hint:
      'Target penjualan bulan berjalan UNTUK SELURUH CABANG — satu angka, ' +
      'diisi sekali, sama seperti baris TOTAL cabang di Excel (bukan dipecah per salesman).',
    // Di file asli N3:N5 di-merge tiga baris (tidak punya sub-header).
    mos: { top: 'PLAN SALES MASTER' },
  },
  {
    key: 'ol_min_prtm',
    label: 'OL MIN PRTM',
    group: 'OUTLOOK PRTM',
    kind: 'input',
    scope: 'monthly',
    excel: 'AG',
    inGrid: true,
    inNational: true,
    level: 'branch',
    hint: 'Angka tingkat cabang — satu nilai untuk seluruh cabang, bukan per salesman.',
    mos: { top: 'OUTLOOK PRTM', sub: 'OL MIN PRTM' },
  },
  ...weeklyMetrics(),
  {
    key: 'po_non_sap',
    label: 'PO NON SAP',
    group: 'OUTLOOK PRTM',
    kind: 'input',
    scope: 'monthly',
    excel: 'AE',
    inGrid: true,
    inNational: true,
    mos: { top: 'OUTLOOK PRTM', sub: 'PO NON SAP' },
  },
  {
    key: 'po_last_month_sap',
    label: 'PO LAST MONTH by SAP',
    group: 'OUTLOOK PRTM',
    kind: 'input',
    scope: 'monthly',
    excel: 'AI',
    inGrid: true,
    inNational: true,
    mos: { top: 'OUTLOOK PRTM', sub: 'PO LAST MONTH by SAP' },
  },

  // OUTLOOK REVENUE TM - POCO  (di file asli: baris 4 'POCO' merge AL4:AO4)
  { key: 'poco_not_active', label: 'POCO NOT ACTIVE', group: 'OUTLOOK REVENUE - POCO', kind: 'input', scope: 'monthly', excel: 'AL', inGrid: true, inNational: false, mos: { top: 'OUTLOOK REVENUE TM', sub: 'POCO', tier: 'NOT ACTIVE' } },
  { key: 'poco_plafond',    label: 'POCO PLAFOND',    group: 'OUTLOOK REVENUE - POCO', kind: 'input', scope: 'monthly', excel: 'AM', inGrid: true, inNational: false, mos: { top: 'OUTLOOK REVENUE TM', sub: 'POCO', tier: 'PLAFOND' } },
  { key: 'poco_internal',   label: 'POCO INTERNAL',   group: 'OUTLOOK REVENUE - POCO', kind: 'input', scope: 'monthly', excel: 'AN', inGrid: true, inNational: false, mos: { top: 'OUTLOOK REVENUE TM', sub: 'POCO', tier: 'INTERNAL' } },
  { key: 'poco_external',   label: 'POCO EXTERNAL',   group: 'OUTLOOK REVENUE - POCO', kind: 'input', scope: 'monthly', excel: 'AO', inGrid: true, inNational: false, mos: { top: 'OUTLOOK REVENUE TM', sub: 'POCO', tier: 'EXTERNAL' } },

  // OUTLOOK REVENUE TM - PRTM  (di file asli: baris 4 'PRTM' merge AP4:AS4)
  { key: 'prtm_not_active', label: 'PRTM NOT ACTIVE', group: 'OUTLOOK REVENUE - PRTM', kind: 'input', scope: 'monthly', excel: 'AP', inGrid: true, inNational: false, mos: { top: 'OUTLOOK REVENUE TM', sub: 'PRTM', tier: 'NOT ACTIVE' } },
  { key: 'prtm_plafond',    label: 'PRTM PLAFOND',    group: 'OUTLOOK REVENUE - PRTM', kind: 'input', scope: 'monthly', excel: 'AQ', inGrid: true, inNational: false, mos: { top: 'OUTLOOK REVENUE TM', sub: 'PRTM', tier: 'PLAFOND' } },
  { key: 'prtm_internal',   label: 'PRTM INTERNAL',   group: 'OUTLOOK REVENUE - PRTM', kind: 'input', scope: 'monthly', excel: 'AR', inGrid: true, inNational: false, mos: { top: 'OUTLOOK REVENUE TM', sub: 'PRTM', tier: 'INTERNAL' } },
  { key: 'prtm_external',   label: 'PRTM EXTERNAL',   group: 'OUTLOOK REVENUE - PRTM', kind: 'input', scope: 'monthly', excel: 'AS', inGrid: true, inNational: false, mos: { top: 'OUTLOOK REVENUE TM', sub: 'PRTM', tier: 'EXTERNAL' } },

  { key: 'quot_conf_80_ready',   label: 'QUOT CONF >80% READY',    group: 'OUTLOOK REVENUE - TAMBAHAN', kind: 'input', scope: 'monthly', excel: 'AU', inGrid: true, inNational: false, mos: { top: 'OUTLOOK REVENUE TM', sub: 'QUOT CONF >80% READY' } },
  { key: 'quot_conf_5080_ready', label: 'QUOT CONF >50%-80% READY', group: 'OUTLOOK REVENUE - TAMBAHAN', kind: 'input', scope: 'monthly', excel: 'AV', inGrid: true, inNational: false, mos: { top: 'OUTLOOK REVENUE TM', sub: 'QUOT CONF >50%-80% READY' } },
  { key: 'po_non_sap_ready',     label: 'PO NON SAP READY',        group: 'OUTLOOK REVENUE - TAMBAHAN', kind: 'input', scope: 'monthly', excel: 'AW', inGrid: true, inNational: false, mos: { top: 'OUTLOOK REVENUE TM', sub: 'PO NON SAP READY' } },
  { key: 'extra_efforts',        label: 'EXTRA EFFORTS',           group: 'OUTLOOK REVENUE - TAMBAHAN', kind: 'input', scope: 'monthly', excel: 'AX', inGrid: true, inNational: false, mos: { top: 'OUTLOOK REVENUE TM', sub: 'EXTRA EFFORTS' } },

  {
    key: 'actual_sales',
    label: 'ACTUAL SALES',
    group: 'ACTUAL SALES',
    kind: 'input',
    scope: 'monthly',
    excel: 'BM',
    inGrid: true,
    inNational: true,
    level: 'branch',
    hint: 'Angka tingkat cabang dari SAP — satu nilai untuk seluruh cabang, bukan per salesman.',
    mos: { top: 'ACTUAL SALES', sub: 'AMOUNT' },
  },
];

/* --------------------------------------------------------------------
 * B. KOLOM TURUNAN (dihitung sistem - cabang tidak bisa mengetik)
 * ------------------------------------------------------------------ */

const derivedMetrics: Metric[] = [
  {
    key: 'total_ol_prtm',
    label: 'TOTAL OL PRTM',
    group: 'OUTLOOK PRTM',
    kind: 'derived',
    scope: 'monthly',
    excel: 'AF',
    inGrid: true,
    inNational: true,
    hint: 'ACT PRTM minggu berjalan + QUOT CONF >80% minggu berjalan + PO NON SAP',
    mos: { top: 'OUTLOOK PRTM', sub: 'TOTAL OL PRTM' },
    formula: (v, ctx) => n(v[wk('act_prtm', ctx)]) + n(v[`quot_w${ctx.week}_80`]) + n(v.po_non_sap),
  },
  {
    key: 'balance_prtm',
    label: 'BALANCE PRTM (OL - PLAN PRTM)',
    group: 'OUTLOOK PRTM',
    kind: 'derived',
    scope: 'monthly',
    excel: 'AH',
    inGrid: true,
    inNational: true,
    level: 'branch',
    hint: 'Butuh OL MIN PRTM (angka tingkat cabang), jadi hanya berarti di baris TOTAL cabang.',
    mos: { top: 'OUTLOOK PRTM', sub: 'BALANCE PRTM (OL - PLAN PRTM)' },
    formula: (v, ctx) => calcOne(v, ctx, 'total_ol_prtm') - n(v.ol_min_prtm),
  },
  {
    key: 'total_po',
    label: 'TOTAL PO (POCO+PRTM)',
    group: 'OUTLOOK PRTM',
    kind: 'derived',
    scope: 'monthly',
    excel: 'AJ',
    inGrid: true,
    inNational: true,
    mos: { top: 'OUTLOOK PRTM', sub: 'TOTAL PO (POCO+PRTM)' },
    formula: (v, ctx) => n(v[wk('act_prtm', ctx)]) + n(v.po_last_month_sap),
  },
  {
    key: 'total_po_outlook',
    label: 'TOTAL PO OUTLOOK',
    group: 'OUTLOOK PRTM',
    kind: 'derived',
    scope: 'monthly',
    excel: 'AK',
    inGrid: true,
    inNational: true,
    mos: { top: 'OUTLOOK PRTM', sub: 'TOTAL PO OUTLOOK' },
    formula: (v, ctx) => calcOne(v, ctx, 'total_ol_prtm') + n(v.po_last_month_sap),
  },
  {
    key: 'ol_revenue',
    label: 'OL REVENUE (POCO+PRTM)',
    group: 'OUTLOOK REVENUE TM',
    kind: 'derived',
    scope: 'monthly',
    excel: 'AT',
    inGrid: true,
    inNational: true,
    mos: { top: 'OUTLOOK REVENUE TM', sub: 'OL REVENUE  (POCO+PRTM)' },
    formula: (v) =>
      n(v.poco_not_active) + n(v.poco_plafond) + n(v.poco_internal) + n(v.poco_external) +
      n(v.prtm_not_active) + n(v.prtm_plafond) + n(v.prtm_internal) + n(v.prtm_external),
  },
  {
    key: 'total_ol_revenue',
    label: 'TOTAL OL REVENUE THIS WEEK',
    group: 'OUTLOOK REVENUE TM',
    kind: 'derived',
    scope: 'monthly',
    excel: 'AY',
    inGrid: true,
    inNational: true,
    mos: { top: 'OUTLOOK REVENUE TM', sub: 'TOTAL OL REVENUE THIS WEEK' },
    formula: (v, ctx) =>
      calcOne(v, ctx, 'ol_revenue') +
      n(v.quot_conf_80_ready) + n(v.quot_conf_5080_ready) +
      n(v.po_non_sap_ready) + n(v.extra_efforts),
  },
  {
    key: 'ratio_actual',
    label: 'RATIO ACTUAL / PLAN',
    group: 'ACTUAL SALES',
    kind: 'derived',
    scope: 'monthly',
    excel: 'BN',
    // v2.9: dihapus dari semua tampilan (grid input, preview upload, rekap
    // nasional, export Excel rekap) atas permintaan user — kolomnya sendiri
    // tetap didefinisikan (bukan dihapus total) karena excel: 'BN' masih
    // dipakai buildBranchTemplateWorkbook() untuk menjaga huruf kolom
    // template input tidak bergeser (lihat xlsx-styled.ts baris ~323).
    inGrid: false,
    inNational: false,
    format: 'percent',
    level: 'branch',
    hint: 'Butuh ACTUAL SALES & PLAN SALES (angka tingkat cabang), jadi hanya berarti di baris TOTAL cabang.',
    mos: { top: 'ACTUAL SALES', sub: 'RATIO' },
    formula: (v) => div(n(v.actual_sales), n(v.plan_sales)),
  },
];

/* --------------------------------------------------------------------
 * C. REGISTRY & API PERHITUNGAN
 * ------------------------------------------------------------------ */

export const METRICS: Metric[] = [...inputMetrics, ...derivedMetrics];

export const METRIC_BY_KEY: Record<string, Metric> = Object.fromEntries(
  METRICS.map((m) => [m.key, m]),
);

/* --------------------------------------------------------------------
 * C2. URUTAN KOLOM = URUTAN KOLOM EXCEL ASLI
 *
 * Dulu urutan kolom ditentukan daftar GROUP_ORDER, yang menghasilkan
 * susunan berbeda dari file MOS (semua kolom input dulu, baru turunan).
 * Sekarang urutannya diambil langsung dari huruf kolom Excel di field
 * `excel`, sehingga grid, template, dan rekap nasional persis mengikuti
 * file aslinya:
 *
 *   ACT PRTM W1..W4 · QUOT CONFIDENCE W1..W4 · PO NON SAP ·
 *   TOTAL OL PRTM · OL MIN PRTM · BALANCE PRTM · PO LAST MONTH by SAP ·
 *   TOTAL PO · TOTAL PO OUTLOOK · POCO · PRTM · OL REVENUE ·
 *   QUOT CONF READY · EXTRA EFFORTS · TOTAL OL REVENUE THIS WEEK
 *
 * Semua daftar kunci di bawah ikut memakai urutan ini, supaya kolom di
 * template Excel dan di grid tidak pernah berbeda susunannya.
 * ------------------------------------------------------------------ */

/** 'A' -> 1, 'Z' -> 26, 'AA' -> 27. Kolom tanpa huruf ditaruh paling akhir. */
export function excelColumnIndex(letters: string | undefined): number {
  if (!letters) return Number.MAX_SAFE_INTEGER;
  let out = 0;
  for (const ch of letters.toUpperCase()) {
    const v = ch.charCodeAt(0) - 64;
    if (v < 1 || v > 26) return Number.MAX_SAFE_INTEGER;
    out = out * 26 + v;
  }
  return out;
}

/** Semua kolom, urut persis seperti kolom di sheet MOS. */
export const ORDERED_METRICS: Metric[] = [...METRICS].sort(
  (a, b) => excelColumnIndex(a.excel) - excelColumnIndex(b.excel),
);

/** Kolom terurut yang lolos sebuah saringan — dipakai grid, template, export. */
export function orderedMetrics(filter: (m: Metric) => boolean): Metric[] {
  return ORDERED_METRICS.filter(filter);
}

const orderedKeys = (filter: (m: Metric) => boolean): string[] =>
  orderedMetrics(filter).map((m) => m.key);

const isSalesmanLevel = (m: Metric) => (m.level ?? 'salesman') === 'salesman';

export const INPUT_KEYS = orderedKeys((m) => m.kind === 'input');
export const DERIVED_KEYS = orderedKeys((m) => m.kind === 'derived');

/** Kolom input yang diisi PER SALESMAN (semua kecuali level 'branch'). */
export const SALESMAN_INPUT_KEYS = orderedKeys((m) => m.kind === 'input' && isSalesmanLevel(m));

/** Kolom input yang diisi SEKALI untuk seluruh cabang (PLAN SALES MASTER,
 *  OL MIN PRTM, ACTUAL SALES) — persis seperti baris TOTAL di Excel asli,
 *  yang tidak pernah dipecah per salesman. */
export const BRANCH_INPUT_KEYS = orderedKeys((m) => m.kind === 'input' && m.level === 'branch');

/** Kolom turunan yang hanya berarti di tingkat cabang (butuh BRANCH_INPUT_KEYS). */
export const BRANCH_DERIVED_KEYS = orderedKeys((m) => m.kind === 'derived' && m.level === 'branch');

/** Kolom (input & turunan) yang ditampilkan di grid PER SALESMAN. */
export const SALESMAN_GRID_KEYS = orderedKeys((m) => m.inGrid && isSalesmanLevel(m));
/** Kolom yang ditampilkan di panel "Data Tingkat Cabang". */
export const BRANCH_GRID_KEYS = orderedKeys((m) => m.inGrid && m.level === 'branch');

/** Hitung satu kolom turunan (dipakai internal oleh rumus lain). */
export function calcOne(values: ValueMap, ctx: CalcContext, key: string): number {
  const m = METRIC_BY_KEY[key];
  if (!m) return 0;
  if (m.kind === 'input') return n(values[key]);
  return m.formula ? m.formula(values, ctx) : 0;
}

/**
 * Hitung SEMUA kolom turunan untuk satu baris.
 * Mengembalikan objek gabungan input + turunan, siap dirender.
 */
export function computeRow(values: ValueMap, ctx: CalcContext): ValueMap {
  const out: ValueMap = { ...values };
  for (const m of derivedMetrics) {
    out[m.key] = m.formula ? m.formula(values, ctx) : 0;
  }
  return out;
}

/**
 * Jumlahkan beberapa baris (mis. seluruh salesman dalam satu cabang,
 * atau seluruh cabang dalam satu area). Kolom input dijumlah, lalu
 * kolom turunan DIHITUNG ULANG dari hasil penjumlahan - sama persis
 * dengan perilaku baris TOTAL di Excel.
 */
export function aggregateRows(rows: ValueMap[], ctx: CalcContext): ValueMap {
  const sum: ValueMap = {};
  for (const key of INPUT_KEYS) {
    sum[key] = rows.reduce((acc, r) => acc + n(r[key]), 0);
  }
  return computeRow(sum, ctx);
}

/* --------------------------------------------------------------------
 * D. ATURAN KUNCI & ALASAN PERUBAHAN
 * ------------------------------------------------------------------ */

/**
 * Apakah field ini terkunci (perubahannya WAJIB disertai alasan)?
 *
 * Aturan:
 *  - Belum pernah submit  -> tidak ada yang terkunci, bebas input.
 *  - Sudah submit minggu L:
 *      * semua kolom bulanan            -> TERKUNCI
 *      * kolom mingguan W1..WL          -> TERKUNCI
 *      * kolom mingguan W(L+1)..W4      -> bebas (belum pernah dilaporkan)
 *  - Kolom turunan tidak pernah diinput, jadi tidak pernah dicek.
 */
export function isFieldLocked(fieldKey: string, lastSubmittedWeek: number | null): boolean {
  if (!lastSubmittedWeek) return false;
  const m = METRIC_BY_KEY[fieldKey];
  if (!m || m.kind === 'derived') return false;
  if (m.scope === 'monthly') return true;
  return (m.week ?? 99) <= lastSubmittedWeek;
}

export interface ChangedField {
  key: string;
  label: string;
  oldValue: number | null;
  newValue: number | null;
  requiresReason: boolean;
  lockedWeek: number | null;
}

/**
 * Bandingkan nilai baru dengan SNAPSHOT terakhir (bukan dengan draft
 * sebelumnya). Ini penting: yang dimonitor Head Office adalah selisih
 * terhadap angka yang sudah pernah dilaporkan resmi.
 */
export function diffAgainstSnapshot(
  current: ValueMap,
  next: ValueMap,
  snapshot: ValueMap | null,
  lastSubmittedWeek: number | null,
): ChangedField[] {
  const changes: ChangedField[] = [];
  for (const key of INPUT_KEYS) {
    const oldVal = current[key] ?? null;
    const newVal = next[key] ?? null;
    if (nearlyEqual(oldVal, newVal)) continue;

    const locked = isFieldLocked(key, lastSubmittedWeek);
    // Perubahan dianggap "mengubah angka yang sudah dilaporkan" hanya
    // jika nilainya menyimpang dari snapshot.
    const snapVal = snapshot ? (snapshot[key] ?? null) : null;
    const deviatesFromSnapshot = snapshot ? !nearlyEqual(snapVal, newVal) : false;

    changes.push({
      key,
      label: METRIC_BY_KEY[key]?.label ?? key,
      oldValue: toNum(oldVal),
      newValue: toNum(newVal),
      requiresReason: locked && deviatesFromSnapshot,
      lockedWeek: locked ? lastSubmittedWeek : null,
    });
  }
  return changes;
}

function toNum(x: number | null | undefined): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
}

/** Toleransi pembulatan 4 desimal, menghindari revisi palsu dari float. */
export function nearlyEqual(a: number | null | undefined, b: number | null | undefined): boolean {
  const x = n(a);
  const y = n(b);
  return Math.abs(x - y) < 1e-4;
}

/** Kategori alasan baku - dipakai di dropdown supaya bisa direkap. */
export const REASON_CATEGORIES = [
  { value: 'koreksi_input', label: 'Koreksi salah input' },
  { value: 'update_sap', label: 'Update data SAP / SO baru terbit' },
  { value: 'cancel_po', label: 'PO dibatalkan / dikurangi customer' },
  { value: 'reschedule', label: 'Reschedule delivery / ETA berubah' },
  { value: 'quot_status', label: 'Perubahan status quotation (confidence)' },
  { value: 'plan_revisi', label: 'Revisi plan dari Head Office' },
  { value: 'lainnya', label: 'Lainnya (jelaskan di keterangan)' },
] as const;

export const MIN_REASON_LENGTH = 10;
