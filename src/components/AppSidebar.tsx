'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import SignOutButton from '@/components/SignOutButton';
import type { Profile } from '@/lib/types';

/* =====================================================================
 *  NAVIGASI SAMPING
 *
 *  Menu disembunyikan secara default di SEMUA ukuran layar. Tombol garis
 *  tiga (hamburger) di bilah atas membukanya, dan menekan tombol yang
 *  sama menutupnya lagi.
 *
 *  Bilah atas SELALU berada di lapisan teratas (z-50) dan panel geser
 *  mulai tepat di bawahnya, supaya tombol garis tiga tidak pernah
 *  tertutup latar gelap — kalau tertutup, menu tidak bisa ditutup lewat
 *  tombol yang sama.
 *
 *  Panel mengambang di atas isi halaman (bukan mendorongnya), sehingga
 *  lebar tabel tidak berubah saat menu dibuka-tutup — penting karena
 *  rekap nasional sangat lebar.
 * =================================================================== */

const ROLE_LABEL: Record<string, string> = {
  cabang: 'User Cabang',
  ho_pic: 'PIC Head Office',
  admin: 'Administrator',
};

type NavItem = { href: string; label: string; icon: 'ringkasan' | 'input' | 'nasional' | 'admin' };

function NavIcon({ name }: { name: NavItem['icon'] }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    className: 'shrink-0',
  };
  if (name === 'ringkasan')
    return (
      <svg {...common}>
        <path d="M3 13h4v8H3zM10 3h4v18h-4zM17 9h4v12h-4z" />
      </svg>
    );
  if (name === 'input')
    return (
      <svg {...common}>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    );
  if (name === 'nasional')
    return (
      <svg {...common}>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 10h18M9 10v10M15 10v10" />
      </svg>
    );
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
    </svg>
  );
}

export default function AppSidebar({
  profile,
  branchName,
}: {
  profile: Profile;
  branchName: string | null;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const nav: NavItem[] = [
    { href: '/', label: 'Ringkasan & Monitoring', icon: 'ringkasan' },
    ...(profile.role !== 'ho_pic'
      ? [{ href: '/input', label: 'Input Report', icon: 'input' as const }]
      : []),
    { href: '/national', label: 'Rekap Nasional', icon: 'nasional' },
    ...(profile.role === 'admin'
      ? [{ href: '/admin', label: 'Administrasi', icon: 'admin' as const }]
      : []),
  ];

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <>
      {/* Bilah atas — di semua ukuran layar */}
      <div className="sticky top-0 z-50 flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Tutup menu' : 'Buka menu'}
          aria-expanded={open}
          aria-controls="menu-utama"
          className={`rounded-lg p-1.5 transition ${
            open ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <Image
          src="/logo-traktor-nusantara.png"
          alt="Traktor Nusantara"
          width={471}
          height={221}
          priority
          className="h-7 w-auto object-contain"
        />
        <span className="text-sm font-semibold text-slate-900">
          Sales Branch Report Data Monitoring
        </span>
        <span className="ml-auto hidden truncate text-[11px] text-slate-500 sm:block">
          {profile.full_name || profile.email}
        </span>
      </div>

      {/* Latar gelap saat panel geser terbuka */}
      {open && (
        <div
          className="fixed inset-x-0 bottom-0 top-14 z-30 bg-slate-900/40"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      <aside
        id="menu-utama"
        aria-hidden={!open}
        className={`fixed bottom-0 left-0 top-14 z-40 flex w-64 flex-col border-r border-slate-200 bg-white shadow-xl transition-transform duration-200 ${
          open ? 'translate-x-0' : 'pointer-events-none -translate-x-full'
        }`}
      >
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pt-4">
          {nav.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition ${
                  active
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <NavIcon name={item.icon} />
                <span className="leading-tight">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-slate-200 px-5 py-4">
          <p className="truncate text-xs font-medium text-slate-800">
            {profile.full_name || profile.email}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {ROLE_LABEL[profile.role]}
            {branchName ? ` · ${branchName}` : ''}
          </p>
          <div className="mt-3">
            <SignOutButton />
          </div>
        </div>
      </aside>
    </>
  );
}
