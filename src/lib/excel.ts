import * as XLSX from 'xlsx';
import { SALESMAN_INPUT_KEYS, METRIC_BY_KEY, type ValueMap } from '@/lib/metrics';

/* =====================================================================
 *  PARSER TEMPLATE UPLOAD  (berjalan di browser)
 *
 *  Template dibuat oleh /api/template (lihat src/lib/xlsx-styled.ts) dan
 *  dirancang supaya aman diparsing:
 *
 *    Baris 1-2 : judul
 *    Baris 3   : grup besar   (meniru header MOS asli, mis. 'OUTLOOK PRTM')
 *    Baris 4   : judul kolom  (mis. 'QUOT CONFIDENCE W1')
 *    Baris 5   : rincian      (mis. '>80%') — kosong bila baris 4 di-merge turun
 *    Baris 6   : KUNCI TEKNIS (field_key) — inilah yang dibaca parser
 *    Baris 7+  : data, satu baris per salesman
 *
 *  Karena parser mencari baris kunci berdasarkan ISI, bukan posisi,
 *  menggeser baris atau menyisipkan kolom tidak merusak proses import.
 *
 *  Kolom A = nama salesman, kolom B = ID salesman (pencocokan pasti;
 *  bila ID hilang, jatuh ke pencocokan nama).
 *
 *  Parsing sengaja dilakukan di browser agar preview perubahan muncul
 *  seketika tanpa perlu mengunggah file dulu.
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
  issues: ParseIssue[];
  unknownColumns: string[];
}

export function parseBranchTemplate(
  data: ArrayBuffer,
  knownSalesmen: { id: string; name: string }[],
): ParseResult {
  const issues: ParseIssue[] = [];
  const wb = XLSX.read(data, { type: 'array' });
  const sheetName = wb.SheetNames.includes('INPUT') ? 'INPUT' : wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];

  if (!ws) {
    return {
      rows: [],
      issues: [{ level: 'error', message: 'Sheet tidak ditemukan di dalam file.' }],
      unknownColumns: [],
    };
  }

  const aoa = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
    header: 1,
    blankrows: false,
    defval: null,
  });

  const keyRowIdx = aoa.findIndex(
    (r) => Array.isArray(r) && r[0] === '__salesman_name' && r[1] === '__salesman_id',
  );

  if (keyRowIdx === -1) {
    return {
      rows: [],
      issues: [
        {
          level: 'error',
          message:
            'Baris kunci teknis tidak ditemukan. Pastikan Anda memakai template yang diunduh dari sistem, dan baris kunci (baris ke-6) tidak dihapus.',
        },
      ],
      unknownColumns: [],
    };
  }

  const keyRow = aoa[keyRowIdx] as (string | null)[];
  const colToKey = new Map<number, string>();
  const unknownColumns: string[] = [];

  for (let i = 2; i < keyRow.length; i++) {
    const key = (keyRow[i] ?? '').toString().trim();
    if (!key) continue;
    if (!SALESMAN_INPUT_KEYS.includes(key)) {
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

  const byId = new Map(knownSalesmen.map((s) => [s.id, s]));
  const byName = new Map(knownSalesmen.map((s) => [normalize(s.name), s]));
  const seen = new Set<string>();
  const rows: TemplateRow[] = [];

  for (let r = keyRowIdx + 1; r < aoa.length; r++) {
    const line = aoa[r];
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
      const cell = line[col];
      if (cell === null || cell === undefined || cell === '') {
        values[key] = null;
        continue;
      }
      const numeric =
        typeof cell === 'number'
          ? cell
          : Number(
              String(cell)
                .replace(/[^\d.,\-]/g, '')
                .replace(',', '.'),
            );
      if (!Number.isFinite(numeric)) {
        issues.push({
          level: 'error',
          row: r + 1,
          message: `Nilai "${cell}" pada kolom ${METRIC_BY_KEY[key]?.label ?? key} (${match.name}) bukan angka.`,
        });
        continue;
      }
      values[key] = numeric;
    }

    rows.push({ salesmanId: match.id, salesmanName: match.name, values });
  }

  const notInFile = knownSalesmen.filter((s) => !seen.has(s.id));
  if (notInFile.length) {
    issues.push({
      level: 'warning',
      message: `${notInFile.length} salesman tidak ada di file (${notInFile
        .map((s) => s.name)
        .join(', ')}). Datanya tidak diubah.`,
    });
  }

  return { rows, issues, unknownColumns };
}

function normalize(s: string): string {
  return s.trim().toUpperCase().replace(/\s+/g, ' ');
}
