'use client';

import { Suspense, useState } from 'react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(
        error.message === 'Invalid login credentials'
          ? 'Email atau password salah.'
          : error.message,
      );
      setBusy(false);
      return;
    }

    router.replace(next);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">Email</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          placeholder="nama@perusahaan.co.id"
          autoComplete="username"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">Password</label>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          placeholder="••••••••"
          autoComplete="current-password"
        />
      </div>

      {error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-60"
      >
        {busy ? 'Memproses…' : 'Masuk'}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <Image
            src="/logo-traktor-nusantara.png"
            alt="Traktor Nusantara"
            width={471}
            height={221}
            priority
            className="mx-auto mb-4 h-16 w-auto object-contain"
          />
          <h1 className="text-lg font-semibold leading-snug text-slate-900">
            Sales Branch Report
            <br />
            Data Monitoring
          </h1>
          <p className="mt-1.5 text-xs text-slate-500">
            Masuk menggunakan akun yang diberikan Administrator
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <Suspense fallback={<p className="text-sm text-slate-500">Memuat…</p>}>
            <LoginForm />
          </Suspense>
        </div>

        <p className="mt-4 text-center text-[11px] text-slate-400">
          Lupa password? Hubungi Administrator sistem.
        </p>
      </div>
    </div>
  );
}
