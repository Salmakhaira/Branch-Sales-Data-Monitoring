'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Branch, Profile, UserRole } from '@/lib/types';

const ROLES: { value: UserRole; label: string }[] = [
  { value: 'cabang', label: 'Cabang' },
  { value: 'ho_pic', label: 'PIC Head Office' },
  { value: 'admin', label: 'Administrator' },
];

export default function UserManager({
  profiles,
  branches,
  meId,
}: {
  profiles: Profile[];
  branches: Branch[];
  meId: string;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, { role: UserRole; branchId: string | null }>>(
    Object.fromEntries(profiles.map((p) => [p.id, { role: p.role, branchId: p.branch_id }])),
  );

  async function save(userId: string) {
    setBusyId(userId);
    setError(null);
    const d = draft[userId];
    const res = await fetch('/api/admin/user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, role: d.role, branchId: d.branchId }),
    });
    const data = await res.json();
    setBusyId(null);
    if (!res.ok) setError(data.error);
    else router.refresh();
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-5 py-3">
        <h3 className="text-sm font-semibold text-slate-900">User & Hak Akses</h3>
        <p className="text-xs text-slate-500">
          Buat akun baru lewat Supabase Dashboard → Authentication → Users. Setelah user pertama
          kali login, akunnya muncul di sini dan tinggal diatur role serta cabangnya.
        </p>
      </div>

      {error && <p className="mx-5 mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-5 py-2 font-medium">Nama / Email</th>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 font-medium">Cabang</th>
              <th className="px-5 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => {
              const d = draft[p.id];
              const changed = d.role !== p.role || d.branchId !== p.branch_id;
              return (
                <tr key={p.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-5 py-2.5">
                    <div className="font-medium text-slate-800">{p.full_name || '—'}</div>
                    <div className="text-[11px] text-slate-400">
                      {p.email}
                      {p.id === meId && (
                        <span className="ml-1.5 rounded bg-brand-100 px-1 text-[10px] text-brand-700">
                          Anda
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <select
                      value={d.role}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          [p.id]: { ...prev[p.id], role: e.target.value as UserRole },
                        }))
                      }
                      className="rounded border border-slate-300 px-2 py-1 text-xs"
                    >
                      {ROLES.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2.5">
                    <select
                      value={d.branchId ?? ''}
                      disabled={d.role !== 'cabang'}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          [p.id]: { ...prev[p.id], branchId: e.target.value || null },
                        }))
                      }
                      className="rounded border border-slate-300 px-2 py-1 text-xs disabled:bg-slate-50 disabled:text-slate-400"
                    >
                      <option value="">— pilih cabang —</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.code} — {b.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-5 py-2.5 text-right">
                    <button
                      onClick={() => save(p.id)}
                      disabled={!changed || busyId === p.id}
                      className="rounded-lg bg-brand-600 px-3 py-1 text-[11px] font-medium text-white transition hover:bg-brand-700 disabled:opacity-40"
                    >
                      {busyId === p.id ? '…' : 'Simpan'}
                    </button>
                  </td>
                </tr>
              );
            })}
            {profiles.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-slate-500">
                  Belum ada user terdaftar.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
