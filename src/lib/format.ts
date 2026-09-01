export const MONTH_NAMES = [
  'JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI',
  'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOPEMBER', 'DESEMBER',
];

export function monthName(month: number): string {
  return MONTH_NAMES[month - 1] ?? String(month);
}

export function periodLabel(year: number, month: number): string {
  return `${monthName(month)} ${year}`;
}

const numberFmt = new Intl.NumberFormat('id-ID', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const wholeNumberFmt = new Intl.NumberFormat('id-ID', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function fmtNumber(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '';
  if (v === 0) return '-';
  return numberFmt.format(v);
}

/** Sama seperti fmtNumber, tapi selalu dibulatkan ke bilangan bulat —
 *  dipakai di kartu ringkasan dashboard (mis. Total PO Outlook) yang
 *  memang tidak butuh presisi desimal, beda dengan grid input yang masih
 *  butuh 2 desimal. */
export function fmtWhole(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '';
  const rounded = Math.round(v);
  if (rounded === 0) return '-';
  return wholeNumberFmt.format(rounded);
}

export function fmtPercent(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '';
  return `${(v * 100).toFixed(1)}%`;
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  // Tanpa `timeZone`, toLocaleString() memakai zona waktu SERVER (di
  // Vercel = UTC), bukan zona waktu pembaca — jamnya jadi mundur 7 jam
  // dari WIB. Dikunci ke Asia/Jakarta supaya selalu sama dengan jam
  // dinding cabang, konsisten dengan REPORTING_TIMEZONE di period.ts yang
  // dipakai untuk aturan minggu.
  return new Date(iso).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jakarta',
  });
}

/** Terima input user "1.234,56" atau "1234.56" -> number. */
export function parseNumberInput(raw: string): number | null {
  const s = raw.trim();
  if (s === '' || s === '-') return null;
  // Jika ada koma DAN titik, anggap titik = pemisah ribuan (format ID)
  let normalized = s;
  if (s.includes(',') && s.includes('.')) {
    normalized = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes(',')) {
    normalized = s.replace(',', '.');
  }
  normalized = normalized.replace(/[^\d.\-]/g, '');
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}
