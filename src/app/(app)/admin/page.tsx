import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient, getProfile } from '@/lib/supabase/server';
import { getActivePeriod, listBranches, listSalesmen } from '@/lib/report';
import PeriodStatus from '@/components/admin/PeriodStatus';
import UserManager from '@/components/admin/UserManager';
import type { Profile } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const profile = await getProfile();
  if (!profile) redirect('/login');
  if (profile.role !== 'admin') {
    return (
      <div className="mx-auto max-w-2xl py-20 text-center">
        <h2 className="text-sm font-semibold text-slate-800">Akses ditolak</h2>
        <p className="mt-1 text-xs text-slate-500">Halaman ini hanya untuk Administrator.</p>
        <Link href="/" className="mt-4 inline-block text-xs text-brand-600 underline">
          Kembali ke Ringkasan
        </Link>
      </div>
    );
  }

  const supabase = createClient();
  const [period, branches, salesmen, { data: profiles }] = await Promise.all([
    getActivePeriod(),
    listBranches(),
    listSalesmen(),
    supabase.from('profiles').select('*').order('email'),
  ]);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900">Administrasi Sistem</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Kelola hak akses user. Periode dan minggu pelaporan berjalan sendiri.
        </p>
      </div>

      <div className="space-y-6">
        <PeriodStatus period={period} />

        <UserManager profiles={(profiles as Profile[]) ?? []} branches={branches} meId={profile.id} />

        <section className="rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-3">
            <h3 className="text-sm font-semibold text-slate-900">Master Cabang & Salesman</h3>
            <p className="text-xs text-slate-500">
              {branches.length} cabang aktif, {salesmen.length} salesman. Penambahan/perubahan
              dilakukan lewat Supabase Table Editor atau SQL, lalu tampil otomatis di sini.
            </p>
          </div>
          <div className="grid gap-px bg-slate-100 sm:grid-cols-2 lg:grid-cols-3">
            {branches.map((b) => {
              const list = salesmen.filter((s) => s.branch_id === b.id);
              return (
                <div key={b.id} className="bg-white p-4">
                  <p className="text-xs font-semibold text-slate-800">
                    {b.name} <span className="font-normal text-slate-400">({b.code})</span>
                  </p>
                  <ul className="mt-1.5 space-y-0.5">
                    {list.map((s) => (
                      <li key={s.id} className="text-[11px] text-slate-500">
                        • {s.name}
                      </li>
                    ))}
                    {list.length === 0 && (
                      <li className="text-[11px] italic text-amber-600">Belum ada salesman</li>
                    )}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
