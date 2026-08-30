import { NextResponse } from 'next/server';
import { createClient, getProfile } from '@/lib/supabase/server';

/* POST /api/admin/period
 *  action: 'toggle_open'   -> buka / tutup periode
 *          'set_week'      -> override manual minggu berjalan
 *          'set_auto_week' -> kembalikan ke mode ikut kalender
 *
 * Tidak ada action 'create': periode bulan berjalan dibuat otomatis oleh
 * fungsi database ensure_current_period() saat halaman dimuat.
 */
export async function POST(request: Request) {
  const profile = await getProfile();
  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Hanya administrator.' }, { status: 403 });
  }

  const body = (await request.json()) as {
    action: 'set_week' | 'set_auto_week' | 'toggle_open';
    periodId?: string;
    week?: number;
    autoWeek?: boolean;
    isOpen?: boolean;
  };

  const supabase = createClient();

  if (!body.periodId) {
    return NextResponse.json({ error: 'periodId wajib diisi.' }, { status: 400 });
  }

  if (body.action === 'set_week') {
    const week = Number(body.week);
    if (!(week >= 1 && week <= 5)) {
      return NextResponse.json({ error: 'Minggu harus 1-5.' }, { status: 400 });
    }
    // Menyetel minggu secara manual otomatis mematikan mode kalender,
    // supaya pilihan admin tidak langsung tertimpa perhitungan tanggal.
    const { error } = await supabase
      .from('periods')
      .update({ current_week: week, auto_week: false })
      .eq('id', body.periodId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'set_auto_week') {
    const { error } = await supabase
      .from('periods')
      .update({ auto_week: !!body.autoWeek })
      .eq('id', body.periodId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'toggle_open') {
    const { error } = await supabase
      .from('periods')
      .update({ is_open: !!body.isOpen })
      .eq('id', body.periodId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Aksi tidak dikenal.' }, { status: 400 });
}
