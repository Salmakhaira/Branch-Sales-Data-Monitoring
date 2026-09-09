import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getProfile } from '@/lib/supabase/server';
import { listBranches } from '@/lib/report';
import BulkImportForm from './BulkImportForm';

export const dynamic = 'force-dynamic';

export default async function BulkImportPage() {
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

  const branches = await listBranches();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin" className="text-xs text-brand-600 hover:underline">
          ← Kembali ke Administrasi Sistem
        </Link>
        <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">
          Impor Massal — Backfill Banyak Bulan Sekaligus
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Upload satu file workbook cabang (berisi banyak sheet bulan) — sistem otomatis mendeteksi dan
          mengimpor semua bulan yang ada di dalamnya, tanpa perlu upload manual satu per satu.
        </p>
      </div>

      <BulkImportForm branches={branches} />
    </div>
  );
}
