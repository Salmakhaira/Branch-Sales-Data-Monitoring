/* =====================================================================
 *  UJI RUMUS  —  npm run test:formula
 *
 *  Membandingkan hasil mesin perhitungan (src/lib/metrics.ts) dengan
 *  angka asli pada file Excel yang dipakai saat ini.
 *
 *  Fixture : scripts/fixtures/mos-sampit.json
 *  Sumber  : sheet 'MOS' pada Sampit.xlsx (kondisi minggu ke-3)
 *
 *  Catatan penting:
 *  Setiap baris diuji memakai minggu yang DIRUJUK OLEH RUMUS EXCEL-nya
 *  sendiri, bukan minggu global. Alasannya, di file Excel asli sebagian
 *  baris ternyata masih menunjuk kolom minggu yang salah (sisa copy-paste
 *  bulan sebelumnya). Anomali itu dilaporkan terpisah di bawah — bukan
 *  sebagai kegagalan sistem, melainkan sebagai temuan yang justru
 *  menjadi alasan kuat proses ini didigitalkan.
 * =================================================================== */

import fixture from './fixtures/mos-sampit.json';
import { computeRow, type ValueMap } from '../src/lib/metrics';

const TOLERANCE = 1e-6;

interface Row {
  row: number;
  name: string;
  formulaWeekAF: number | null;
  formulaWeekAJ: number | null;
  values: Record<string, number | null>;
  expected: Record<string, number | null>;
}

interface Anomaly {
  row: number;
  name: string;
  af: string;
  aj: string;
  note: string;
}

const rows = fixture.rows as Row[];
const anomalies = fixture.excelAnomalies as Anomaly[];
const defaultWeek = fixture.defaultWeek as number;

let checked = 0;
let failed = 0;
const failures: string[] = [];

for (const r of rows) {
  for (const [key, expected] of Object.entries(r.expected)) {
    if (expected === null || expected === undefined) continue;

    // total_po & total_po_outlook mengacu ke rumus AJ; sisanya ke AF
    const week =
      key === 'total_po' || key === 'total_po_outlook'
        ? (r.formulaWeekAJ ?? defaultWeek)
        : (r.formulaWeekAF ?? defaultWeek);

    // total_po_outlook = AF + AI, jadi butuh minggu AF untuk komponen AF-nya.
    const computed =
      key === 'total_po_outlook'
        ? computeRow(r.values as ValueMap, { week: r.formulaWeekAF ?? defaultWeek })
        : computeRow(r.values as ValueMap, { week });

    const actual = computed[key];
    checked += 1;
    const diff = Math.abs((actual ?? 0) - expected);
    if (diff > TOLERANCE) {
      failed += 1;
      failures.push(
        `  baris ${r.row} (${r.name}) · ${key} [minggu ${week}]\n` +
          `      Excel  : ${expected}\n` +
          `      Sistem : ${actual}\n` +
          `      selisih: ${diff}`,
      );
    }
  }
}

const line = '─'.repeat(70);
console.log(line);
console.log(`Sumber    : ${fixture.sheet}`);
console.log(`Baris uji : ${rows.length} baris salesman`);
console.log(`Nilai uji : ${checked} (TOTAL OL PRTM, BALANCE PRTM, TOTAL PO, TOTAL PO OUTLOOK)`);
console.log(line);

if (failed === 0) {
  console.log(`✓ LULUS — ${checked} dari ${checked} nilai identik dengan Excel (toleransi ${TOLERANCE}).`);
} else {
  console.log(`✗ GAGAL — ${failed} dari ${checked} nilai tidak cocok:\n`);
  console.log(failures.slice(0, 20).join('\n\n'));
}

console.log('');
console.log(line);
console.log('TEMUAN PADA FILE EXCEL SAAT INI');
console.log(line);

if (anomalies.length === 0) {
  console.log('Tidak ditemukan ketidakkonsistenan rumus.');
} else {
  console.log(
    `${anomalies.length} dari ${rows.length} baris salesman (${(
      (anomalies.length / rows.length) *
      100
    ).toFixed(0)}%) memiliki rumus yang menunjuk kolom minggu berbeda\n` +
      'antara TOTAL OL PRTM dan TOTAL PO pada baris yang sama:\n',
  );
  for (const a of anomalies) {
    console.log(`  • Baris ${a.row} — ${a.name}`);
    console.log(`      AF (TOTAL OL PRTM): ${a.af}`);
    console.log(`      AJ (TOTAL PO)     : ${a.aj}`);
  }
  console.log(
    '\n  Di sistem baru hal ini tidak mungkin terjadi: rumus ditulis satu kali\n' +
      '  di src/lib/metrics.ts dan dipakai seragam untuk seluruh baris.',
  );
}

process.exit(failed === 0 ? 0 : 1);
