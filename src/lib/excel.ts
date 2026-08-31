import * as XLSX from 'xlsx';
import {
  BRANCH_INPUT_KEYS,
  METRIC_BY_KEY,
  METRICS,
  SALESMAN_INPUT_KEYS,
  excelColumnIndex,
  type ValueMap,
} from '@/lib/metrics';
import { monthName } from '@/lib/format';

/* =====================================================================
 *  PARSER FILE UPLOAD CABANG  (berjalan di browser)
 *
 *  Menerima DUA bentuk file, dikenali otomatis:
 *
 *  1. FORMAT MOS ASLI — file Excel yang selama ini dipakai cabang,
 *     diunggah APA ADANYA tanpa disalin ke template baru. Inilah jalur
 *     utamanya. Ciri: ada baris header dengan 'NO' di kolom A dan
 *     'BRANCH' di kolom C.
 *
 *       Baris 3-5 : header tiga tingkat
 *       Baris 7   : baris CABANG  (B = kode cabang, C = nama cabang)
 *                   -> memuat PLAN SALES MASTER (N), OL MIN PRTM (AG),
 *                      ACTUAL SALES (BM) alias data tingkat cabang
 *       Baris 8.. : baris SALESMAN (C = nama salesman)
 *       Diakhiri baris yang kolom A-nya 'TOTAL'
 *
 *     Kolom dipetakan lewat HURUF KOLOM EXCEL, diambil langsung dari
 *     field `excel` di metrics.ts — jadi tidak ada daftar ganda yang
 *     bisa ketinggalan saat kolom berubah.
 *
 *  2. FORMAT TEMPLATE SISTEM — file hasil unduhan /api/template versi
 *     lama, yang punya baris kunci teknis '__salesman_name'. Tetap
 *     didukung supaya file yang terlanjur dipakai tidak jadi sampah.
 *
 *  Parsing sengaja dilakukan di browser agar preview perubahan muncul
 *  seketika tanpa perlu mengunggah file dulu. File cabang bisa besar
 *  (Sampit.xlsx ~9,6 MB karena banyak sheet arsip), jadi hanya sheet
 *  yang dibutuhkan yang ikut diparsing — lihat readWorkbook().
 * =================================================================== */

export interface TemplateRow {
  salesmanId: string;
  salesmanName: string;
  values: ValueMap;
}

export interface ParseIssue {
  level: 'error' | 'warning';
  message: string;
  row?: number;
}

export interface ParseResult {
  rows: TemplateRow[];
  /** Data tingkat cabang yang terbaca dari baris cabang (format MOS).
   *  null bila file tidak memuatnya (mis. format template lama). */
  branchValues: ValueMap | null;
  issues: ParseIssue[];
  unknownColumns: string[];
  /** Format yang terdeteksi — ditampilkan ke user supaya jelas. */
  format: 'mos' | 'template';
  sheetName: string;
}

export interface ParseContext {
  salesmen: { id: string; name: string }[];
  branchCode: string;
  branchName: string;
  year: number;
  month: number;
}

/* Baris yang ADA di file cabang tapi memang bukan salesman sungguhan —
 * sudah dihapus dari master saat penyiapan data. Dilewati tanpa dianggap
 * kesalahan supaya cabang tidak dibanjiri pesan merah. */
const NON_SALESMAN_ROWS = new Set(['PROJECT', 'PROJECT BTM', 'OTHERS', 'OTHER']);

function normalize(s: string): string {
  return s.trim().toUpperCase().replace(/\s+/g, ' ');
}

/** Ubah isi sel jadi angka. null bila kosong, undefined bila bukan angka. */
function toNumber(cell: unknown): number | null | undefined {
  if (cell === null || cell === undefined || cell === '') return null;
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : undefined;
  const text = String(cell).trim();
  if (!text || text === '-') return null;
  // Buang '#REF!', '#DIV/0!' dan sejenisnya tanpa berisik — sel rusak di
  // file lama diperlakukan sebagai kosong, bukan sebagai kesalahan user.
  if (text.startsWith('#')) return null;
  const numeric = Number(text.replace(/[^\d.,\-]/g, '').replace(',', '.'));
  return Number.isFinite(numeric) ? numeric : undefined;
}

/** Indeks kolom (0-based) untuk tiap kunci metrik, dari huruf kolom Excel. */
function columnIndexByKey(keys: string[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const key of keys) {
    const letters = METRIC_BY_KEY[key]?.excel;
    if (!letters) continue;
    const idx = excelColumnIndex(letters);
    if (idx === Number.MAX_SAFE_INTEGER) continue;
    map.set(idx - 1, key);
  }
  return map;
}

