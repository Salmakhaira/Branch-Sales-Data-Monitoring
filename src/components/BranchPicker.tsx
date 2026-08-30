'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import type { Branch } from '@/lib/types';

export default function BranchPicker({
  branches,
  current,
  paramName = 'branch',
  allowAll = false,
}: {
  branches: Branch[];
  current?: string;
  paramName?: string;
  allowAll?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function onChange(value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(paramName, value);
    else next.delete(paramName);
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <select
      value={current ?? ''}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs outline-none focus:border-brand-500"
    >
      {allowAll && <option value="">Semua Cabang</option>}
      {branches.map((b) => (
        <option key={b.id} value={b.id}>
          {b.code} — {b.name}
        </option>
      ))}
    </select>
  );
}
