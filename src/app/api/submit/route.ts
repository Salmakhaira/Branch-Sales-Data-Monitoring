import { NextResponse } from 'next/server';
import { createClient, getProfile } from '@/lib/supabase/server';
import { jakartaToday, weekOfMonth } from '@/lib/period';

/* =====================================================================
 *  POST /api/submit
 *  Cabang mengunci report untuk satu minggu.
 *
 *  Yang terjadi:
 *   1. Seluruh baris cabang di-copy ke report_snapshots (immutable).
 *   2. Ditandai di branch_submissions.
 *
 *  Minggu boleh dipilih cabang — misalnya menyusul laporan Minggu 2
 *  padahal hari ini sudah Minggu 4. Yang TIDAK boleh: melapor untuk
 *  minggu yang belum tiba pada bulan berjalan.
 *
 *  Setelah submit Minggu N, semua kolom bulanan + kolom mingguan
 *  W1..W(minggu tertinggi yang pernah di-submit) menjadi terkunci:
 *  perubahan berikutnya wajib disertai alasan.
 * =================================================================== */

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: 'Belum login.' }, { status: 401 });
  if (profile.role === 'ho_pic') {
    return NextResponse.json({ error: 'PIC Head Office tidak melakukan submit.' }, { status: 403 });
  }

  const { periodId, branchId, week, note } = (await request.json()) as {
    periodId: string;
    branchId: string;
    week?: number;
    note?: string;
  };

  if (profile.role === 'cabang' && profile.branch_id !== branchId) {
    return NextResponse.json({ error: 'Bukan cabang Anda.' }, { status: 403 });
  }

  const supabase = createClient();

  const { data: period } = await supabase
    .from('periods')
    .select('id, year, month, is_open')
    .eq('id', periodId)
    .single();

  if (!period) return NextResponse.json({ error: 'Periode tidak ditemukan.' }, { status: 404 });
  if (!period.is_open && profile.role !== 'admin') {
    return NextResponse.json({ error: 'Periode sudah ditutup.' }, { status: 423 });
  }

  /* --- Validasi minggu ---------------------------------------------
   * Batas atas ditentukan SERVER, bukan client: pada bulan berjalan
   * hanya sampai minggu menurut kalender; pada bulan yang sudah lewat,
   * keempat minggu terbuka. */
  const today = jakartaToday();
  const isCurrentMonth = period.year === today.year && period.month === today.month;
  const isFutureMonth =
    period.year * 100 + period.month > today.year * 100 + today.month;

  if (isFutureMonth) {
    return NextResponse.json(
      { error: 'Periode ini belum dimulai, jadi belum bisa di-submit.' },
      { status: 400 },
    );
  }

  const maxWeek = isCurrentMonth ? weekOfMonth(today.day) : 4;
  const requested = Number(week);

  if (!Number.isInteger(requested) || requested < 1 || requested > 4) {
    return NextResponse.json({ error: 'Minggu harus antara 1 dan 4.' }, { status: 400 });
  }
  if (requested > maxWeek) {
    return NextResponse.json(
      {
        error:
          `Minggu ${requested} belum tiba — hari ini masih Minggu ${maxWeek}. ` +
          'Data boleh diisi lebih dulu, tapi submit-nya menunggu minggunya berjalan.',
      },
      { status: 400 },
    );
  }

  // Sudah pernah submit minggu ini?
  const { data: dup } = await supabase
    .from('branch_submissions')
    .select('id')
    .eq('period_id', periodId)
    .eq('branch_id', branchId)
    .eq('week_no', requested)
    .maybeSingle();

  if (dup) {
    return NextResponse.json(
      {
        error:
          `Cabang ini sudah submit untuk Minggu ${requested}. ` +
          'Perubahan setelah submit tetap bisa dilakukan, tapi wajib disertai alasan.',
      },
      { status: 409 },
    );
  }

  // Ambil seluruh baris cabang
  const { data: entries, error: readErr } = await supabase
    .from('report_entries')
    .select('salesman_id, values')
    .eq('period_id', periodId)
    .eq('branch_id', branchId);

  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!entries?.length) {
    return NextResponse.json(
      { error: 'Belum ada data yang bisa di-submit. Isi data terlebih dahulu.' },
      { status: 400 },
    );
  }

  const snapshotRows = entries.map((e: { salesman_id: string; values: unknown }) => ({
    period_id: periodId,
    branch_id: branchId,
    salesman_id: e.salesman_id,
    week_no: requested,
    values: e.values ?? {},
    submitted_by: profile.id,
  }));

  const { error: snapErr } = await supabase.from('report_snapshots').insert(snapshotRows);
  if (snapErr) return NextResponse.json({ error: snapErr.message }, { status: 500 });

  // Data tingkat cabang (PLAN SALES MASTER/OL MIN PRTM/ACTUAL SALES) ikut
  // dipotret bersamaan, kalau memang sudah pernah diisi.
  const { data: branchEntry } = await supabase
    .from('report_branch_entries')
    .select('values')
    .eq('period_id', periodId)
    .eq('branch_id', branchId)
    .maybeSingle();

  if (branchEntry) {
    const { error: branchSnapErr } = await supabase.from('report_branch_snapshots').insert({
      period_id: periodId,
      branch_id: branchId,
      week_no: requested,
      values: branchEntry.values ?? {},
      submitted_by: profile.id,
    });
    if (branchSnapErr) return NextResponse.json({ error: branchSnapErr.message }, { status: 500 });
  }

  const { error: subErr } = await supabase.from('branch_submissions').insert({
    period_id: periodId,
    branch_id: branchId,
    week_no: requested,
    submitted_by: profile.id,
    note: note ?? null,
  });
  if (subErr) return NextResponse.json({ error: subErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, week: requested, rows: snapshotRows.length });
}
