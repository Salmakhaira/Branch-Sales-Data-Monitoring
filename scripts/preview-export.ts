/* =====================================================================
 *  PRATINJAU FILE EXPORT  —  npx tsx scripts/preview-export.ts
 *
 *  Membuat contoh file rekap nasional dan template cabang memakai data
 *  dummy, tanpa perlu database. Berguna untuk memeriksa format Excel
 *  (merge, warna, border, format angka) tanpa menjalankan aplikasi.
 *
 *  Hasil: scripts/output/contoh-rekap-nasional.xlsx
 *         scripts/output/contoh-template-cabang.xlsx
 * =================================================================== */

import { mkdirSync, writeFileSync } from 'node:fs';
import { aggregateRows, computeRow, INPUT_KEYS, type ValueMap } from '../src/lib/metrics';
import { buildBranchTemplateWorkbook, buildNationalWorkbook, type NationalRow } from '../src/lib/xlsx-styled';

const BRANCHES = [
  { code: 'SMD-1', name: 'SAMARINDA-1', area: 'ZDJ', salesmen: ['ADITIA KURNIAWAN', 'GERINDRA YONKY', 'HENDRA SIHOMBING', 'SHN'] },
  { code: 'SMP', name: 'SAMPIT', area: 'ZDJ', salesmen: ['ANDREW NOFENESIA', 'HADI ISNANDAR', 'HENDRA SAPUTRA', 'HADI PRAYITNO'] },
  { code: 'JMB', name: 'JAMBI', area: 'BBB', salesmen: ['ALIF ALVIANTO', 'SHN'] },
  { code: 'MKS', name: 'MAKASSAR', area: 'STH', salesmen: ['M. FADLY SINGKANG', 'WAHYUDDIN ABDULLAH', 'ZYAINI BHARKAH'] },
];

const AREAS = [
  { code: 'ZDJ', name: 'AREA 1 (ZDJ)' },
  { code: 'BBB', name: 'AREA 2 (BBB)' },
  { code: 'STH', name: 'AREA 3 (STH)' },
];

const WEEK = 3;
const ctx = { week: WEEK };

/* Angka dummy yang deterministik (tanpa Math.random) supaya file hasil
 * pratinjau selalu sama dan mudah dibandingkan antar perubahan. */
let seed = 7;
function nextNumber(scale = 1000): number {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return Math.round(((seed / 2147483648) * scale + 10) * 100) / 100;
}

function dummyValues(): ValueMap {
  const v: ValueMap = {};
  for (const key of INPUT_KEYS) {
    v[key] = key.startsWith('quot_') ? nextNumber(2500) : nextNumber(900);
  }
  return v;
}

async function main() {
  const blocks = BRANCHES.map((b) => {
    const rows = b.salesmen.map((name) => ({ name, values: computeRow(dummyValues(), ctx) }));
    return { ...b, rows, total: aggregateRows(rows.map((r) => r.values), ctx) };
  });

  const rows: NationalRow[] = blocks.flatMap((bb) => [
    {
      branchCode: bb.code,
      branchName: bb.name,
      areaCode: bb.area,
      salesmanName: null,
      values: bb.total,
      isBranchTotal: true,
    },
    ...bb.rows.map((r) => ({
      branchCode: bb.code,
      branchName: bb.name,
      areaCode: bb.area,
      salesmanName: r.name,
      values: r.values,
      isBranchTotal: false,
    })),
  ]);

  const areaTotals = AREAS.map((a) => ({
    code: a.code,
    name: a.name,
    values: aggregateRows(blocks.filter((b) => b.area === a.code).map((b) => b.total), ctx),
  }));

  const grandTotal = aggregateRows(blocks.map((b) => b.total), ctx);

  mkdirSync('scripts/output', { recursive: true });

  const national = await buildNationalWorkbook({
    year: 2026,
    month: 8,
    week: WEEK,
    rows,
    areaTotals,
    grandTotal,
    generatedAt: 'Rabu, 26 Agustus 2026 pukul 15.30 WIB',
  });
  writeFileSync('scripts/output/contoh-rekap-nasional.xlsx', national);

  const sampit = blocks.find((b) => b.code === 'SMP')!;
  const template = await buildBranchTemplateWorkbook({
    branchCode: sampit.code,
    branchName: sampit.name,
    year: 2026,
    month: 8,
    week: WEEK,
    rows: sampit.rows.map((r, i) => ({
      salesmanId: `00000000-0000-0000-0000-00000000000${i + 1}`,
      salesmanName: r.name,
      values: r.values,
    })),
  });
  writeFileSync('scripts/output/contoh-template-cabang.xlsx', template);

  console.log('✓ scripts/output/contoh-rekap-nasional.xlsx');
  console.log('✓ scripts/output/contoh-template-cabang.xlsx');
  console.log(`  ${rows.length} baris · ${areaTotals.length} area · minggu ${WEEK}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
