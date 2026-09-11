import { submitWeek } from '../src/lib/submitWeek';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ GAGAL: ${label}`);
  }
}

function mockSupabase(tableData: Record<string, any>) {
  function makeChain(table: string) {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      insert: async (rows: any) => ({ data: rows, error: null }),
      single: async () => ({ data: tableData[table]?.single ?? null, error: null }),
      maybeSingle: async () => ({ data: tableData[table]?.single ?? null, error: null }),
      then: (resolve: any) => resolve({ data: tableData[table]?.list ?? [], error: null }),
    };
    return chain;
  }
  return { from: (table: string) => makeChain(table) };
}

async function testSystemActorBypassesRoleCheck() {
  console.log('\nTest: actor null (webhook/impor massal) tidak diblokir pengecekan role');
  const supabase = mockSupabase({
    periods: { single: { id: 'p1', year: 2026, month: 1, is_open: true } }, // bulan lampau -> maxWeek 4
    branch_submissions: { single: null }, // belum pernah submit minggu ini
    report_entries: { list: [{ salesman_id: 's1', values: { act_prtm_w3: 100 } }] },
    report_branch_entries: { single: null },
  });

  const result = await submitWeek({
    supabase: supabase as any,
    actor: null,
    periodId: 'p1',
    branchId: 'b1',
    week: 3,
    allowAlreadySubmitted: true,
  });

  assert(result.ok === true, `actor null harus lolos (error: ${result.error})`);
  assert(result.week === 3, 'minggu yang di-submit harus 3');
}

async function testAlreadySubmittedToleratedForSystemActor() {
  console.log('\nTest: allowAlreadySubmitted=true tidak error kalau minggu itu sudah pernah di-submit');
  const supabase = mockSupabase({
    periods: { single: { id: 'p1', year: 2026, month: 1, is_open: true } },
    branch_submissions: { single: { id: 'existing-submission' } }, // SUDAH pernah submit
  });

  const result = await submitWeek({
    supabase: supabase as any,
    actor: null,
    periodId: 'p1',
    branchId: 'b1',
    week: 3,
    allowAlreadySubmitted: true,
  });

  assert(result.ok === true, 'harus tetap ok (bukan error 409) karena allowAlreadySubmitted=true');
  assert(result.alreadySubmitted === true, 'flag alreadySubmitted harus true');
}

async function testAlreadySubmittedStillBlocksInteractive() {
  console.log('\nTest: allowAlreadySubmitted=false (default, jalur interaktif) TETAP tolak duplikat seperti semula');
  const supabase = mockSupabase({
    periods: { single: { id: 'p1', year: 2026, month: 1, is_open: true } },
    branch_submissions: { single: { id: 'existing-submission' } },
  });

  const result = await submitWeek({
    supabase: supabase as any,
    actor: { id: 'user-1', role: 'cabang', branch_id: 'b1' },
    periodId: 'p1',
    branchId: 'b1',
    week: 3,
    allowAlreadySubmitted: false,
  });

  assert(result.ok === false, 'harus ditolak (perilaku asli tidak berubah untuk jalur interaktif)');
  assert(result.status === 409, `status harus 409 (dapat: ${result.status})`);
}

async function testHoPicCannotSubmit() {
  console.log('\nTest: role ho_pic tetap tidak boleh submit (perilaku asli tidak berubah)');
  const supabase = mockSupabase({});
  const result = await submitWeek({
    supabase: supabase as any,
    actor: { id: 'user-1', role: 'ho_pic' },
    periodId: 'p1',
    branchId: 'b1',
    week: 1,
  });
  assert(result.ok === false && result.status === 403, 'ho_pic harus ditolak 403');
}

async function main() {
  await testSystemActorBypassesRoleCheck();
  await testAlreadySubmittedToleratedForSystemActor();
  await testAlreadySubmittedStillBlocksInteractive();
  await testHoPicCannotSubmit();

  console.log(`\n${passed} lolos, ${failed} gagal.`);
  if (failed > 0) process.exit(1);
}

main();
