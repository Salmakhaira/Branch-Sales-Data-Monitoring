import ExcelJS from 'exceljs';
import { excelColumnIndex, orderedMetrics, type Metric, type ValueMap } from '@/lib/metrics';
import { monthName } from '@/lib/format';

/* =====================================================================
 *  PEMBUAT FILE EXCEL BERGAYA  (server-side)
 *
 *  Meniru tampilan sheet 'MOS AGUSTUS 2026' pada
 *  WEEKLY REPORT MOS NASIONAL 2026.xlsx:
 *
 *    - header bertingkat dengan sel di-merge per grup
 *    - warna latar berbeda tiap grup kolom
 *    - baris TOTAL cabang berlatar oranye + biru muda, tebal
 *    - baris salesman menjorok ke dalam
 *    - angka format akunting: 1.234 / -1.234 / "-" untuk nol
 *    - freeze pane sehingga kolom identitas & header tetap terlihat
 *    - garis tepi medium di batas blok, hair di dalam blok
 *
 *  Dijalankan di server (route handler), bukan di browser, supaya
 *  ExcelJS tidak ikut membesarkan bundle yang diunduh pengguna.
 * =================================================================== */

/* Warna hasil resolusi theme Office pada file aslinya.
 *
 * PENTING: Sampit.xlsx dan WEEKLY REPORT MOS NASIONAL 2026.xlsx sama-sama
 * memakai theme Office yang BARU (accent1 #156082, accent2 #E97132,
 * accent3 #196B24, accent4 #0F9ED5, accent6 #4EA72E) — bukan theme Office
 * lama yang dulu diasumsikan di sini. Nilai di bawah adalah hasil hitung
 * ulang tint terhadap theme yang benar, jadi warnanya sekarang sama persis
 * dengan file aslinya. */
const FILL = {
  identity: 'FFCAEEFB', // theme7 (accent4 0F9ED5) tint 0.8  — biru langit muda
  prtm: 'FFFBE3D6', // theme5 (accent2 E97132) tint 0.8  — persik muda
  revenue: 'FF84E291', // theme6 (accent3 196B24) tint 0.6  — hijau muda
  actual: 'FFB4E5A2', // theme9 (accent6 4EA72E) tint 0.6  — hijau daun muda
  plan: 'FFCAEEFB', // di file asli N3 memakai isian yang sama dgn kolom identitas
  grey: 'FFD9D9D9', // theme0 (putih) tint -0.15         — abu header sekunder
  branchLabel: 'FFFFC000', // oranye solid, seperti baris cabang di file asli
  branchValue: 'FFBDD7EE', // biru muda baris nilai cabang
  areaRow: 'FFDDEBF7',
  grandLabel: 'FFFFFF00', // kuning, seperti baris GRAND TOTAL
  grandValue: 'FFCAEEFB',
} as const;

/* Judul grup baris 3 di file MOS asli -> warna isian headernya. */
const MOS_FILL: Record<string, string> = {
  'PLAN SALES MASTER': FILL.identity,
  'OUTLOOK PRTM': FILL.prtm,
  'OUTLOOK REVENUE TM': FILL.revenue,
  'ACTUAL SALES': FILL.actual,
};

/** Info header bertingkat tiga untuk satu kolom, dengan cadangan bila
 *  metrik belum sempat diberi field `mos`. */
function mosOf(m: Metric): { top: string; sub?: string; tier?: string } {
  return m.mos ?? { top: m.group, sub: m.label };
}

const ACCOUNTING = '_-* #,##0_-;\\-* #,##0_-;_-* "-"_-;_-@_-';
const ACCOUNTING_2DP = '_-* #,##0.00_-;\\-* #,##0.00_-;_-* "-"_-;_-@_-';
const PERCENT = '0%';

const THIN = { style: 'thin' as const, color: { argb: 'FF9AA4AE' } };
const HAIR = { style: 'hair' as const, color: { argb: 'FFB8C0C8' } };
const MEDIUM = { style: 'medium' as const, color: { argb: 'FF44505C' } };