/**
 * Baca workbook, sedapat mungkin HANYA sheet yang diperlukan.
 *
 * File cabang memuat belasan sheet arsip (Pivot, Resume, dst) yang tidak
 * ada hubungannya dengan laporan. Tanpa penyaringan ini, memparsing
 * Sampit.xlsx di browser makan waktu dan memori jauh lebih besar dari
 * yang perlu.
 */
function readWorkbook(data: ArrayBuffer, ctx: ParseContext) {
  const wanted = [
    'INPUT',
    `${monthName(ctx.month)} ${ctx.year}`,
    'MOS',
  ];

  const opts: XLSX.ParsingOptions = {
    type: 'array',
    cellFormula: false,
    cellStyles: false,
    cellHTML: false,
  };

  let wb = XLSX.read(data, { ...opts, sheets: wanted });
  const loaded = wanted.filter((n) => wb.Sheets[n]);

  if (loaded.length === 0) {
    // Nama sheet-nya lain (mis. 'MOS AGUSTUS 2026' atau ejaan berbeda).
    // Baru di titik ini kita baca seluruh workbook.
    wb = XLSX.read(data, opts);
  }
  return wb;
}

/** Pilih sheet yang paling masuk akal untuk periode yang sedang dilaporkan. */
function pickSheet(wb: XLSX.WorkBook, ctx: ParseContext): string | null {
  const names = wb.SheetNames.filter((n) => wb.Sheets[n]);
  if (names.length === 0) return null;

  const target = normalize(`${monthName(ctx.month)} ${ctx.year}`);
  const exact = names.find((n) => normalize(n) === target);
  if (exact) return exact;

  // 'MOS AGUSTUS 2026', 'AGUSTUS 2026 (rev)', dst.
  const contains = names.find(
    (n) => normalize(n).includes(normalize(monthName(ctx.month))) && n.includes(String(ctx.year)),
  );
  if (contains) return contains;

  const input = names.find((n) => normalize(n) === 'INPUT');
  if (input) return input;

  const mos = names.find((n) => normalize(n) === 'MOS');
  if (mos) return mos;

  return names[0];
}

type Grid = (string | number | null)[][];

function sheetToGrid(ws: XLSX.WorkSheet): Grid {
  return XLSX.utils.sheet_to_json<Grid[number]>(ws, {
    header: 1,
    blankrows: true, // baris kosong dipertahankan supaya nomor baris jujur
    defval: null,
    raw: true,
  });
}

/* --------------------------------------------------------------------
 *  ENTRI UTAMA
 * ------------------------------------------------------------------ */

export function parseBranchTemplate(data: ArrayBuffer, ctx: ParseContext): ParseResult {
  let wb: XLSX.WorkBook;
  try {
    wb = readWorkbook(data, ctx);
  } catch {
    return {
      rows: [],
      branchValues: null,
      issues: [
        {
          level: 'error',
          message:
            'File tidak bisa dibaca. Pastikan yang diunggah benar-benar file Excel (.xlsx/.xlsm), bukan PDF atau file yang sedang dibuka di Excel.',
        },
      ],
      unknownColumns: [],
      format: 'mos',
      sheetName: '',
    };
  }

  const sheetName = pickSheet(wb, ctx);
  const ws = sheetName ? wb.Sheets[sheetName] : null;

  if (!ws || !sheetName) {
    return {
      rows: [],
      branchValues: null,
      issues: [
        {
          level: 'error',
          message: `Tidak ditemukan sheet untuk ${monthName(ctx.month)} ${ctx.year} di dalam file. Pastikan file memuat sheet bulan tersebut.`,
        },
      ],
      unknownColumns: [],
      format: 'mos',
      sheetName: '',
    };
  }

  const grid = sheetToGrid(ws);

  // Format template lama dikenali dari baris kunci teknisnya.
  const keyRowIdx = grid.findIndex(
    (r) => Array.isArray(r) && r[0] === '__salesman_name' && r[1] === '__salesman_id',
  );
  if (keyRowIdx !== -1) {
    return parseTemplateFormat(grid, keyRowIdx, ctx, sheetName);
  }

  return parseMosFormat(grid, ctx, sheetName);
}

/* --------------------------------------------------------------------
 *  FORMAT 1 — FILE MOS ASLI CABANG
 * ------------------------------------------------------------------ */

