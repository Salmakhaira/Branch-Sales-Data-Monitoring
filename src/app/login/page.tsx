// src/app/login/page.tsx
//
// FIX (9 September 2026) — file ini sebelumnya BUKAN halaman login sama
// sekali. Isinya adalah kode Dashboard (SummaryPage) yang salah tertaruh
// di sini sejak awal project dibuat — tidak ada satu pun input password
// atau <form> di dalamnya. Bug ini tidak ketahuan lama karena middleware
// hanya mengarahkan ke sini saat sesi login TIDAK ada — dan begitu sesi
// itu benar hilang, halaman ini seharusnya jadi satu-satunya jalan masuk,
// tapi malah tidak ada form untuk login sama sekali. Diperbaiki dengan
// membuat form login yang sebenarnya (lihat components/LoginForm.tsx).

import Image from 'next/image';
import LoginForm from '@/components/LoginForm';

export default function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string };
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <Image
            src="/logo-traktor-nusantara.png"
            alt="Traktor Nusantara"
            width={160}
            height={48}
            className="mb-4 h-12 w-auto"
            priority
          />
          <h1 className="text-lg font-semibold text-slate-900">Sales Branch Report Data Monitoring</h1>
          <p className="mt-1 text-sm text-slate-500">Masuk untuk melanjutkan</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <LoginForm next={searchParams.next ?? '/'} />
        </div>
      </div>
    </div>
  );
}
