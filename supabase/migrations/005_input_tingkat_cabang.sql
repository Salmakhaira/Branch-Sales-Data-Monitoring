-- =====================================================================
--  MIGRASI 005 — INPUT TINGKAT CABANG
--
--  Temuan dari file Excel asli (Sampit.xlsx dkk): PLAN SALES MASTER,
--  OL MIN PRTM, dan ACTUAL SALES SELALU diisi SEKALI di baris TOTAL
--  cabang — baris salesman untuk ketiga kolom itu selalu kosong, tidak
--  pernah dipecah per orang. Sebelum migrasi ini, sistem keliru
--  memperlakukan ketiganya sebagai kolom per salesman (harus diisi
--  berkali-kali lalu dijumlah), yang tidak sesuai dokumen aslinya dan
--  merepotkan cabang tanpa perlu.
--
--  Migrasi ini menambah tempat penyimpanan KHUSUS untuk tiga angka
--  tersebut, terpisah dari report_entries (yang tetap per salesman),
--  dengan aturan "wajib alasan" dan jejak audit yang identik.
--
--  Jalankan SESUDAH 001-004. Aman dijalankan berkali-kali.
-- =====================================================================

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

-- ---------------------------------------------------------------------
-- entry_revisions dipakai bersama: perubahan per-salesman (entry_id +
-- salesman_id, seperti sebelumnya) DAN perubahan tingkat cabang
-- (branch_entry_id, kolom baru). Salah satu pasangan wajib terisi.
-- ---------------------------------------------------------------------

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
-- RLS — identik dengan report_entries / report_snapshots
-- ---------------------------------------------------------------------

alter table public.report_branch_entries   enable row level security;
alter table public.report_branch_snapshots enable row level security;

drop policy if exists "branch entry read"   on public.report_branch_entries;
drop policy if exists "branch entry insert" on public.report_branch_entries;
drop policy if exists "branch entry update" on public.report_branch_entries;
drop policy if exists "branch snap read"    on public.report_branch_snapshots;
drop policy if exists "branch snap insert"  on public.report_branch_snapshots;

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

-- ---------------------------------------------------------------------
-- lock_week() — PIC Head Office mengunci minggu untuk SEMUA cabang
-- sekaligus. Sebelumnya hanya memotret report_entries (per salesman);
-- sekarang ikut memotret report_branch_entries (Plan Sales/OL MIN
-- PRTM/Actual Sales) supaya kedua sumber data selalu terkunci bersamaan.
-- ---------------------------------------------------------------------

create or replace function public.lock_week(p_period_id uuid, p_week int)
returns table (branches_locked int, rows_snapshotted int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branches int := 0;
  v_rows     int := 0;
  v_branch_rows int := 0;
begin
  if not public.is_ho() then
    raise exception 'Hanya PIC Head Office atau Administrator yang dapat mengunci minggu.';
  end if;

  if p_week < 1 or p_week > 5 then
    raise exception 'Minggu harus antara 1 dan 5.';
  end if;

  -- Snapshot semua baris SALESMAN cabang yang belum terkunci pada minggu ini
  with target as (
    select e.*
      from public.report_entries e
     where e.period_id = p_period_id
       and not exists (
         select 1 from public.branch_submissions s
          where s.period_id = e.period_id
            and s.branch_id = e.branch_id
            and s.week_no  = p_week
       )
  ), inserted as (
    insert into public.report_snapshots
      (period_id, branch_id, salesman_id, week_no, values, submitted_by)
    select t.period_id, t.branch_id, t.salesman_id, p_week, t.values, auth.uid()
      from target t
    on conflict (period_id, salesman_id, week_no) do nothing
    returning 1
  )
  select count(*) into v_rows from inserted;

  -- Snapshot data TINGKAT CABANG (Plan Sales/OL MIN PRTM/Actual Sales)
  with target_b as (
    select be.*
      from public.report_branch_entries be
     where be.period_id = p_period_id
       and not exists (
         select 1 from public.branch_submissions s
          where s.period_id = be.period_id
            and s.branch_id = be.branch_id
            and s.week_no  = p_week
       )
  ), inserted_b as (
    insert into public.report_branch_snapshots
      (period_id, branch_id, week_no, values, submitted_by)
    select t.period_id, t.branch_id, p_week, t.values, auth.uid()
      from target_b t
    on conflict (period_id, branch_id, week_no) do nothing
    returning 1
  )
  select count(*) into v_branch_rows from inserted_b;

  with marked as (
    insert into public.branch_submissions (period_id, branch_id, week_no, submitted_by, note)
    select distinct e.period_id, e.branch_id, p_week, auth.uid(), 'Dikunci oleh Head Office'
      from public.report_entries e
     where e.period_id = p_period_id
    on conflict (period_id, branch_id, week_no) do nothing
    returning 1
  )
  select count(*) into v_branches from marked;

  return query select v_branches, v_rows + v_branch_rows;
end;
$$;

grant execute on function public.lock_week(uuid, int) to authenticated;

-- ---------------------------------------------------------------------
-- VIEW MONITORING — ikutkan baris tingkat cabang (salesman_id null)
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
  r.reason_status,
  r.source,
  r.review_status,
  r.review_note,
  r.changed_at,
  coalesce(pr.full_name, r.changed_by_name) as changed_by_name
from public.entry_revisions r
join public.periods  p on p.id = r.period_id
join public.branches b on b.id = r.branch_id
left join public.areas a on a.id = b.area_id
left join public.salesmen s on s.id = r.salesman_id
left join public.profiles pr on pr.id = r.changed_by
where r.requires_reason = true;

-- ---------------------------------------------------------------------
-- Verifikasi:
--   select * from public.report_branch_entries limit 5;
--   select * from public.v_revision_monitor where is_branch_level order by changed_at desc limit 20;
-- ---------------------------------------------------------------------
