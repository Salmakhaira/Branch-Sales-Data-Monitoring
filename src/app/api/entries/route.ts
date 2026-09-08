import { NextResponse } from 'next/server';
import { createClient, getProfile } from '@/lib/supabase/server';
import { saveEntries } from '@/lib/saveEntries';
import type { SaveRequest } from '@/lib/types';

/* =====================================================================
 *  POST /api/entries
 *  Jalur INTERAKTIF (grid manual & upload Excel manual) — dipanggil user
 *  yang login lewat browser. Aturan bisnisnya sendiri sudah dipindah ke
 *  src/lib/saveEntries.ts, dipakai bersama dengan jalur otomatis Power
 *  Automate (lihat /api/webhook/onedrive-sync) supaya keduanya benar-benar
 *  menjalankan validasi yang sama persis, bukan cuma mirip.
 * =================================================================== */

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) {
    return NextResponse.json({ error: 'Belum login.' }, { status: 401 });
  }

  let body: SaveRequest;
  try {
    body = (await request.json()) as SaveRequest;
  } catch {
    return NextResponse.json({ error: 'Payload tidak valid.' }, { status: 400 });
  }

  const result = await saveEntries({
    supabase: createClient(),
    actor: { id: profile.id, role: profile.role, branch_id: profile.branch_id },
    periodId: body.periodId,
    branchId: body.branchId,
    rows: body.rows,
    branchValues: body.branchValues,
    reasons: body.reasons,
    source: body.source ?? 'grid',
    allowPartialOnConflict: false,
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        message: result.message,
        conflicts: result.conflicts,
        lastSubmittedWeek: result.lastSubmittedWeek,
      },
      { status: result.status },
    );
  }

  return NextResponse.json({
    ok: true,
    changed: result.changed,
    revisions: result.revisions,
    withReason: result.withReason,
    message: result.message,
  });
}
