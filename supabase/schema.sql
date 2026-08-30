-- =====================================================================
--  SALES BRANCH REPORT DATA MONITORING
--  Skema database PostgreSQL / Supabase
--
--  Jalankan file ini di Supabase SQL Editor (sekali saja, saat setup).
--  Urutan: schema.sql -> seed.sql
-- =====================================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 1. MASTER: AREA, CABANG, SALESMAN
-- ---------------------------------------------------------------------

create table if not exists public.areas (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,          -- ZDJ / BBB / STH
  name        text not null,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.branches (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,          -- SMD-1, PLB, SMP, ...
  name        text not null,                 -- SAMARINDA-1, PALEMBANG, ...
  area_id     uuid references public.areas(id) on delete set null,
  sort_order  int  not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.salesmen (
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid not null references public.branches(id) on delete cascade,
  name        text not null,
  sort_order  int  not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (branch_id, name)
);

-- ---------------------------------------------------------------------
-- 2. USER & ROLE
--    role: 'cabang' | 'ho_pic' | 'admin'
-- ---------------------------------------------------------------------

create type public.user_role as enum ('cabang', 'ho_pic', 'admin');

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  email       text,
  role        public.user_role not null default 'cabang',
  branch_id   uuid references public.branches(id) on delete set null, -- wajib untuk role 'cabang'
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Auto-create profile ketika user baru mendaftar di Supabase Auth
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    'cabang'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- 3. PERIODE PELAPORAN
--    Satu periode = satu BULAN. Di dalamnya ada 4 minggu pelaporan.
--    Ini persis meniru satu sheet bulanan di Excel (MOS AGUSTUS 2026),
--    yang tiap minggu di-update oleh cabang.
-- ---------------------------------------------------------------------

create table if not exists public.periods (
  id            uuid primary key default gen_random_uuid(),
  year          int  not null,
  month         int  not null check (month between 1 and 12),

  -- Minggu berjalan.
  --   auto_week = true  -> current_week DIABAIKAN; minggu dihitung dari
  --                        tanggal hari ini (W1 = tgl 1-7, W2 = 8-14,
  --                        W3 = 15-21, W4 = 22 s/d akhir bulan), zona
  --                        waktu Asia/Jakarta. Lihat src/lib/period.ts
  --   auto_week = false -> current_week dipakai apa adanya (override admin)
  current_week  int  not null default 1 check (current_week between 1 and 5),
  auto_week     boolean not null default true,

  is_open       boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (year, month)
);

-- Periode bulan berjalan dibuat OTOMATIS saat halaman pertama kali
-- dibuka pada bulan tersebut - admin tidak perlu membuatnya manual.
create or replace function public.ensure_current_period()
returns public.periods
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Tanggal menurut WIB, bukan zona server.
  today date := (now() at time zone 'Asia/Jakarta')::date;
  y int := extract(year from today)::int;
  m int := extract(month from today)::int;
  result public.periods;
begin
  insert into public.periods (year, month, current_week, auto_week, is_open)
  values (y, m, 1, true, true)
  on conflict (year, month) do nothing;

  select * into result from public.periods where year = y and month = m;
  return result;
end;
$$;

-- SECURITY DEFINER melewati RLS, jadi user cabang pun bisa memicu
-- pembuatan periode tanpa diberi hak INSERT langsung ke tabel periods.
-- Fungsi ini tidak menerima parameter - satu-satunya baris yang bisa
-- dibuatnya adalah bulan berjalan.
grant execute on function public.ensure_current_period() to authenticated;

-- ---------------------------------------------------------------------
-- 4. DATA REPORT
--    report_entries  = kondisi TERKINI satu baris MOS (per salesman)
--    values (jsonb)  = { "plan_sales": 3597, "act_prtm_w1": 233, ... }
--                      key mengikuti src/lib/metrics.ts
-- ---------------------------------------------------------------------

create table if not exists public.report_entries (
  id            uuid primary key default gen_random_uuid(),
  period_id     uuid not null references public.periods(id) on delete cascade,
  branch_id     uuid not null references public.branches(id) on delete cascade,
  salesman_id   uuid not null references public.salesmen(id) on delete cascade,
  values        jsonb not null default '{}'::jsonb,
  updated_by    uuid references public.profiles(id) on delete set null,
  updated_at    timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (period_id, salesman_id)
);

create index if not exists idx_entries_period_branch
  on public.report_entries (period_id, branch_id);

-- ---------------------------------------------------------------------
-- 5. SNAPSHOT MINGGUAN  (inti dari "data minggu sebelumnya")
--    Ketika cabang menekan SUBMIT untuk minggu N, seluruh nilai baris
--    di-copy ke sini. Snapshot bersifat IMMUTABLE - tidak pernah diubah.
--    Semua perbandingan "berubah / tidak" mengacu ke snapshot terakhir.
-- ---------------------------------------------------------------------

create table if not exists public.report_snapshots (
  id            uuid primary key default gen_random_uuid(),
  period_id     uuid not null references public.periods(id) on delete cascade,
  branch_id     uuid not null references public.branches(id) on delete cascade,
  salesman_id   uuid not null references public.salesmen(id) on delete cascade,
  week_no       int  not null check (week_no between 1 and 5),
  values        jsonb not null,
  submitted_by  uuid references public.profiles(id) on delete set null,
  submitted_at  timestamptz not null default now(),
  unique (period_id, salesman_id, week_no)
);

create index if not exists idx_snapshots_lookup
  on public.report_snapshots (period_id, branch_id, week_no);

-- Penanda cabang sudah submit minggu ke-N (level cabang, bukan salesman)
create table if not exists public.branch_submissions (
  id            uuid primary key default gen_random_uuid(),
  period_id     uuid not null references public.periods(id) on delete cascade,
  branch_id     uuid not null references public.branches(id) on delete cascade,
  week_no       int  not null check (week_no between 1 and 5),
  submitted_by  uuid references public.profiles(id) on delete set null,
  submitted_at  timestamptz not null default now(),
  note          text,
  unique (period_id, branch_id, week_no)
);

-- ---------------------------------------------------------------------
-- 6. AUDIT TRAIL PERUBAHAN  (yang dimonitor PIC Head Office)
--    Satu baris = satu sel yang berubah.
--    requires_reason = true  -> perubahan atas angka minggu yang SUDAH
--                               di-submit; reason WAJIB diisi.
--    requires_reason = false -> input normal minggu berjalan.
-- ---------------------------------------------------------------------

create type public.revision_source as enum ('grid', 'excel_upload', 'admin');

create table if not exists public.entry_revisions (
  id                uuid primary key default gen_random_uuid(),
  entry_id          uuid not null references public.report_entries(id) on delete cascade,
  period_id         uuid not null references public.periods(id) on delete cascade,
  branch_id         uuid not null references public.branches(id) on delete cascade,
  salesman_id       uuid not null references public.salesmen(id) on delete cascade,
  field_key         text not null,          -- 'act_prtm_w2', 'poco_internal', ...
  field_label       text,                   -- label human-readable saat perubahan
  old_value         numeric,
  new_value         numeric,
  delta             numeric generated always as (coalesce(new_value,0) - coalesce(old_value,0)) stored,
  requires_reason   boolean not null default false,
  reason_category   text,                   -- 'koreksi_input' | 'update_sap' | 'cancel_po' | ...
  reason            text,
  locked_week       int,                    -- minggu yang angkanya terdampak
  source            public.revision_source not null default 'grid',
  changed_by        uuid references public.profiles(id) on delete set null,
  changed_at        timestamptz not null default now(),

  -- Review oleh PIC Head Office
  reviewed_by       uuid references public.profiles(id) on delete set null,
  reviewed_at       timestamptz,
  review_status     text check (review_status in ('open','acknowledged','flagged')) default 'open',
  review_note       text,

  constraint reason_required_check
    check (requires_reason = false or (reason is not null and length(btrim(reason)) >= 10))
);

create index if not exists idx_revisions_monitor
  on public.entry_revisions (period_id, requires_reason, changed_at desc);
create index if not exists idx_revisions_branch
  on public.entry_revisions (branch_id, changed_at desc);

-- ---------------------------------------------------------------------
-- 6b. DATA TINGKAT CABANG
--     PLAN SALES MASTER, OL MIN PRTM, ACTUAL SALES — di file Excel asli,
--     tiga angka ini SELALU diisi SEKALI di baris TOTAL cabang, tidak
--     pernah dipecah per salesman (baris salesman untuk ketiga kolom itu
--     selalu kosong). Jadi disimpan terpisah dari report_entries, satu
--     baris per cabang per periode — bukan per salesman.
-- ---------------------------------------------------------------------

create table if not exists public.report_branch_entries (
  id            uuid primary key default gen_random_uuid(),
  period_id     uuid not null references public.periods(id) on delete cascade,
  branch_id     uuid not null references public.branches(id) on delete cascade,
  values        jsonb not null default '{}'::jsonb,
  updated_by    uuid references public.profiles(id) on delete set null,
  updated_at    timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (period_id, branch_id)
);

create table if not exists public.report_branch_snapshots (
  id            uuid primary key default gen_random_uuid(),
  period_id     uuid not null references public.periods(id) on delete cascade,
  branch_id     uuid not null references public.branches(id) on delete cascade,
  week_no       int  not null check (week_no between 1 and 5),
  values        jsonb not null,
  submitted_by  uuid references public.profiles(id) on delete set null,
  submitted_at  timestamptz not null default now(),
  unique (period_id, branch_id, week_no)
);

-- entry_revisions dipakai bersama oleh perubahan per-salesman (entry_id +
-- salesman_id) dan perubahan tingkat cabang (branch_entry_id) — sehingga
-- jejak audit dan aturan "wajib alasan" berlaku sama persis untuk keduanya.
alter table public.entry_revisions alter column salesman_id drop not null;
alter table public.entry_revisions alter column entry_id drop not null;
alter table public.entry_revisions
  add column if not exists branch_entry_id uuid references public.report_branch_entries(id) on delete cascade;

alter table public.entry_revisions drop constraint if exists entry_revisions_target_check;
alter table public.entry_revisions
  add constraint entry_revisions_target_check
  check (
    (entry_id is not null and salesman_id is not null and branch_entry_id is null)
    or
    (entry_id is null and salesman_id is null and branch_entry_id is not null)
  );

-- ---------------------------------------------------------------------
-- 7. HELPER FUNCTIONS untuk RLS
-- ---------------------------------------------------------------------

create or replace function public.current_role()
returns public.user_role
language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() $$;

create or replace function public.current_branch()
returns uuid
language sql stable security definer set search_path = public
as $$ select branch_id from public.profiles where id = auth.uid() $$;

create or replace function public.is_ho()
returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce(public.current_role() in ('ho_pic','admin'), false) $$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce(public.current_role() = 'admin', false) $$;

-- Boleh menulis baris cabang X?
create or replace function public.can_write_branch(target uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_admin()
      or (public.current_role() = 'cabang' and public.current_branch() = target)
$$;

-- ---------------------------------------------------------------------
-- 8. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------

alter table public.areas             enable row level security;
alter table public.branches          enable row level security;
alter table public.salesmen          enable row level security;
alter table public.profiles          enable row level security;
alter table public.periods           enable row level security;
alter table public.report_entries    enable row level security;
alter table public.report_snapshots  enable row level security;
alter table public.branch_submissions enable row level security;
alter table public.entry_revisions   enable row level security;
alter table public.report_branch_entries   enable row level security;
alter table public.report_branch_snapshots enable row level security;

-- Master data: semua user login boleh baca; hanya admin boleh ubah
create policy "master read"  on public.areas    for select to authenticated using (true);
create policy "master write" on public.areas    for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "master read"  on public.branches for select to authenticated using (true);
create policy "master write" on public.branches for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "master read"  on public.salesmen for select to authenticated using (true);
create policy "master write" on public.salesmen for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "period read"  on public.periods  for select to authenticated using (true);
create policy "period write" on public.periods  for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- Profil: user lihat dirinya sendiri; HO & admin lihat semua; admin bisa ubah
create policy "profile self"    on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_ho());
create policy "profile admin"   on public.profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Report entries:
--   cabang  -> hanya cabangnya (baca + tulis)
--   ho_pic  -> semua cabang (baca saja)
--   admin   -> semua (baca + tulis)
create policy "entry read" on public.report_entries for select to authenticated
  using (public.is_ho() or branch_id = public.current_branch());
create policy "entry insert" on public.report_entries for insert to authenticated
  with check (public.can_write_branch(branch_id));
create policy "entry update" on public.report_entries for update to authenticated
  using (public.can_write_branch(branch_id))
  with check (public.can_write_branch(branch_id));

-- Snapshot: read sesuai scope, insert oleh pemilik cabang, TIDAK BOLEH update/delete
create policy "snap read" on public.report_snapshots for select to authenticated
  using (public.is_ho() or branch_id = public.current_branch());
create policy "snap insert" on public.report_snapshots for insert to authenticated
  with check (public.can_write_branch(branch_id));
-- (sengaja tanpa policy UPDATE/DELETE: snapshot bersifat immutable)

create policy "sub read" on public.branch_submissions for select to authenticated
  using (public.is_ho() or branch_id = public.current_branch());
create policy "sub insert" on public.branch_submissions for insert to authenticated
  with check (public.can_write_branch(branch_id));

-- Data tingkat cabang: perilaku sama persis dengan report_entries/report_snapshots
create policy "branch entry read" on public.report_branch_entries for select to authenticated
  using (public.is_ho() or branch_id = public.current_branch());
create policy "branch entry insert" on public.report_branch_entries for insert to authenticated
  with check (public.can_write_branch(branch_id));
create policy "branch entry update" on public.report_branch_entries for update to authenticated
  using (public.can_write_branch(branch_id))
  with check (public.can_write_branch(branch_id));

create policy "branch snap read" on public.report_branch_snapshots for select to authenticated
  using (public.is_ho() or branch_id = public.current_branch());
create policy "branch snap insert" on public.report_branch_snapshots for insert to authenticated
  with check (public.can_write_branch(branch_id));
-- (sengaja tanpa policy UPDATE/DELETE: snapshot bersifat immutable)

-- Revisions: cabang lihat miliknya, HO lihat semua; insert oleh pemilik cabang.
-- Kolom review hanya boleh diubah oleh HO/admin.
create policy "rev read" on public.entry_revisions for select to authenticated
  using (public.is_ho() or branch_id = public.current_branch());
create policy "rev insert" on public.entry_revisions for insert to authenticated
  with check (public.can_write_branch(branch_id));
create policy "rev review" on public.entry_revisions for update to authenticated
  using (public.is_ho()) with check (public.is_ho());

-- ---------------------------------------------------------------------
-- 9. VIEW BANTU: rekap perubahan untuk dashboard PIC Head Office
-- ---------------------------------------------------------------------

create or replace view public.v_revision_monitor as
select
  r.id,
  r.period_id,
  p.year, p.month,
  b.code  as branch_code,
  b.name  as branch_name,
  a.code  as area_code,
  coalesce(s.name, 'Data Cabang (' || b.name || ')') as salesman_name,
  r.branch_entry_id is not null as is_branch_level,
  r.field_key,
  r.field_label,
  r.old_value,
  r.new_value,
  r.delta,
  r.locked_week,
  r.reason_category,
  r.reason,
  r.source,
  r.review_status,
  r.review_note,
  r.changed_at,
  pr.full_name as changed_by_name
from public.entry_revisions r
join public.periods  p on p.id = r.period_id
join public.branches b on b.id = r.branch_id
left join public.areas a on a.id = b.area_id
left join public.salesmen s on s.id = r.salesman_id
left join public.profiles pr on pr.id = r.changed_by
where r.requires_reason = true;
