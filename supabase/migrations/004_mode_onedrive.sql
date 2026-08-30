-- =====================================================================
--  MIGRASI 004 — MODE ONEDRIVE
--
--  Cabang tetap mengisi file Excel di OneDrive. Power Automate mengirim
--  file itu ke website setiap kali berubah. Website yang menghitung,
--  merekap, dan memonitor.
--
--  Perbedaan mendasar dengan mode input-di-website:
--  alasan perubahan TIDAK bisa dipaksa saat mengubah, jadi sistem
--  menagihnya setelah perubahan terdeteksi. Karena itu baris audit kini
--  punya tiga status: not_required / pending / provided.
--
--  Jalankan SESUDAH 001-003. Aman dijalankan berkali-kali.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. STATUS ALASAN
--    Constraint lama menolak baris wajib-alasan yang alasannya kosong.
--    Di mode OneDrive baris seperti itu justru normal (menunggu diisi),
--    jadi constraint diganti.
-- ---------------------------------------------------------------------

alter table public.entry_revisions
  add column if not exists reason_status text not null default 'not_required';

alter table public.entry_revisions
  add column if not exists changed_by_name text;

-- Backfill data lama: yang wajib alasan pasti sudah terisi (dipaksa UI)
update public.entry_revisions
   set reason_status = case when requires_reason then 'provided' else 'not_required' end
 where reason_status = 'not_required' and requires_reason = true;

alter table public.entry_revisions drop constraint if exists reason_required_check;
alter table public.entry_revisions drop constraint if exists reason_status_check;
alter table public.entry_revisions drop constraint if exists reason_text_check;

alter table public.entry_revisions
  add constraint reason_status_check
  check (reason_status in ('not_required', 'pending', 'provided'));

alter table public.entry_revisions
  add constraint reason_text_check
  check (
    reason_status <> 'provided'
    or (reason is not null and length(btrim(reason)) >= 10)
  );

create index if not exists idx_revisions_pending
  on public.entry_revisions (branch_id, reason_status)
  where reason_status = 'pending';

-- ---------------------------------------------------------------------
-- 2. SUMBER FILE PER CABANG
--    Didaftarkan otomatis saat sync pertama, dipakai untuk mendeteksi
--    bila tiba-tiba ada file lain yang dikirim atas nama cabang yang sama.
-- ---------------------------------------------------------------------

create table if not exists public.sync_sources (
  id             uuid primary key default gen_random_uuid(),
  branch_id      uuid not null references public.branches(id) on delete cascade,
  file_id        text,                    -- driveItem id dari OneDrive
  file_name      text,
  folder_path    text,
  last_hash      text,                    -- sha256 isi file terakhir
  last_synced_at timestamptz,
  created_at     timestamptz not null default now(),
  unique (branch_id)
);

-- ---------------------------------------------------------------------
-- 3. RIWAYAT SYNC
--    Satu baris per kiriman dari Power Automate. Inilah yang dilihat
--    admin kalau ada cabang yang datanya tidak kunjung masuk.
-- ---------------------------------------------------------------------

create table if not exists public.sync_runs (
  id                uuid primary key default gen_random_uuid(),
  branch_id         uuid references public.branches(id) on delete set null,
  period_id         uuid references public.periods(id) on delete set null,
  file_name         text,
  file_id           text,
  content_hash      text,
  modified_by_name  text,                 -- dari metadata OneDrive
  file_modified_at  timestamptz,
  layout            text,                 -- 'template' | 'legacy'
  status            text not null default 'ok'
                    check (status in ('ok', 'partial', 'failed', 'skipped')),
  rows_parsed       int  not null default 0,
  cells_changed     int  not null default 0,
  revisions_created int  not null default 0,
  issues            jsonb not null default '[]'::jsonb,
  message           text,
  created_at        timestamptz not null default now()
);

create index if not exists idx_sync_runs_branch
  on public.sync_runs (branch_id, created_at desc);