/* Rekap nasional memakai format akunting TANPA desimal, sama seperti
 * file MOS Nasional yang dipakai di rapat. Template input cabang tetap
 * 2 desimal karena di sana presisi angka masih dibutuhkan. */
function numFmt(m: Metric): string {
  if (m.format === 'percent') return PERCENT;
  return ACCOUNTING;
}

function solid(argb: string) {
  return { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } };
}

function num(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Number(v.toFixed(4)) : null;
}

/* --------------------------------------------------------------------
 *  1. EXPORT REKAP NASIONAL
 * ------------------------------------------------------------------ */

export interface NationalRow {
  branchCode: string;
  branchName: string;
  areaCode: string | null;
  salesmanName: string | null;
  values: ValueMap;
  isBranchTotal: boolean;
}

export interface NationalExportInput {
  year: number;
  month: number;
  week: number;
  rows: NationalRow[];
  areaTotals: { code: string; name: string; values: ValueMap }[];
  grandTotal: ValueMap;
  generatedAt: string;
}

export async function buildNationalWorkbook(input: NationalExportInput): Promise<Buffer> {
  const cols = orderedMetrics((m) => m.inNational);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sales Branch Report Data Monitoring';
  // input.generatedAt hanya teks tampilan berbahasa Indonesia — bukan
  // tanggal yang bisa diparsing, jadi metadata memakai waktu sekarang.
  wb.created = new Date();

  // ySplit 5 = baris 1-5 (judul + dua tingkat header) ikut membeku,
  // sehingga baris cabang pertama tetap berada di area yang bisa digulir.
  const ws = wb.addWorksheet(`MOS ${monthName(input.month)}`, {
    views: [{ state: 'frozen', xSplit: 4, ySplit: 5 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const IDENT = 4; // NO, PLANT, BRANCH / SALESMAN, AREA
  const lastCol = IDENT + cols.length;

  /* ---- Judul ---- */
  ws.mergeCells(1, 1, 1, lastCol);
  const title = ws.getCell(1, 1);
  title.value = `WEEKLY REPORT MOS NASIONAL — ${monthName(input.month)} ${input.year} — MINGGU ${input.week}`;
  title.font = { name: 'Calibri', size: 14, bold: true };
  title.alignment = { horizontal: 'left', vertical: 'middle' };
  ws.getRow(1).height = 22;

  ws.mergeCells(2, 1, 2, lastCol);
  const sub = ws.getCell(2, 1);
  sub.value = `Dihasilkan otomatis oleh sistem pada ${input.generatedAt}. Seluruh kolom hasil perhitungan dihitung ulang dari angka mentah.`;
  sub.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF6B7683' } };

  /* ---- Header baris 4 (grup) & 5 (label) ---- */
  const HG = 4;
  const HL = 5;

  const identLabels = ['NO', 'PLANT', 'BRANCH / SALESMAN', 'AREA'];
  identLabels.forEach((label, i) => {
    const col = i + 1;
    ws.mergeCells(HG, col, HL, col);
    const cell = ws.getCell(HG, col);
    cell.value = label;
    cell.fill = solid(FILL.identity);
    cell.font = { name: 'Calibri', size: 10, bold: true };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { top: MEDIUM, bottom: MEDIUM, left: i === 0 ? MEDIUM : THIN, right: THIN };
  });

  // Grup: gabungkan kolom bersebelahan yang satu grup besar. Memakai
  // mos.top (grup di file MOS asli), bukan field `group` internal, supaya
  // sejalan dengan urutan kolom Excel — QUOT CONFIDENCE misalnya memang
  // bagian dari OUTLOOK PRTM, bukan grup tersendiri.
  let c = IDENT + 1;
  while (c <= lastCol) {
    const group = mosOf(cols[c - IDENT - 1]).top;
    let span = 1;
    while (c + span <= lastCol && mosOf(cols[c + span - IDENT - 1]).top === group) span += 1;

    if (span > 1) ws.mergeCells(HG, c, HG, c + span - 1);
    const g = ws.getCell(HG, c);
    g.value = group;
    g.fill = solid(MOS_FILL[group] ?? FILL.identity);
    g.font = { name: 'Calibri', size: 10, bold: true };
    g.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    for (let k = 0; k < span; k++) {
      ws.getCell(HG, c + k).border = {
        top: MEDIUM,
        bottom: THIN,
        left: k === 0 ? THIN : undefined,
        right: k === span - 1 ? THIN : undefined,
      };
    }
    c += span;
  }

  cols.forEach((m, i) => {
    const col = IDENT + 1 + i;
    const cell = ws.getCell(HL, col);
    cell.value = m.label;
    cell.fill = solid(MOS_FILL[mosOf(m).top] ?? FILL.identity);
    cell.font = { name: 'Calibri', size: 9, bold: true };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { top: THIN, bottom: MEDIUM, left: THIN, right: THIN };
  });

  ws.getRow(HG).height = 20;
  ws.getRow(HL).height = 46;

  /* ---- Baris data ---- */
  let r = 6;
  let no = 0;

  for (const row of input.rows) {
    const isBranch = row.isBranchTotal;
    if (isBranch) no += 1;

    ws.getCell(r, 1).value = isBranch ? no : null;
    ws.getCell(r, 2).value = isBranch ? row.branchCode : null;
    ws.getCell(r, 3).value = isBranch ? row.branchName : `      ${row.salesmanName}`;
    ws.getCell(r, 4).value = isBranch ? row.areaCode : null;

    cols.forEach((m, i) => {
      const cell = ws.getCell(r, IDENT + 1 + i);
      // PLAN SALES MASTER/OL MIN PRTM/ACTUAL SALES (dan turunannya) hanya
      // berarti di baris TOTAL cabang — persis seperti file Excel asli,
      // baris salesman untuk kolom ini selalu kosong, bukan nol.
      cell.value = m.level === 'branch' && !isBranch ? null : num(row.values[m.key]);
      cell.numFmt = numFmt(m);
    });

    for (let col = 1; col <= lastCol; col++) {
      const cell = ws.getCell(r, col);
      cell.font = { name: 'Calibri', size: isBranch ? 10 : 9.5, bold: isBranch };
      cell.border = {
        top: isBranch ? MEDIUM : HAIR,
        bottom: HAIR,
        left: col === 1 ? MEDIUM : HAIR,
        right: col === lastCol ? MEDIUM : HAIR,
      };
      if (isBranch) {
        cell.fill = solid(col <= IDENT ? FILL.branchLabel : FILL.branchValue);
      }
      if (col <= IDENT) {
        cell.alignment = {
          horizontal: col === 1 || col === 4 ? 'center' : 'left',
          vertical: 'middle',
        };
      }
    }

    r += 1;
  }

  /* ---- Baris total ---- */
  r += 1; // satu baris kosong pemisah

  const totalRows: { label: string; values: ValueMap; grand: boolean }[] = [
    { label: 'GRAND TOTAL NASIONAL', values: input.grandTotal, grand: true },
    ...input.areaTotals.map((a) => ({ label: a.name, values: a.values, grand: false })),
  ];

  for (const t of totalRows) {
    ws.mergeCells(r, 1, r, IDENT);
    const label = ws.getCell(r, 1);
    label.value = t.label;
    label.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };

    cols.forEach((m, i) => {
      const cell = ws.getCell(r, IDENT + 1 + i);
      cell.value = num(t.values[m.key]);
      cell.numFmt = numFmt(m);
    });

    for (let col = 1; col <= lastCol; col++) {
      const cell = ws.getCell(r, col);
      cell.font = { name: 'Calibri', size: 10, bold: true };
      cell.fill = solid(
        t.grand ? (col <= IDENT ? FILL.grandLabel : FILL.grandValue) : FILL.areaRow,
      );
      cell.border = {
        top: t.grand ? MEDIUM : THIN,
        bottom: t.grand ? MEDIUM : THIN,
        left: col === 1 ? MEDIUM : THIN,
        right: col === lastCol ? MEDIUM : THIN,
      };
    }
    r += 1;
  }

  /* ---- Lebar kolom ---- */
  ws.getColumn(1).width = 5;
  ws.getColumn(2).width = 9;
  ws.getColumn(3).width = 34;
  ws.getColumn(4).width = 8;
  cols.forEach((m, i) => {
    ws.getColumn(IDENT + 1 + i).width = Math.min(Math.max(m.label.length * 0.62, 12), 18);
  });

  ws.autoFilter = { from: { row: HL, column: 1 }, to: { row: HL, column: lastCol } };

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/* --------------------------------------------------------------------
 *  2. TEMPLATE INPUT CABANG  —  BERFORMAT FILE MOS ASLI
 *
 *  Template ini SENGAJA dibuat identik dengan file Excel yang selama ini
 *  dipakai cabang, sampai ke huruf kolomnya:
 *
 *    Sheet   : '<BULAN> <TAHUN>'  (mis. 'AGUSTUS 2026')
 *    Baris 3-5 : header tiga tingkat
 *    Baris 7   : baris CABANG  (A=NO, B=PLANT/kode, C=BRANCH/nama)
 *                memuat PLAN SALES MASTER (N), OL MIN PRTM (AG),
 *                ACTUAL SALES (BM)
 *    Baris 8.. : baris SALESMAN (C = nama)
 *    Baris akhir: TOTAL
 *
 *  Kolom ditaruh pada POSISI HURUF ASLINYA (N, O, …, BN), bukan dirapatkan.
 *  Itu yang membuat file lama cabang dan file hasil unduhan ini bisa
 *  diparsing oleh kode yang sama (src/lib/excel.ts). Kolom yang tidak
 *  dipakai sistem (D–M, AZ–BL) tetap ada supaya huruf kolom tidak
 *  bergeser, tapi disembunyikan agar tampilannya tetap rapat.
 * ------------------------------------------------------------------ */

export interface TemplateInput {
  branchCode: string;
  branchName: string;
  year: number;
  month: number;
  week: number;
  rows: { salesmanId: string; salesmanName: string; values: ValueMap }[];
  /** PLAN SALES MASTER / OL MIN PRTM / ACTUAL SALES — isi baris cabang. */
  branchValues?: ValueMap;
}

export async function buildBranchTemplateWorkbook(input: TemplateInput): Promise<Buffer> {
  const cols = orderedMetrics((m) => Boolean(m.excel));
  const byColumn = new Map<number, Metric>();
  for (const m of cols) {
    const idx = excelColumnIndex(m.excel);
    if (idx !== Number.MAX_SAFE_INTEGER) byColumn.set(idx, m);
  }
  const lastCol = Math.max(...byColumn.keys());

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sales Branch Report Data Monitoring';

  const sheetName = `${monthName(input.month)} ${input.year}`;
  const ws = wb.addWorksheet(sheetName, {
    views: [{ state: 'frozen', xSplit: 3, ySplit: 5 }],
  });

  const R_TOP = 3;
  const R_SUB = 4;
  const R_TIER = 5;
  const R_BRANCH = 7;

  ws.mergeCells(1, 1, 1, 12);
  const t1 = ws.getCell(1, 1);
  t1.value = `REPORT MOS — ${input.branchName} (${input.branchCode}) — ${sheetName}, MINGGU ${input.week}`;
  t1.font = { name: 'Calibri', size: 14, bold: true };

  ws.mergeCells(2, 1, 2, 12);
  const t2 = ws.getCell(2, 1);
  t2.value =
    'Isi hanya sel angka. Jangan menambah/menghapus baris & kolom, dan jangan mengubah nama salesman di kolom C.';
  t2.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF6B7683' } };

  const HDR_FONT = { name: 'Calibri', size: 11, bold: true } as const;
  const HDR_ALIGN = {
    horizontal: 'center' as const,
    vertical: 'middle' as const,
    wrapText: true,
  };

  function styleHeader(
    row: number,
    col: number,
    fill: string,
    edge: { top?: boolean; bottom?: boolean; left?: boolean } = {},
  ) {
    const cell = ws.getCell(row, col);
    cell.fill = solid(fill);
    cell.font = HDR_FONT;
    cell.alignment = HDR_ALIGN;
    cell.border = {
      top: edge.top ? MEDIUM : THIN,
      bottom: edge.bottom ? MEDIUM : THIN,
      left: edge.left ? MEDIUM : THIN,
      right: THIN,
    };
  }

  /* --- Kolom identitas A, B, C (merge baris 3-5, seperti aslinya) --- */
  ['NO', 'PLANT', 'BRANCH'].forEach((label, i) => {
    const col = i + 1;
    ws.mergeCells(R_TOP, col, R_TIER, col);
    ws.getCell(R_TOP, col).value = label;
    for (let r = R_TOP; r <= R_TIER; r++) {
      styleHeader(r, col, FILL.identity, {
        top: r === R_TOP,
        bottom: r === R_TIER,
        left: col === 1,
      });
    }
  });

  /* --- Baris 3: grup besar --- */
  const used = [...byColumn.keys()].sort((a, b) => a - b);
  let i = 0;
  while (i < used.length) {
    const top = mosOf(byColumn.get(used[i])!).top;
    let j = i;
    while (j + 1 < used.length && mosOf(byColumn.get(used[j + 1])!).top === top) j += 1;
    const from = used[i];
    const to = used[j];
    const fill = MOS_FILL[top] ?? FILL.identity;
    // Grup yang seluruh kolomnya tidak punya sub-header (PLAN SALES
    // MASTER) di-merge tiga baris penuh, persis N3:N5 di file asli.
    const flat = used.slice(i, j + 1).every((c) => !mosOf(byColumn.get(c)!).sub);
    if (flat) {
      ws.mergeCells(R_TOP, from, R_TIER, to);
      ws.getCell(R_TOP, from).value = top;
      for (let r2 = R_TOP; r2 <= R_TIER; r2++) {
        for (let c = from; c <= to; c++) {
          styleHeader(r2, c, fill, { top: r2 === R_TOP, bottom: r2 === R_TIER });
        }
      }
    } else {
      if (to > from) ws.mergeCells(R_TOP, from, R_TOP, to);
      ws.getCell(R_TOP, from).value = top;
      for (let c = from; c <= to; c++) styleHeader(R_TOP, c, fill, { top: true });
    }
    i = j + 1;
  }

  /* --- Baris 4: judul kolom (merge turun ke 5 bila tanpa rincian) --- */
  i = 0;
  while (i < used.length) {
    const info = mosOf(byColumn.get(used[i])!);
    let j = i;
    while (j + 1 < used.length) {
      const next = mosOf(byColumn.get(used[j + 1])!);
      if (next.top !== info.top || next.sub !== info.sub) break;
      j += 1;
    }
    const from = used[i];
    const to = used[j];
    const fill = MOS_FILL[info.top] ?? FILL.identity;
    const hasTier = used.slice(i, j + 1).some((c) => mosOf(byColumn.get(c)!).tier);

    if (!info.sub) {
      // Sudah ditangani baris 3 (merge tiga baris penuh).
      i = j + 1;
      continue;
    }

    if (hasTier) {
      if (to > from) ws.mergeCells(R_SUB, from, R_SUB, to);
      ws.getCell(R_SUB, from).value = info.sub ?? '';
      for (let c = from; c <= to; c++) styleHeader(R_SUB, c, fill);
    } else {
      ws.mergeCells(R_SUB, from, R_TIER, to);
      ws.getCell(R_SUB, from).value = info.sub ?? info.top;
      for (let c = from; c <= to; c++) {
        styleHeader(R_SUB, c, fill);
        styleHeader(R_TIER, c, fill, { bottom: true });
      }
    }
    i = j + 1;
  }

  /* --- Baris 5: rincian --- */
  for (const c of used) {
    const info = mosOf(byColumn.get(c)!);
    if (!info.tier) continue;
    ws.getCell(R_TIER, c).value = info.tier;
    styleHeader(R_TIER, c, MOS_FILL[info.top] ?? FILL.identity, { bottom: true });
  }

  ws.getRow(R_TOP).height = 15;
  ws.getRow(R_SUB).height = 41.25;
  ws.getRow(R_TIER).height = 28.5;

  /* --- Sel isian & sel terkunci ------------------------------------
   * Kolom turunan diberi latar abu dan dikunci: sistem yang menghitung,
   * jadi apa pun yang diketik di sana diabaikan saat upload. */
  function writeDataCell(row: number, col: number, m: Metric, values: ValueMap) {
    const cell = ws.getCell(row, col);
    if (m.kind === 'derived') {
      cell.value = null;
      cell.fill = solid('FFF1F3F5');
    } else {
      cell.value = num(values[m.key]);
      cell.numFmt = m.format === 'percent' ? PERCENT : ACCOUNTING_2DP;
      cell.fill = solid('FFFFFFFF');
    }
    cell.font = { name: 'Calibri', size: 10 };
    cell.border = { top: HAIR, bottom: HAIR, left: HAIR, right: HAIR };
  }

  /* --- Baris 7: cabang --- */
  const branchValues = input.branchValues ?? {};
  ws.getCell(R_BRANCH, 1).value = 1;
  ws.getCell(R_BRANCH, 2).value = input.branchCode;
  ws.getCell(R_BRANCH, 3).value = input.branchName;
  for (const c of used) {
    const m = byColumn.get(c)!;
    // Di baris cabang hanya kolom tingkat cabang yang diisi; sisanya
    // dijumlah sistem dari baris salesman, persis seperti file aslinya.
    if (m.level === 'branch') writeDataCell(R_BRANCH, c, m, branchValues);
    else {
      const cell = ws.getCell(R_BRANCH, c);
      cell.fill = solid('FFF1F3F5');
      cell.border = { top: HAIR, bottom: HAIR, left: HAIR, right: HAIR };
    }
  }
  for (let c = 1; c <= 3; c++) {
    const cell = ws.getCell(R_BRANCH, c);
    cell.font = { name: 'Calibri', size: 10, bold: true };
    cell.fill = solid(FILL.branchLabel);
    cell.border = { top: THIN, bottom: THIN, left: THIN, right: THIN };
  }

  /* --- Baris 8+: salesman --- */
  let r = R_BRANCH + 1;
  for (const row of input.rows) {
    ws.getCell(r, 3).value = row.salesmanName;
    ws.getCell(r, 3).font = { name: 'Calibri', size: 10, bold: true };
    ws.getCell(r, 3).border = { top: HAIR, bottom: HAIR, left: HAIR, right: HAIR };
    for (const c of used) {
      const m = byColumn.get(c)!;
      // Kolom tingkat cabang dikosongkan di baris salesman — di file asli
      // pun selalu kosong (dicek langsung di Sampit.xlsx).
      if (m.level === 'branch') {
        const cell = ws.getCell(r, c);
        cell.fill = solid('FFF1F3F5');
        cell.border = { top: HAIR, bottom: HAIR, left: HAIR, right: HAIR };
        continue;
      }
      writeDataCell(r, c, m, row.values);
    }
    r += 1;
  }

  /* --- Baris penutup TOTAL (dilewati parser, berguna untuk mata) --- */
  const first = R_BRANCH + 1;
  const last = r - 1;
  ws.getCell(r, 1).value = 'TOTAL';
  for (const c of used) {
    const m = byColumn.get(c)!;
    const cell = ws.getCell(r, c);
    if (m.kind === 'input' && m.level !== 'branch' && last >= first) {
      const letter = m.excel as string;
      cell.value = { formula: `SUM(${letter}${first}:${letter}${last})` };
      cell.numFmt = ACCOUNTING_2DP;
    }
    cell.fill = solid(FILL.grandValue);
    cell.border = { top: THIN, bottom: THIN, left: THIN, right: THIN };
  }
  for (let c = 1; c <= 3; c++) {
    const cell = ws.getCell(r, c);
    cell.font = { name: 'Calibri', size: 10, bold: true };
    cell.fill = solid(FILL.grandLabel);
    cell.border = { top: THIN, bottom: THIN, left: THIN, right: THIN };
  }

  /* --- Lebar & kolom yang tidak dipakai --- */
  ws.getColumn(1).width = 5.45;
  ws.getColumn(2).width = 9.45;
  ws.getColumn(3).width = 34;
  for (let c = 4; c <= lastCol; c++) {
    ws.getColumn(c).width = 9.453125;
    // Kolom di luar daftar metrik (D–M, AZ–BL) tidak dipakai sistem.
    // Tetap ada supaya huruf kolom tidak bergeser, tapi disembunyikan.
    if (!byColumn.has(c)) ws.getColumn(c).hidden = true;
  }

  /* Sheet petunjuk */
  const guide = wb.addWorksheet('PETUNJUK');
  guide.columns = [{ width: 6 }, { width: 26 }, { width: 44 }, { width: 30 }, { width: 14 }];

  const steps = [
    'File ini berformat SAMA dengan file MOS yang biasa Anda pakai. Anda juga boleh' +
      ' langsung mengunggah file MOS cabang Anda sendiri tanpa menyalin datanya ke sini.',
    `Sistem membaca sheet "${sheetName}", mencari baris cabang ${input.branchName}` +
      ` (${input.branchCode}) di kolom PLANT/BRANCH, lalu membaca baris salesman di bawahnya.`,
    'Nama salesman di kolom C dipakai untuk mencocokkan data — jangan diubah ejaannya.',
    'PLAN SALES MASTER, OL MIN PRTM, dan ACTUAL SALES diisi SEKALI di baris cabang' +
      ' (baris 7), bukan di baris salesman — persis seperti file MOS asli.',
    'Sel berlatar abu adalah kolom hasil perhitungan. Sistem yang mengisinya; apa pun' +
      ' yang diketik di sana diabaikan, jadi rumus tidak bisa rusak atau jadi #REF!.',
    'Kosongkan sel bila memang tidak ada angka. Jangan diisi teks seperti "-" atau "n/a".',
    'Beberapa kolom disembunyikan (D–M, AZ–BL) karena tidak dipakai sistem. Biarkan saja —' +
      ' kolom itu menjaga posisi huruf kolom agar tetap cocok dengan file asli.',
    'Setelah upload, sistem menampilkan preview perubahan. Data baru tersimpan setelah Anda menekan tombol konfirmasi.',
    'Bila ada angka minggu sebelumnya yang berubah, Anda akan diminta mengisi alasan perubahan.',
  ];

  guide.getCell(1, 1).value = 'PETUNJUK PENGISIAN';
  guide.getCell(1, 1).font = { name: 'Calibri', size: 14, bold: true };

  steps.forEach((s, idx) => {
    const row = 3 + idx;
    guide.getCell(row, 1).value = `${idx + 1}.`;
    guide.getCell(row, 1).alignment = { vertical: 'top' };
    guide.mergeCells(row, 2, row, 5);
    const cell = guide.getCell(row, 2);
    cell.value = s;
    cell.alignment = { wrapText: true, vertical: 'top' };
    guide.getRow(row).height = 26;
  });

  const listStart = 3 + steps.length + 2;
  guide.getCell(listStart, 1).value = 'DAFTAR KOLOM';
  guide.getCell(listStart, 1).font = { name: 'Calibri', size: 12, bold: true };

  const headerRow = listStart + 1;
  ['', 'Kolom Excel', 'Label', 'Diisi oleh', 'Tingkat'].forEach((h, idx) => {
    const cell = guide.getCell(headerRow, idx + 1);
    cell.value = h;
    cell.font = { name: 'Calibri', size: 9, bold: true };
    cell.fill = solid(FILL.identity);
    cell.border = { top: THIN, bottom: THIN, left: THIN, right: THIN };
  });

  cols.forEach((m, idx) => {
    const row = headerRow + 1 + idx;
    guide.getCell(row, 2).value = m.excel ?? '';
    guide.getCell(row, 2).font = { name: 'Consolas', size: 9 };
    guide.getCell(row, 3).value = m.label;
    guide.getCell(row, 4).value = m.kind === 'derived' ? 'Sistem (otomatis)' : 'Cabang';
    guide.getCell(row, 5).value = m.level === 'branch' ? 'Baris cabang' : 'Baris salesman';
    for (let col = 2; col <= 5; col++) {
      guide.getCell(row, col).border = { top: HAIR, bottom: HAIR, left: HAIR, right: HAIR };
    }
  });

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
