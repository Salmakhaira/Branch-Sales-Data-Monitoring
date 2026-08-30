'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { monthName, periodLabel } from '@/lib/format';
import { describeWeek, nextWeekChange } from '@/lib/period';
import type { Period } from '@/lib/types';

/* =====================================================================
 *  STATUS PERIODE
 *
 *  Bukan panel pengaturan — periode bulan baru dibuat otomatis dan
 *  minggu berjalan mengikuti tanggal. Yang tersisa di sini hanya
 *  informasi, plus satu tindakan yang memang butuh keputusan manusia:
 *  menutup periode.
 *
 *  Tombol pemilih minggu hanya muncul bila override manual diaktifkan
 *  lewat SQL (auto_week = false) — lihat README bagian "Minggu
 *  pelaporan berganti otomatis".
 * =================================================================== */

export default function PeriodStatus({ period }: { period: Period | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!period) {
    return (
      <section className="rounded-xl border border-amber-300 bg-amber-50 px-5 py-4">
        <p className="text-xs text-amber-900">
          Periode belum terbentuk. Muat ulang halaman ini — periode bulan berjalan dibuat
          otomatis. Bila tetap kosong, jalankan{' '}
          <code className="rounded bg-white px-1">supabase/migrations/003_periode_otomatis.sql</code>{' '}
          di SQL Editor.
        </p>
      </section>
    );
  }

  async function call(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/admin/period', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) setError(data.error);
    else router.refresh();
  }

  const upcoming = nextWeekChange(period);

  return (
    <section className="rounded-xl border border-slate-200 bg-white px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="text-sm font-semibold text-slate-900">
            {periodLabel(period.year, period.month)}
          </h3>
          <span className="text-xs text-slate-600">
            Minggu {period.current_week} ·{' '}
            {describeWeek(period.year, period.month, period.current_week, monthName(period.month))}
          </span>
          {period.is_open ? (
            upcoming ? (
              <span className="text-[11px] text-slate-400">
                Minggu {upcoming.week} mulai {upcoming.day} {monthName(period.month)}
              </span>
            ) : (
              <span className="text-[11px] text-slate-400">Minggu terakhir bulan ini</span>
            )
          ) : (
            <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
              Ditutup
            </span>
          )}
        </div>

        <button
          disabled={busy}
          onClick={() => {
            if (
              period.is_open &&
              !confirm(
                `Tutup periode ${periodLabel(period.year, period.month)}?\n\n` +
                  'Cabang tidak akan bisa lagi mengisi atau mengubah data bulan ini. ' +
                  'Bisa dibuka kembali kapan saja.',
              )
            )
              return;
            call({ action: 'toggle_open', periodId: period.id, isOpen: !period.is_open });
          }}
          className={`shrink-0 rounded-lg px-3.5 py-1.5 text-[11px] font-semibold text-white shadow-sm transition disabled:opacity-50 ${
            period.is_open
              ? 'bg-amber-600 hover:bg-amber-700' // aksi mengunci — sengaja mencolok
              : 'bg-emerald-600 hover:bg-emerald-700' // aksi membuka kembali
          }`}
        >
          {period.is_open ? '🔒 Tutup periode' : '🔓 Buka kembali'}
        </button>
      </div>

      {/* Keterangan tombol Tutup/Buka periode — pertanyaan yang paling
       * sering muncul, jadi dijawab langsung di layar, bukan di manual. */}
      <div className="mt-3 rounded-lg bg-slate-50 px-3.5 py-2.5">
        {period.is_open ? (
          <p className="text-[11px] leading-relaxed text-slate-600">
            <strong className="font-semibold text-slate-800">Tutup periode</strong> mengunci bulan{' '}
            {periodLabel(period.year, period.month)}: cabang tidak bisa lagi menyimpan atau mengubah
            angkanya — halaman Input Report jadi baca-saja bagi mereka. Rekap nasional, export
            Excel, dan riwayat perubahan tetap terbuka, dan Administrator tetap bisa mengubah data.
            <br />
            Biasanya ditekan <strong className="font-semibold text-slate-800">setelah semua cabang
            submit dan angka bulan itu final</strong>. Tidak wajib — bulan yang dibiarkan terbuka
            pun tetap aman, karena setiap perubahan atas minggu yang sudah di-submit selalu diminta
            alasannya. Bisa dibuka kembali kapan saja lewat tombol yang sama.
          </p>
        ) : (
          <p className="text-[11px] leading-relaxed text-slate-600">
            Periode ini <strong className="font-semibold text-slate-800">sedang ditutup</strong> —
            cabang hanya bisa melihat, tidak bisa mengubah angka bulan{' '}
            {periodLabel(period.year, period.month)}. Tekan{' '}
            <strong className="font-semibold text-slate-800">Buka kembali</strong> bila masih ada
            koreksi yang perlu dimasukkan cabang.
          </p>
        )}
      </div>

      {/* Hanya tampil bila seseorang menyetel auto_week = false lewat SQL */}
      {!period.auto_week && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-[11px] leading-relaxed text-amber-900">
            Periode ini memakai <strong>minggu manual</strong>, sehingga tidak ikut berganti
            mengikuti tanggal.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {[1, 2, 3, 4, 5].map((w) => (
              <button
                key={w}
                disabled={busy}
                onClick={() => call({ action: 'set_week', periodId: period.id, week: w })}
                className={`h-7 w-9 rounded text-[11px] font-medium transition ${
                  period.current_week === w
                    ? 'bg-brand-600 text-white'
                    : 'bg-white text-slate-600 ring-1 ring-slate-300 hover:bg-slate-100'
                }`}
              >
                W{w}
              </button>
            ))}
            <button
              disabled={busy}
              onClick={() => call({ action: 'set_auto_week', periodId: period.id, autoWeek: true })}
              className="rounded-lg border border-emerald-600 bg-white px-3 py-1 text-[11px] font-medium text-emerald-700 transition hover:bg-emerald-50"
            >
              Kembalikan ke otomatis
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-2 rounded-lg bg-rose-50 px-3 py-1.5 text-xs text-rose-800">{error}</p>
      )}
    </section>
  );
}
