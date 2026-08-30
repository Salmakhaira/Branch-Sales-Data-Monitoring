'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

/* PIC Head Office menandai apakah sebuah perubahan sudah ditinjau
 * atau masih perlu klarifikasi ke cabang. */
export default function ReviewControls({
  revisionId,
  status,
  note,
}: {
  revisionId: string;
  status: 'open' | 'acknowledged' | 'flagged';
  note: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftNote, setDraftNote] = useState(note ?? '');

  async function update(next: 'acknowledged' | 'flagged' | 'open', withNote?: string) {
    setBusy(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    await supabase
      .from('entry_revisions')
      .update({
        review_status: next,
        review_note: withNote ?? draftNote ?? null,
        reviewed_by: user?.id ?? null,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', revisionId);

    setBusy(false);
    setEditing(false);
    router.refresh();
  }

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1">
        <button
          onClick={() => update('acknowledged')}
          disabled={busy}
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition ${
            status === 'acknowledged'
              ? 'bg-emerald-600 text-white'
              : 'bg-slate-100 text-slate-600 hover:bg-emerald-50'
          }`}
        >
          ✓ Ditinjau
        </button>
        <button
          onClick={() => setEditing(true)}
          disabled={busy}
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition ${
            status === 'flagged'
              ? 'bg-rose-600 text-white'
              : 'bg-slate-100 text-slate-600 hover:bg-rose-50'
          }`}
        >
          ⚑ Klarifikasi
        </button>
      </div>

      {note && !editing && <p className="text-[10px] italic text-slate-500">&ldquo;{note}&rdquo;</p>}

      {editing && (
        <div className="space-y-1">
          <textarea
            rows={2}
            value={draftNote}
            onChange={(e) => setDraftNote(e.target.value)}
            placeholder="Catatan untuk cabang…"
            className="w-40 resize-none rounded border border-slate-300 px-1.5 py-1 text-[10px] outline-none focus:border-brand-500"
          />
          <div className="flex gap-1">
            <button
              onClick={() => update('flagged')}
              disabled={busy}
              className="rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-medium text-white"
            >
              Kirim
            </button>
            <button
              onClick={() => setEditing(false)}
              className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600"
            >
              Batal
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