alter table public.sync_sources enable row level security;
alter table public.sync_runs    enable row level security;

create policy "sync source read" on public.sync_sources for select to authenticated
  using (public.is_ho() or branch_id = public.current_branch());
create policy "sync source admin" on public.sync_sources for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "sync run read" on public.sync_runs for select to authenticated
  using (public.is_ho() or branch_id = public.current_branch());

-- Penulisan ke dua tabel ini dilakukan route webhook memakai service role,
-- yang melewati RLS. Tidak ada policy INSERT untuk user biasa.

-- ---------------------------------------------------------------------
-- 4. CABANG MENGISI ALASAN
--    Lewat fungsi, bukan UPDATE langsung, supaya user cabang tidak bisa
--    ikut mengubah kolom tinjauan milik PIC Head Office.
-- ---------------------------------------------------------------------

create or replace function public.submit_revision_reason(
  p_revision_id uuid,
  p_category    text,
  p_reason      text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch uuid;
  v_status text;
begin
  select branch_id, reason_status into v_branch, v_status
    from public.entry_revisions where id = p_revision_id;

  if v_branch is null then
    raise exception 'Baris revisi tidak ditemukan.';
  end if;

  -- Cabang hanya boleh mengisi miliknya sendiri; admin boleh semua.
  if not (public.is_admin() or v_branch = public.current_branch()) then
    raise exception 'Anda tidak berhak mengisi alasan untuk cabang ini.';
  end if;

  if v_status <> 'pending' then
    raise exception 'Baris ini tidak sedang menunggu alasan.';
  end if;

  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception 'Keterangan minimal 10 karakter.';
  end if;

  if p_category is null or length(btrim(p_category)) = 0 then
    raise exception 'Kategori alasan wajib dipilih.';
  end if;

  update public.entry_revisions
     set reason          = btrim(p_reason),
         reason_category = p_category,
         reason_status   = 'provided',
         changed_by      = coalesce(changed_by, auth.uid())
   where id = p_revision_id;
end;
$$;

grant execute on function public.submit_revision_reason(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. PIC HEAD OFFICE MENGUNCI MINGGU
--    Memotret SELURUH cabang sekaligus menjadi laporan resmi minggu N.
--    Cabang yang sudah terkunci pada minggu itu dilewati.
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
begin
  if not public.is_ho() then
    raise exception 'Hanya PIC Head Office atau Administrator yang dapat mengunci minggu.';
  end if;

  if p_week < 1 or p_week > 5 then
    raise exception 'Minggu harus antara 1 dan 5.';
  end if;

  -- Snapshot semua baris cabang yang belum terkunci pada minggu ini
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

  with marked as (
    insert into public.branch_submissions (period_id, branch_id, week_no, submitted_by, note)
    select distinct e.period_id, e.branch_id, p_week, auth.uid(), 'Dikunci oleh Head Office'
      from public.report_entries e
     where e.period_id = p_period_id
    on conflict (period_id, branch_id, week_no) do nothing
    returning 1
  )
  select count(*) into v_branches from marked;

  return query select v_branches, v_rows;
end;
$$;

grant execute on function public.lock_week(uuid, int) to authenticated;

-- ---------------------------------------------------------------------
-- 6. VIEW MONITORING — ikutkan status alasan
-- ---------------------------------------------------------------------

create or replace view public.v_revision_monitor as
select
  r.id,
  r.period_id,
  p.year, p.month,
  b.code  as branch_code,
  b.name  as branch_name,
  a.code  as area_code,
  s.name  as salesman_name,
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
join public.salesmen s on s.id = r.salesman_id
left join public.profiles pr on pr.id = r.changed_by
where r.requires_reason = true;

-- ---------------------------------------------------------------------
-- Verifikasi:
--   select reason_status, count(*) from public.entry_revisions group by 1;
--   select * from public.sync_runs order by created_at desc limit 10;
-- ---------------------------------------------------------------------
