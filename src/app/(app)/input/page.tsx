import { getProfile, createClient } from '@/lib/supabase/server';
import {
  getActivePeriod,
  getBranchEntry,
  getLastSubmittedWeek,
  getLatestBranchSnapshot,
  getSnapshotsBeforeWeek,
  listBranches,
  listEntries,
  listPeriods,
  listSalesmen,
} from '@/lib/report';
import { monthName, periodLabel } from '@/lib/format';
import { describeWeek, jakartaToday, weekOfMonth } from '@/lib/period';
import ReportWorkspace from './ReportWorkspace';
import BranchPicker from '@/components/BranchPicker';
import MonthYearPicker from '@/components/MonthYearPicker';
import WeekPicker from '@/components/WeekPicker';

export const dynamic = 'force-dynamic';

export default async function InputPage({
  searchParams,
}: {
  searchParams: { branch?: string; period?: string; week?: string };
}) {
  const profile = await getProfile();
  if (!profile) return null;

  if (profile.role === 'ho_pic') {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
        <h3 className="text-sm font-semibold text-slate-800">Akses baca saja</h3>
        <p className="mt-1 text-xs text-slate-500">
          PIC Head Office memantau lewat Rekap Nasional dan Monitoring Perubahan.
        </p>
      </div>
    );
  }

  const [period, periods, branches] = await Promise.all([
    getActivePeriod(searchParams.period),
    listPeriods(),
    listBranches(),
  ]);

  if (!period) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
        Belum ada periode pelaporan.
      </div>
    );
  }

  const branchId =
    profile.role === 'admin'
      ? searchParams.branch || branches[0]?.id
      : profile.branch_id ?? undefined;

  if (!branchId) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-800">
        Akun Anda belum ditautkan ke cabang mana pun. Hubungi Administrator.
      </div>
    );
  }

  const branch = branches.find((b) => b.id === branchId)!;

  /* --- Minggu pelaporan -------------------------------------------
   * Batas atas: pada bulan berjalan hanya sampai minggu menurut
   * kalender (tidak boleh melapor untuk minggu yang belum tiba);
   * pada bulan yang sudah lewat, keempat minggu terbuka. */
  const today = jakartaToday();
  const isCurrentMonth = period.year === today.year && period.month === today.month;
  const maxWeek = isCurrentMonth ? weekOfMonth(today.day) : 4;

  const requested = Number(searchParams.week);
  const reportingWeek =
    Number.isInteger(requested) && requested >= 1 && requested <= maxWeek
      ? requested
      : Math.min(period.current_week, maxWeek);

  const supabase = createClient();
  const [salesmen, entries, lastSubmittedWeek, { data: subs }, branchEntry, branchSnapshot] =
    await Promise.all([
      listSalesmen(branchId),
      listEntries(period.id, branchId),
      getLastSubmittedWeek(period.id, branchId),
      supabase
        .from('branch_submissions')
        .select('week_no')
        .eq('period_id', period.id)
        .eq('branch_id', branchId),
      getBranchEntry(period.id, branchId),
      getLatestBranchSnapshot(period.id, branchId),
    ]);

  const submittedWeeks = ((subs as { week_no: number }[]) ?? []).map((s) => s.week_no);

  /* Snapshot pembanding untuk aturan "wajib alasan" adalah snapshot
   * TERAKHIR yang pernah di-submit — bukan snapshot minggu sebelumnya.
   * Keduanya beda peran, jadi diambil terpisah. */
  const latestSnaps = await getSnapshotsBeforeWeek(period.id, branchId, 99);

  const initialValues: Record<string, Record<string, number | null>> = {};
  const snapshotValues: Record<string, Record<string, number | null>> = {};
  for (const s of salesmen) {
    initialValues[s.id] = entries.find((e) => e.salesman_id === s.id)?.values ?? {};
    snapshotValues[s.id] = latestSnaps.get(s.id)?.values ?? {};
  }

  const alreadySubmitted = submittedWeeks.includes(reportingWeek);
  const readOnly = !period.is_open && profile.role !== 'admin';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">
            Input Report — {branch.name}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Melapor untuk{' '}
            <strong>
              Minggu {reportingWeek} {periodLabel(period.year, period.month)}
            </strong>{' '}
            ({describeWeek(period.year, period.month, reportingWeek, monthName(period.month))})
            {lastSubmittedWeek
              ? ` · terakhir submit Minggu ${lastSubmittedWeek}`
              : ' · belum pernah submit bulan ini'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {profile.role === 'admin' && <BranchPicker branches={branches} current={branchId} />}
          <MonthYearPicker periods={periods} current={period} />
          <WeekPicker
            current={reportingWeek}
            maxWeek={maxWeek}
            submittedWeeks={submittedWeeks}
            monthLabel={monthName(period.month)}
          />
        </div>
      </div>

      {readOnly && (
        <p className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-2 text-xs text-slate-700">
          Periode {periodLabel(period.year, period.month)} sudah ditutup Administrator, jadi tidak
          bisa diubah lagi.
        </p>
      )}

      {alreadySubmitted && (
        <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-xs text-emerald-800">
          Minggu {reportingWeek} sudah di-submit. Data masih boleh diperbaiki, tetapi setiap
          perubahan wajib disertai alasan yang akan terlihat oleh PIC Head Office.
        </p>
      )}

      <ReportWorkspace
        periodId={period.id}
        branchId={branchId}
        branchCode={branch.code}
        branchName={branch.name}
        year={period.year}
        month={period.month}
        reportingWeek={reportingWeek}
        alreadySubmitted={alreadySubmitted}
        readOnly={readOnly}
        lastSubmittedWeek={lastSubmittedWeek}
        salesmen={salesmen.map((s) => ({ id: s.id, name: s.name }))}
        initialValues={initialValues}
        snapshotValues={snapshotValues}
        branchInitialValues={branchEntry?.values ?? {}}
        branchSnapshotValues={branchSnapshot?.values ?? {}}
      />
    </div>
  );
}