function parseMosFormat(grid: Grid, ctx: ParseContext, sheetName: string): ParseResult {
  const issues: ParseIssue[] = [];

  const headerIdx = grid.findIndex(
    (r) =>
      Array.isArray(r) &&
      normalize(String(r[0] ?? '')) === 'NO' &&
      normalize(String(r[2] ?? '')) === 'BRANCH',
  );

  if (headerIdx === -1) {
    return {
      rows: [],
      branchValues: null,
      issues: [
        {
          level: 'error',
          message:
            `Sheet "${sheetName}" tidak dikenali sebagai laporan MOS. Baris header dengan "NO" di kolom A dan "BRANCH" di kolom C tidak ditemukan — pastikan sheet yang benar dan strukturnya tidak diubah.`,
        },
      ],
      unknownColumns: [],
      format: 'mos',
      sheetName,
    };
  }

  /* --- Baris cabang -------------------------------------------------
   * Dicari lewat kode cabang (kolom B) atau nama cabang (kolom C).
   * Baris inilah yang memuat data tingkat cabang. */
  const wantCode = normalize(ctx.branchCode);
  const wantName = normalize(ctx.branchName);
  let branchIdx = -1;
  for (let r = headerIdx + 1; r < grid.length; r++) {
    const line = grid[r];
    if (!Array.isArray(line)) continue;
    const code = normalize(String(line[1] ?? ''));
    const name = normalize(String(line[2] ?? ''));
    if (code === wantCode || name === wantName) {
      branchIdx = r;
      break;
    }
  }

  if (branchIdx === -1) {
    return {
      rows: [],
      branchValues: null,
      issues: [
        {
          level: 'error',
          message:
            `Baris cabang ${ctx.branchName} (${ctx.branchCode}) tidak ditemukan di sheet "${sheetName}". ` +
            'Pastikan file yang diunggah memang milik cabang ini — kode cabang dibaca dari kolom PLANT, namanya dari kolom BRANCH.',
        },
      ],
      unknownColumns: [],
      format: 'mos',
      sheetName,
    };
  }

  const branchCols = columnIndexByKey(BRANCH_INPUT_KEYS);
  const salesmanCols = columnIndexByKey(SALESMAN_INPUT_KEYS);

  /* --- Data tingkat cabang --- */
  const branchValues: ValueMap = {};
  for (const [col, key] of branchCols) {
    const parsed = toNumber(grid[branchIdx]?.[col]);
    if (parsed === undefined) {
      issues.push({
        level: 'warning',
        row: branchIdx + 1,
        message: `Nilai ${METRIC_BY_KEY[key]?.label ?? key} pada baris cabang bukan angka — dianggap kosong.`,
      });
      branchValues[key] = null;
      continue;
    }
    branchValues[key] = parsed;
  }

  /* --- Baris salesman --- */
  const byName = new Map(ctx.salesmen.map((s) => [normalize(s.name), s]));
  const seen = new Set<string>();
  const rows: TemplateRow[] = [];
  let skippedNonSalesman = 0;

  for (let r = branchIdx + 1; r < grid.length; r++) {
    const line = grid[r];
    if (!Array.isArray(line)) continue;

    const colA = normalize(String(line[0] ?? ''));
    // Baris TOTAL nasional menutup blok cabang ini.
    if (colA === 'TOTAL' || colA === 'GRAND TOTAL') break;

    const rawName = String(line[2] ?? '').trim();
    if (!rawName) continue;

    /* Baris cabang berikutnya menutup blok kita. Penandanya jelas dan
     * stabil: kolom NO berisi ANGKA (nomor urut cabang). Baris salesman
     * selalu mengosongkan kolom NO — lihat baris 7 vs 8 di file cabang. */
    const noCell = line[0];
    const isBranchRow =
      typeof noCell === 'number' ||
      (typeof noCell === 'string' && noCell.trim() !== '' && Number.isFinite(Number(noCell)));
    if (isBranchRow) break;

    if (NON_SALESMAN_ROWS.has(normalize(rawName))) {
      skippedNonSalesman += 1;
      continue;
    }

    const match = byName.get(normalize(rawName));
    if (!match) {
      issues.push({
        level: 'error',
        row: r + 1,
        message: `Salesman "${rawName}" tidak terdaftar pada cabang ini. Baris dilewati — periksa ejaan namanya atau tambahkan di master.`,
      });
      continue;
    }
    if (seen.has(match.id)) {
      issues.push({
        level: 'error',
        row: r + 1,
        message: `Salesman "${match.name}" muncul lebih dari sekali. Baris duplikat dilewati.`,
      });
      continue;
    }
    seen.add(match.id);

    const values: ValueMap = {};
    for (const [col, key] of salesmanCols) {
      const parsed = toNumber(line[col]);
      if (parsed === undefined) {
        issues.push({
          level: 'warning',
          row: r + 1,
          message: `Nilai ${METRIC_BY_KEY[key]?.label ?? key} untuk ${match.name} bukan angka — dianggap kosong.`,
        });
        values[key] = null;
        continue;
      }
      values[key] = parsed;
    }
    rows.push({ salesmanId: match.id, salesmanName: match.name, values });
  }

  if (skippedNonSalesman > 0) {
    issues.push({
      level: 'warning',
      message: `${skippedNonSalesman} baris penampung (PROJECT/OTHERS) dilewati — baris seperti itu memang tidak dipakai lagi.`,
    });
  }

  const notInFile = ctx.salesmen.filter((s) => !seen.has(s.id));
  if (notInFile.length) {
    issues.push({
      level: 'warning',
      message: `${notInFile.length} salesman tidak ada di file (${notInFile
        .map((s) => s.name)
        .join(', ')}). Datanya tidak diubah.`,
    });
  }

  if (rows.length === 0) {
    issues.push({
      level: 'error',
      message: `Tidak ada baris salesman yang bisa dibaca di bawah baris cabang ${ctx.branchName}.`,
    });
  }

  return { rows, branchValues, issues, unknownColumns: [], format: 'mos', sheetName };
}

