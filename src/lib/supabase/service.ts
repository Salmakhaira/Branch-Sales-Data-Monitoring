import { createClient as createSupabaseClient } from '@supabase/supabase-js';

/**
 * Client Supabase pakai SERVICE ROLE KEY — melewati RLS sepenuhnya.
 *
 * HANYA dipakai di satu tempat: /api/webhook/onedrive-sync, yang dipanggil
 * Power Automate (tidak ada sesi login/cookie sama sekali di konteks itu).
 * JANGAN PERNAH dipakai di Server Component atau route yang diakses
 * langsung oleh browser — otorisasi di jalur itu harus tetap lewat
 * getProfile() + RLS seperti biasa (lihat lib/supabase/server.ts).
 *
 * SUPABASE_SERVICE_ROLE_KEY TIDAK memakai prefix NEXT_PUBLIC_ — sengaja,
 * supaya tidak mungkin ter-bundle ke kode sisi browser.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY (atau NEXT_PUBLIC_SUPABASE_URL) belum diisi di environment variables.',
    );
  }

  return createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
