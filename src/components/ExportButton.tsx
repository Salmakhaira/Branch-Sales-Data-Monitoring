'use client';

/* File dibangun di server (/api/export) dengan ExcelJS supaya hasilnya
 * bisa diberi format lengkap — merge, warna, border, format akunting —
 * tanpa membebani bundle yang diunduh browser. */

export default function ExportButton({ periodId }: { periodId: string }) {
  return (
    <a
      href={`/api/export?period=${periodId}`}
      className="rounded-lg border border-emerald-600 px-3 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-50"
    >
      ⬇ Export Excel
    </a>
  );
}
