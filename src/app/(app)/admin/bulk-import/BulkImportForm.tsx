'use client';

import { useState } from 'react';
import type { Branch } from '@/lib/types';

const MONTH_NAMES = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

type Result = {
  year: number;
  month: number;
  sheetName: string;
  status: 'ok' | 'partial' | 'failed';
  changed?: number;
  skipped?: number;
  error?: string;
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Buang prefix "data:...;base64," — hanya bagian base64 murni yang dikirim.
      resolve(result.split(',')[1] ?? '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function BulkImportForm({ branches }: { branches: Branch[] }) {
  const [branchCode, setBranchCode] = useState(branches[0]?.code ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [branchName, setBranchName] = useState<string | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError('Pilih file terlebih dahulu.');
      return;
    }
    setBusy(true);
    setError(null);
    setResults(null);

    try {
      const fileContentBase64 = await fileToBase64(file);
      const res = await fetch('/api/admin/bulk-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchCode, fileContentBase64 }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Gagal memproses file.');
        return;
      }
      setBranchName(data.branch);
      setResults(data.results);
    } catch (err: any) {
      setError(err?.message ?? 'Terjadi kesalahan tak terduga.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Cabang</label>
          <select
            value={branchCode}
            onChange={(e) => setBranchCode(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            {branches.map((b) => (
              <option key={b.code} value={b.code}>
                {b.name} ({b.code})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">File workbook MOS cabang</label>
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100"
          />
          <p className="mt-1 text-xs text-slate-500">
            Satu file berisi banyak sheet bulan (mis. &quot;JANUARI 2026&quot;, &quot;AGUSTUS 2026&quot;) — semua sheet yang
            terdeteksi akan diimpor sekaligus.
          </p>
        </div>

        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

        <button
          type="submit"
          disabled={busy || !branches.length}
          className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? 'Memproses semua bulan…' : 'Impor Semua Bulan'}
        </button>
      </form>

      {results && (
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-3">
            <h3 className="text-sm font-semibold text-slate-900">
              Hasil impor — {branchName} ({results.length} bulan terdeteksi)
            </h3>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="px-5 py-2 font-medium">Bulan</th>
                <th className="px-3 py-2 font-medium">Sheet</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Tersimpan</th>
                <th className="px-3 py-2 font-medium">Dilewati</th>
                <th className="px-5 py-2 font-medium">Catatan</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i} className="border-b border-slate-100 last:border-0">
                  <td className="px-5 py-2.5 font-medium text-slate-800">
                    {MONTH_NAMES[r.month - 1]} {r.year}
                  </td>
                  <td className="px-3 py-2.5 text-slate-500">{r.sheetName}</td>
                  <td className="px-3 py-2.5">
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
                  <td className="px-3 py-2.5 text-slate-600">{r.changed ?? '-'}</td>
                  <td className="px-3 py-2.5 text-slate-600">{r.skipped ?? '-'}</td>
                  <td className="px-5 py-2.5 text-slate-500">{r.error ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