/* --------------------------------------------------------------------
 *  FORMAT 2 — TEMPLATE SISTEM VERSI LAMA (baris kunci teknis)
 * ------------------------------------------------------------------ */

function parseTemplateFormat(
  grid: Grid,
  keyRowIdx: number,
  ctx: ParseContext,
  sheetName: string,
): ParseResult {
  const issues: ParseIssue[] = [];
  const keyRow = grid[keyRowIdx] as (string | null)[];
  const colToKey = new Map<number, string>();
  const unknownColumns: string[] = [];

  for (let i = 2; i < keyRow.length; i++) {
    const key = (keyRow[i] ?? '').toString().trim();
    if (!key) continue;
    if (!SALESMAN_INPUT_KEYS.includes(key)) {
      // Kolom turunan ikut ada di template versi tertentu — abaikan diam-diam.
      if (METRIC_BY_KEY[key]) continue;
      unknownColumns.push(key);
      continue;
    }
    colToKey.set(i, key);
  }

  const present = new Set(colToKey.values());
  const missing = SALESMAN_INPUT_KEYS.filter((k) => !present.has(k));
  if (missing.length) {
    issues.push({
      level: 'warning',
      message: `${missing.length} kolom tidak ada di file (${missing
        .slice(0, 5)
        .map((k) => METRIC_BY_KEY[k]?.label ?? k)
        .join(', ')}${missing.length > 5 ? ', …' : ''}). Kolom tersebut dibiarkan seperti data sebelumnya.`,
    });
  }
  if (unknownColumns.length) {
    issues.push({
      level: 'warning',
      message: `${unknownColumns.length} kolom tidak dikenali dan diabaikan (${unknownColumns
        .slice(0, 5)
        .join(', ')}${unknownColumns.length > 5 ? ', …' : ''}). Biasanya ini sisa template versi lama.`,
    });
  }

  const byId = new Map(ctx.salesmen.map((s) => [s.id, s]));
  const byName = new Map(ctx.salesmen.map((s) => [normalize(s.name), s]));
  const seen = new Set<string>();
  const rows: TemplateRow[] = [];

  for (let r = keyRowIdx + 1; r < grid.length; r++) {
    const line = grid[r];
    if (!Array.isArray(line)) continue;

    const rawName = (line[0] ?? '').toString().trim();
    const rawId = (line[1] ?? '').toString().trim();
    if (!rawName && !rawId) continue;
    if (/^total/i.test(rawName)) continue;

    const match = byId.get(rawId) ?? byName.get(normalize(rawName));
    if (!match) {
      issues.push({
        level: 'error',
        row: r + 1,
        message: `Salesman "${rawName || rawId}" tidak terdaftar pada cabang ini. Baris dilewati.`,
      });
      continue;
    }
    if (seen.has(match.id)) {
      issues.push({
        level: 'error',
        row: r + 1,
        message: `Salesman "${match.name}" muncul lebih dari sekali. Baris duplikat dilewati.`,
      });
      continue;
    }
    seen.add(match.id);

    const values: ValueMap = {};
    for (const [col, key] of colToKey) {
      const parsed = toNumber(line[col]);
      if (parsed === undefined) {
        issues.push({
          level: 'error',
          row: r + 1,
          message: `Nilai "${line[col]}" pada kolom ${METRIC_BY_KEY[key]?.label ?? key} (${match.name}) bukan angka.`,
        });
        continue;
      }
      values[key] = parsed;
    }
    rows.push({ salesmanId: match.id, salesmanName: match.name, values });
  }

  const notInFile = ctx.salesmen.filter((s) => !seen.has(s.id));
  if (notInFile.length) {
    issues.push({
      level: 'warning',
      message: `${notInFile.length} salesman tidak ada di file (${notInFile
        .map((s) => s.name)
        .join(', ')}). Datanya tidak diubah.`,
    });
  }

  return { rows, branchValues: null, issues, unknownColumns, format: 'template', sheetName };
}

/** Dipakai template builder & pengujian: seluruh kolom yang punya huruf Excel. */
export const EXCEL_COLUMN_OF_KEY: Record<string, string> = Object.fromEntries(
  METRICS.filter((m) => m.excel).map((m) => [m.key, m.excel as string]),
);
