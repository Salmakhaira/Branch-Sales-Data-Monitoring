import type { Metric } from './metrics';

/* Warna grup header, meniru sheet MOS asli: OUTLOOK PRTM persik,
 * OUTLOOK REVENUE TM hijau. Dibuat lebih pucat dari Excel supaya angka
 * di bawahnya tetap nyaman dibaca di layar. Dipakai bersama oleh grid
 * input (InputGrid) dan preview upload (UploadPanel) supaya headernya
 * identik di kedua tempat — dan identik dengan file Excel asli.
 *
 * Tanda `!` diperlukan: aturan `.grid-table thead th` di globals.css
 * punya specificity lebih tinggi daripada kelas utilitas biasa, jadi
 * tanpa `!` warnanya ikut abu-abu bawaan tabel. */
export const MOS_TOP_TONE: Record<string, string> = {
  'OUTLOOK PRTM': '!bg-orange-100 !text-orange-900',
  'OUTLOOK REVENUE TM': '!bg-emerald-100 !text-emerald-900',
  'PLAN SALES MASTER': '!bg-sky-100 !text-sky-900',
  'ACTUAL SALES': '!bg-lime-100 !text-lime-900',
};

/* Versi lebih pucat untuk baris judul kolom & rincian, supaya baris grup
 * tetap yang paling menonjol. */
export const MOS_SUB_TONE: Record<string, string> = {
  'OUTLOOK PRTM': '!bg-orange-50 !text-orange-900',
  'OUTLOOK REVENUE TM': '!bg-emerald-50 !text-emerald-900',
  'PLAN SALES MASTER': '!bg-sky-50 !text-sky-900',
  'ACTUAL SALES': '!bg-lime-50 !text-lime-900',
};

export interface MosHeaderRows {
  tops: { label: string; span: number }[];
  subs: { label: string; span: number; hasTier: boolean; top: string }[];
}

/** Susun header BERTINGKAT TIGA, sama seperti sheet MOS di file Excel
 *  cabang:
 *    baris 1 = grup besar   (OUTLOOK PRTM / OUTLOOK REVENUE TM)
 *    baris 2 = judul kolom  (ACT PRTM by SO SAP W1, QUOT CONFIDENCE W1, POCO, …)
 *    baris 3 = rincian      (>80%, >50%-80%, <50%, NOT ACTIVE, PLAFOND, …)
 *  Kolom tanpa rincian: judulnya memanjang ke bawah (rowSpan 2).
 *
 *  Satu fungsi ini dipakai di dua tempat (grid input & preview upload)
 *  supaya keduanya tidak bisa diam-diam berbeda susunannya. */
export function buildMosHeaderRows(columns: Metric[]): MosHeaderRows {
  const info = (m: Metric) => m.mos ?? { top: m.group, sub: m.label };

  const tops: MosHeaderRows['tops'] = [];
  const subs: MosHeaderRows['subs'] = [];

  for (const c of columns) {
    const { top, sub, tier } = info(c);
    const lastTop = tops[tops.length - 1];
    if (lastTop && lastTop.label === top) lastTop.span += 1;
    else tops.push({ label: top, span: 1 });

    const lastSub = subs[subs.length - 1];
    if (lastSub && lastSub.top === top && lastSub.label === (sub ?? '')) {
      lastSub.span += 1;
      lastSub.hasTier ||= Boolean(tier);
    } else {
      subs.push({ label: sub ?? '', span: 1, hasTier: Boolean(tier), top });
    }
  }
  return { tops, subs };
}
