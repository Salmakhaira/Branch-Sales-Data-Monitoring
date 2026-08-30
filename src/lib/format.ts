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

export function fmtNumber(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '';
  if (v === 0) return '-';
  return numberFmt.format(v);
}

export function fmtPercent(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '';
  return `${(v * 100).toFixed(1)}%`;
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
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
