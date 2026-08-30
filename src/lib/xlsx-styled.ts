import ExcelJS from 'exceljs';
import { orderedMetrics, type Metric, type ValueMap } from '@/lib/metrics';
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
 *  2. TEMPLATE INPUT CABANG
 *
 *  Struktur baris WAJIB dipertahankan — parser di src/lib/excel.ts
 *  mencari baris kunci teknis '__salesman_name' / '__salesman_id'.
 * ------------------------------------------------------------------ */

export interface TemplateInput {
  branchCode: string;
  branchName: string;
  year: number;
  month: number;
  week: number;
  rows: { salesmanId: string; salesmanName: string; values: ValueMap }[];
}

export async function buildBranchTemplateWorkbook(input: TemplateInput): Promise<Buffer> {
  // PLAN SALES MASTER/OL MIN PRTM/ACTUAL SALES tidak ikut template ini —
  // ketiganya diisi SEKALI untuk seluruh cabang (persis baris TOTAL di
  // Excel asli), lewat panel "Data Tingkat Cabang" di halaman Input, bukan
  // per salesman lewat file upload.
  const inputCols = orderedMetrics((m) => m.kind === 'input' && m.level !== 'branch');

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sales Branch Report Data Monitoring';

  const ws = wb.addWorksheet('INPUT', {
    views: [{ state: 'frozen', xSplit: 2, ySplit: 6 }],
  });

  const IDENT = 2;
  const lastCol = IDENT + inputCols.length;

  /* Header meniru PERSIS sheet MOS di Sampit.xlsx: tiga tingkat di baris
   * 3-4-5, dengan pola merge yang sama (grup besar di baris 3; judul kolom
   * di baris 4, di-merge turun ke baris 5 bila tidak punya rincian; rincian
   * seperti '>80%' / 'NOT ACTIVE' di baris 5). Baris 6 tetap kunci teknis
   * dan baris 7 ke bawah tetap data — parser mencari baris kunci
   * berdasarkan isinya, jadi posisi header boleh berubah. */
  const R_TOP = 3;
  const R_SUB = 4;
  const R_TIER = 5;

  ws.mergeCells(1, 1, 1, Math.min(lastCol, 12));
  const t1 = ws.getCell(1, 1);
  t1.value = `REPORT MOS — ${input.branchName} (${input.branchCode})`;
  t1.font = { name: 'Calibri', size: 14, bold: true };

  ws.mergeCells(2, 1, 2, Math.min(lastCol, 12));
  const t2 = ws.getCell(2, 1);
  t2.value = `Periode ${monthName(input.month)} ${input.year} — Minggu ${input.week}. Isi hanya sel angka; jangan menambah atau menghapus baris & kolom.`;
  t2.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF6B7683' } };

  /* Baris 3-4-5 = header bertingkat, 6 = kunci teknis (dibaca parser) */
  const HDR_FONT = { name: 'Calibri', size: 11, bold: true } as const;
  const HDR_ALIGN = {
    horizontal: 'center' as const,
    vertical: 'middle' as const,
    wrapText: true,
  };

  /** Terapkan gaya header pada satu sel. `edge` menentukan garis tepi
   *  tebal, meniru file asli (medium di atas baris 3 & bawah baris 5). */
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

  // Kolom identitas: di file asli A3:A5 dst. di-merge tiga baris penuh.
  const identHeaders = ['SALESMAN', 'ID (disembunyikan — jangan di-unhide/diubah)'];
  identHeaders.forEach((label, i) => {
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

  // Baris 3 — grup besar (mis. 'OUTLOOK PRTM' yang di aslinya membentang
  // dari ACT PRTM sampai TOTAL PO OUTLOOK).
  let c = IDENT + 1;
  while (c <= lastCol) {
    const top = mosOf(inputCols[c - IDENT - 1]).top;
    let span = 1;
    while (c + span <= lastCol && mosOf(inputCols[c + span - IDENT - 1]).top === top) span += 1;
    if (span > 1) ws.mergeCells(R_TOP, c, R_TOP, c + span - 1);
    ws.getCell(R_TOP, c).value = top;
    const fill = MOS_FILL[top] ?? FILL.identity;
    for (let k = 0; k < span; k++) styleHeader(R_TOP, c + k, fill, { top: true });
    c += span;
  }

  // Baris 4 — judul kolom. Bila tidak ada rincian di baris 5, sel ini
  // di-merge turun ke baris 5 (persis O4:O5, AE4:AE5, AU4:AU5 di aslinya).
  c = IDENT + 1;
  while (c <= lastCol) {
    const here = mosOf(inputCols[c - IDENT - 1]);
    let span = 1;
    while (c + span <= lastCol) {
      const next = mosOf(inputCols[c + span - IDENT - 1]);
      if (next.top !== here.top || next.sub !== here.sub) break;
      span += 1;
    }
    const fill = MOS_FILL[here.top] ?? FILL.identity;
    const hasTier = Array.from({ length: span }, (_, k) =>
      mosOf(inputCols[c + k - IDENT - 1]).tier,
    ).some(Boolean);

    if (hasTier) {
      if (span > 1) ws.mergeCells(R_SUB, c, R_SUB, c + span - 1);
      ws.getCell(R_SUB, c).value = here.sub ?? '';
      for (let k = 0; k < span; k++) styleHeader(R_SUB, c + k, fill);
    } else {
      // tidak punya rincian -> judulnya menempati baris 4 DAN 5
      ws.mergeCells(R_SUB, c, R_TIER, c + span - 1);
      ws.getCell(R_SUB, c).value = here.sub ?? '';
      for (let k = 0; k < span; k++) {
        styleHeader(R_SUB, c + k, fill);
        styleHeader(R_TIER, c + k, fill, { bottom: true });
      }
    }
    c += span;
  }

  // Baris 5 — rincian ('>80%', '>50%-80%', '<50%', 'NOT ACTIVE', dst.)
  inputCols.forEach((m, i) => {
    const info = mosOf(m);
    if (!info.tier) return;
    const col = IDENT + 1 + i;
    ws.getCell(R_TIER, col).value = info.tier;
    styleHeader(R_TIER, col, MOS_FILL[info.top] ?? FILL.identity, { bottom: true });
  });

  // Baris kunci teknis — sengaja dibuat pucat & kecil supaya tidak
  // mengganggu mata, tapi TIDAK disembunyikan agar tidak terhapus.
  ws.getCell(6, 1).value = '__salesman_name';
  ws.getCell(6, 2).value = '__salesman_id';
  inputCols.forEach((m, i) => {
    ws.getCell(6, IDENT + 1 + i).value = m.key;
  });
  for (let col = 1; col <= lastCol; col++) {
    const cell = ws.getCell(6, col);
    cell.font = { name: 'Consolas', size: 7, color: { argb: 'FFAAB2BB' } };
    cell.fill = solid('FFF2F4F6');
    cell.alignment = { horizontal: 'center' };
    cell.border = { top: THIN, bottom: MEDIUM, left: THIN, right: THIN };
  }

  // Tinggi baris persis seperti sheet MOS asli (baris 4 = 41,25; 5 = 28,5).
  ws.getRow(R_TOP).height = 15;
  ws.getRow(R_SUB).height = 41.25;
  ws.getRow(R_TIER).height = 28.5;
  ws.getRow(6).height = 11;

  /* Data */
  let r = 7;
  for (const row of input.rows) {
    ws.getCell(r, 1).value = row.salesmanName;
    ws.getCell(r, 2).value = row.salesmanId;
    inputCols.forEach((m, i) => {
      const cell = ws.getCell(r, IDENT + 1 + i);
      cell.value = num(row.values[m.key]);
      cell.numFmt = ACCOUNTING_2DP;
      // Sel isian diberi latar putih bersih agar jelas mana yang boleh diketik
      cell.fill = solid('FFFFFFFF');
    });
    for (let col = 1; col <= lastCol; col++) {
      const cell = ws.getCell(r, col);
      cell.font = { name: 'Calibri', size: 10, bold: col === 1 };
      cell.border = { top: HAIR, bottom: HAIR, left: HAIR, right: HAIR };
    }
    ws.getCell(r, 2).font = { name: 'Consolas', size: 7, color: { argb: 'FFAAB2BB' } };
    r += 1;
  }

  ws.getColumn(1).width = 30;
  // Kolom ID dipakai parser untuk mencocokkan salesman secara pasti, tapi
  // tidak perlu terlihat/diketik user — disembunyikan daripada cuma
  // "diminta jangan diubah". Tetap ada nilainya dan tetap kebaca parser
  // (SheetJS membaca kolom tersembunyi seperti biasa).
  ws.getColumn(2).width = 38;
  ws.getColumn(2).hidden = true;
  // Lebar kolom data disamakan dengan file MOS asli (9,453125).
  inputCols.forEach((_m, i) => {
    ws.getColumn(IDENT + 1 + i).width = 9.453125;
  });

  /* Sheet petunjuk */
  const guide = wb.addWorksheet('PETUNJUK');
  guide.columns = [
    { width: 6 },
    { width: 26 },
    { width: 44 },
    { width: 30 },
    { width: 14 },
  ];

  const steps = [
    'PLAN SALES MASTER, OL MIN PRTM, dan ACTUAL SALES TIDAK ADA di template ini — ketiganya' +
      ' diisi sekali untuk seluruh cabang lewat panel "Data Tingkat Cabang" di halaman Input' +
      ' website, bukan per salesman.',
    'Isi HANYA sel angka di sheet INPUT. Jangan menambah atau menghapus baris dan kolom.',
    'Ada kolom ID salesman yang disembunyikan (kolom B) untuk mencocokkan data — biarkan' +
      ' tetap tersembunyi, jangan di-unhide atau diisi ulang.',
    'Baris 3-4-5 adalah header bertingkat, dibuat sama persis dengan sheet MOS di file' +
      ' Excel cabang. Baris ke-6 berisi kunci teknis kolom — jangan diubah atau dihapus.',
    'Kosongkan sel bila memang tidak ada angka. Jangan diisi teks seperti "-" atau "n/a".',
    'Kolom hasil perhitungan tidak ada di template karena dihitung otomatis oleh sistem.',
    'Setelah upload, sistem menampilkan preview perubahan. Data baru tersimpan setelah Anda menekan tombol konfirmasi.',
    'Bila ada angka minggu sebelumnya yang berubah, Anda akan diminta mengisi alasan perubahan.',
  ];

  guide.getCell(1, 1).value = 'PETUNJUK PENGISIAN';
  guide.getCell(1, 1).font = { name: 'Calibri', size: 14, bold: true };

  steps.forEach((s, i) => {
    const row = 3 + i;
    guide.getCell(row, 1).value = `${i + 1}.`;
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
  ['', 'Kunci teknis', 'Label', 'Grup', 'Kolom Excel lama'].forEach((h, i) => {
    const cell = guide.getCell(headerRow, i + 1);
    cell.value = h;
    cell.font = { name: 'Calibri', size: 9, bold: true };
    cell.fill = solid(FILL.identity);
    cell.border = { top: THIN, bottom: THIN, left: THIN, right: THIN };
  });

  inputCols.forEach((m, i) => {
    const row = headerRow + 1 + i;
    guide.getCell(row, 2).value = m.key;
    guide.getCell(row, 2).font = { name: 'Consolas', size: 9 };
    guide.getCell(row, 3).value = m.label;
    guide.getCell(row, 4).value = m.group;
    guide.getCell(row, 5).value = m.excel ?? '';
    for (let col = 2; col <= 5; col++) {
      guide.getCell(row, col).border = { top: HAIR, bottom: HAIR, left: HAIR, right: HAIR };
    }
  });

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
