import { NextResponse } from 'next/server';
import { createClient, getProfile } from '@/lib/supabase/server';

/* POST /api/admin/user — set role & cabang seorang user. */
export async function POST(request: Request) {
  const profile = await getProfile();
  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Hanya administrator.' }, { status: 403 });
  }

  const { userId, role, branchId, isActive } = (await request.json()) as {
    userId: string;
    role: 'cabang' | 'ho_pic' | 'admin';
    branchId: string | null;
    isActive?: boolean;
  };

  if (role === 'cabang' && !branchId) {
    return NextResponse.json(
      { error: 'User dengan role Cabang wajib ditautkan ke sebuah cabang.' },
      { status: 400 },
    );
  }

  if (userId === profile.id && role !== 'admin') {
    return NextResponse.json(
      { error: 'Anda tidak dapat menurunkan role akun Anda sendiri.' },
      { status: 400 },
    );
  }

  const supabase = createClient();
  const { error } = await supabase
    .from('profiles')
    .update({
      role,
      branch_id: role === 'cabang' ? branchId : null,
      ...(isActive === undefined ? {} : { is_active: isActive }),
    })
    .eq('id', userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
