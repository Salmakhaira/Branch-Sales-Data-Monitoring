import { createClient } from '@/lib/supabase/server';

/* =====================================================================
 *  STATUS SINKRONISASI ONEDRIVE (POWER AUTOMATE)
 *
 *  Server Component murni (tidak ada tombol aksi) — cukup menampilkan
 *  riwayat panggilan webhook per cabang, dan menandai cabang yang belum
 *  ada sinkronisasi SUKSES dalam 26 jam terakhir sebagai "Basi". Inilah
 *  yang membuat flow Power Automate yang diam-diam berhenti (kredensial
 *  kedaluwarsa, folder dipindah, dst.) terlihat dari sini, bukan baru
 *  ketahuan saat ada yang komplain data cabang telat masuk.
 * =================================================================== */

const STALE_AFTER_HOURS = 26;

interface SyncRunRow {
  id: string;
  branch_code: string;
  file_name: string | null;
  status: 'ok' | 'partial' | 'failed';
  rows_saved: number;
  rows_skipped: number;
  error_message: string | null;
  created_at: string;
}

function formatWaktu(iso: string) {
  return new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

export default async function OneDriveSyncStatus() {
  const supabase = createClient();

  const { data: runs } = await supabase
    .from('onedrive_sync_runs')
    .select('id, branch_code, file_name, status, rows_saved, rows_skipped, error_message, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  const rows = (runs ?? []) as SyncRunRow[];

  // Ringkasan: sync SUKSES/partial terakhir per cabang.
  const lastByBranch = new Map<string, SyncRunRow>();
  for (const r of rows) {
    if (r.status === 'failed') continue;
    if (!lastByBranch.has(r.branch_code)) lastByBranch.set(r.branch_code, r);
  }

  const staleBranches = [...lastByBranch.values()].filter(
    (r) => (Date.now() - new Date(r.created_at).getTime()) / 36e5 > STALE_AFTER_HOURS,
  );

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-5 py-3">
        <h3 className="text-sm font-semibold text-slate-900">Status Sinkronisasi OneDrive (Power Automate)</h3>
        <p className="text-xs text-slate-500">
          Riwayat pengiriman data otomatis dari folder OneDrive cabang. Perubahan pada minggu yang
          sudah terkunci otomatis dilewati (bukan disimpan diam-diam) — lihat kolom &quot;Dilewati&quot;.
        </p>
      </div>

      <div className="p-5">
        {rows.length === 0 ? (
          <p className="text-xs text-slate-400">
            Belum ada riwayat sinkronisasi sama sekali. Pastikan flow Power Automate sudah dibuat dan
            diaktifkan — lihat README bagian &quot;Integrasi OneDrive (Power Automate)&quot;.
          </p>
        ) : (
          <>
            {staleBranches.length > 0 && (
              <div className="mb-4 rounded-lg bg-rose-50 px-4 py-2.5 text-xs text-rose-800">
                <strong>{staleBranches.length} cabang</strong> belum ada sinkronisasi sukses lebih dari{' '}
                {STALE_AFTER_HOURS} jam:{' '}
                {staleBranches.map((r) => r.branch_code).join(', ')}. Kemungkinan flow Power Automate
                berhenti — cek riwayat run flow tersebut di Power Automate.
              </div>
            )}

            <table className="w-full text-xs">
              <thead>
                <tr className="border-b-2 border-slate-300 text-left text-slate-500">
                  <th className="py-1.5 pr-3 font-medium">Waktu</th>
                  <th className="py-1.5 pr-3 font-medium">Cabang</th>
                  <th className="py-1.5 pr-3 font-medium">File</th>
                  <th className="py-1.5 pr-3 font-medium">Status</th>
                  <th className="py-1.5 pr-3 font-medium">Tersimpan</th>
                  <th className="py-1.5 pr-3 font-medium">Dilewati</th>
                  <th className="py-1.5 font-medium">Catatan</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100">
                    <td className="py-1.5 pr-3 text-slate-600">{formatWaktu(r.created_at)}</td>
                    <td className="py-1.5 pr-3 font-medium text-slate-800">{r.branch_code}</td>
                    <td className="py-1.5 pr-3 text-slate-500">{r.file_name ?? '-'}</td>
                    <td className="py-1.5 pr-3">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          r.status === 'ok'
                            ? 'bg-emerald-50 text-emerald-700'
                            : r.status === 'partial'
                              ? 'bg-amber-50 text-amber-700'
                              : 'bg-rose-50 text-rose-700'
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 text-slate-600">{r.rows_saved}</td>
                    <td className="py-1.5 pr-3 text-slate-600">
                      {r.rows_skipped > 0 ? (
                        <span className="font-medium text-amber-700">{r.rows_skipped}</span>
                      ) : (
                        0
                      )}
                    </td>
                    <td className="py-1.5 text-slate-500">{r.error_message ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </section>
  );
}
