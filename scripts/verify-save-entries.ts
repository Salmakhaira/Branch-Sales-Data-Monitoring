/**
 * Skrip verifikasi src/lib/saveEntries.ts — terutama jalur BARU
 * (allowPartialOnConflict) yang dipakai webhook Power Automate.
 *
 * Jalankan: npx tsx scripts/verify-save-entries.ts
 *
 * Tidak menyentuh database sungguhan — memakai mock Supabase client
 * sederhana yang meniru pola query yang dipakai saveEntries.ts.
 */
import { saveEntries } from '../src/lib/saveEntries';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++;
    console.log(`  \u2713 ${label}`);
  } else {
    failed++;
    console.error(`  \u2717 GAGAL: ${label}`);
  }
}

/** Mock Supabase client yang chainable & thenable, isi datanya per tabel. */
function mockSupabase(tableData: Record<string, any>) {
  function makeChain(table: string, overrideResult?: any) {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      in: () => chain,
      upsert: (rows: any) => {
        chain._upserted = rows;
        return chain;
      },
      insert: async (rows: any) => {
        chain._inserted = rows;
        return { data: rows, error: null };
      },
      single: async () => ({ data: overrideResult ?? tableData[table]?.single ?? null, error: null }),
      maybeSingle: async () => ({ data: overrideResult ?? tableData[table]?.single ?? null, error: null }),
      then: (resolve: any) => {
        if (chain._upserted) {
          resolve({ data: tableData[table]?.upsertResult ?? chain._upserted, error: null });
        } else {
          resolve({ data: tableData[table]?.list ?? [], error: null });
        }
      },
    };
    return chain;
  }

  return {
    from: (table: string) => makeChain(table),
  };
}

async function testAllowPartialSkipsOnlyConflictingField() {
  console.log('\nTest: allowPartialOnConflict=true melewati SATU field yang konflik, menyimpan sisanya');

  const salesmanId = 'sm-1';
  const branchId = 'branch-1';
  const periodId = 'period-1';

  const supabase = mockSupabase({
    periods: { single: { id: periodId, year: 2026, month: 9, current_week: 2, is_open: true } },
    branch_submissions: { list: [{ week_no: 1 }] }, // minggu 1 sudah di-submit -> terkunci
    report_entries: {
      list: [{ id: 'entry-1', salesman_id: salesmanId, values: { act_prtm_w1: 100, act_prtm_w2: 50 } }],
      upsertResult: [{ id: 'entry-1', salesman_id: salesmanId }],
    },
    report_snapshots: {
      list: [{ salesman_id: salesmanId, week_no: 1, values: { act_prtm_w1: 100 } }],
    },
    report_branch_entries: { single: null },
    report_branch_snapshots: { list: [] },
    salesmen: { list: [{ id: salesmanId, name: 'Test Salesman', branch_id: branchId }] },
    entry_revisions: {},
  });

  const result = await saveEntries({
    supabase: supabase as any,
    actor: null,
    periodId,
    branchId,
    rows: [
      {
        salesmanId,
        values: {
          act_prtm_w1: 999, // W1 SUDAH terkunci (lastSubmittedWeek=1) & beda dari snapshot -> butuh alasan, tanpa alasan -> harus DILEWATI
          act_prtm_w2: 75, // W2 belum terkunci -> harus tetap TERSIMPAN
        },
      },
    ],
    source: 'power_automate',
    allowPartialOnConflict: true,
  });

  assert(result.ok === true, 'request tidak boleh gagal total (bukan 409)');
  assert(result.skipped === 1, `field terkunci harus dihitung sebagai skipped (dapat: ${result.skipped})`);
  assert(result.conflicts.length === 1, 'harus ada 1 conflict yang dicatat untuk ditinjau');
  assert(
    result.conflicts[0]?.fieldKey === 'act_prtm_w1',
    `conflict harus pada act_prtm_w1 (dapat: ${result.conflicts[0]?.fieldKey})`,
  );
}

async function testStrictModeBlocksEntirelyOnConflict() {
  console.log('\nTest: allowPartialOnConflict=false (default, jalur interaktif) TETAP menolak seluruh request seperti semula');

  const salesmanId = 'sm-1';
  const branchId = 'branch-1';
  const periodId = 'period-1';

  const supabase = mockSupabase({
    periods: { single: { id: periodId, year: 2026, month: 9, current_week: 2, is_open: true } },
    branch_submissions: { list: [{ week_no: 1 }] },
    report_entries: {
      list: [{ id: 'entry-1', salesman_id: salesmanId, values: { act_prtm_w1: 100 } }],
    },
    report_snapshots: {
      list: [{ salesman_id: salesmanId, week_no: 1, values: { act_prtm_w1: 100 } }],
    },
    report_branch_entries: { single: null },
    report_branch_snapshots: { list: [] },
    salesmen: { list: [{ id: salesmanId, name: 'Test Salesman', branch_id: branchId }] },
  });

  const result = await saveEntries({
    supabase: supabase as any,
    actor: { id: 'user-1', role: 'cabang', branch_id: branchId },
    periodId,
    branchId,
    rows: [{ salesmanId, values: { act_prtm_w1: 999 } }],
    source: 'grid',
    allowPartialOnConflict: false,
  });

  assert(result.ok === false, 'request harus ditolak (bukan tersimpan sebagian)');
  assert(result.status === 409, `status harus 409 (dapat: ${result.status})`);
  assert(result.error === 'reason_required', 'error harus reason_required, sama seperti perilaku asli');
}

async function testNonAdminActorRejectedForOtherBranch() {
  console.log('\nTest: actor role cabang ditolak kalau branchId bukan cabangnya sendiri');

  const supabase = mockSupabase({});
  const result = await saveEntries({
    supabase: supabase as any,
    actor: { id: 'user-1', role: 'cabang', branch_id: 'branch-lain' },
    periodId: 'period-1',
    branchId: 'branch-1',
    rows: [],
    source: 'grid',
  });

  assert(result.ok === false, 'request harus ditolak');
  assert(result.status === 403, `status harus 403 (dapat: ${result.status})`);
}

async function testSystemActorBypassesRoleCheck() {
  console.log('\nTest: actor null (webhook) tidak diblokir oleh pengecekan role cabang');

  const branchId = 'branch-1';
  const periodId = 'period-1';
  const supabase = mockSupabase({
    periods: { single: { id: periodId, year: 2026, month: 9, current_week: 1, is_open: true } },
    branch_submissions: { list: [] },
    report_entries: { list: [], upsertResult: [{ id: 'e1', salesman_id: 'sm-1' }] },
    report_snapshots: { list: [] },
    report_branch_entries: { single: null },
    report_branch_snapshots: { list: [] },
    salesmen: { list: [{ id: 'sm-1', name: 'Test', branch_id: branchId }] },
    entry_revisions: {},
  });

  const result = await saveEntries({
    supabase: supabase as any,
    actor: null,
    periodId,
    branchId,
    rows: [{ salesmanId: 'sm-1', values: { act_prtm_w1: 50 } }],
    source: 'power_automate',
    allowPartialOnConflict: true,
  });

  assert(result.ok === true, `actor null harus lolos otorisasi (error: ${result.error})`);
}

async function main() {
  await testAllowPartialSkipsOnlyConflictingField();
  await testStrictModeBlocksEntirelyOnConflict();
  await testNonAdminActorRejectedForOtherBranch();
  await testSystemActorBypassesRoleCheck();

  console.log(`\n${passed} lolos, ${failed} gagal.`);
  if (failed > 0) process.exit(1);
}

main();
