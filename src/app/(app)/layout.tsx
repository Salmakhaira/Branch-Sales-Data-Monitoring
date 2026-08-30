import { redirect } from 'next/navigation';
import { getProfile } from '@/lib/supabase/server';
import { listBranches } from '@/lib/report';
import AppSidebar from '@/components/AppSidebar';

/* Shell untuk seluruh halaman aplikasi (semua kecuali /login).
 * Route group "(app)" tidak muncul di URL — jadi halaman di dalamnya
 * beralamat /, /input, /national, dan /admin. */

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();
  if (!profile) redirect('/login');

  // Nama cabang ditampilkan di header supaya user cabang selalu tahu
  // sedang melihat data cabang mana.
  let branchName: string | null = null;
  if (profile.role === 'cabang' && profile.branch_id) {
    const branches = await listBranches();
    branchName = branches.find((b) => b.id === profile.branch_id)?.name ?? null;
  }

  // Sidebar mengambang di atas isi halaman (posisi fixed), jadi lebar
  // konten tidak berubah saat menu dibuka-tutup.
  return (
    <div className="min-h-screen">
      <AppSidebar profile={profile} branchName={branchName} />
      <main className="mx-auto max-w-[1600px] px-6 py-6">{children}</main>
    </div>
  );
}
