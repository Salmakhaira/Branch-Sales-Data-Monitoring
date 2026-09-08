-- =====================================================================
--  008: INTEGRASI ONEDRIVE VIA POWER AUTOMATE
--
--  Menambahkan jalur ketiga untuk mengisi data laporan, di samping grid
--  manual dan upload Excel manual: sinkronisasi otomatis lewat Power
--  Automate, yang memantau folder OneDrive tiap cabang dan mengirim file
--  yang berubah ke endpoint /api/webhook/onedrive-sync.
--
--  Pendekatan ini SENGAJA dipilih ketimbang mengulang mode OneDrive lama
--  yang dihapus di migration 006 (connect langsung ke Microsoft Graph API,
--  butuh registrasi aplikasi ke Azure AD + admin consent dari IT). Power
--  Automate tidak butuh itu — memakai akses OneDrive milik pembuat flow
--  sendiri. Lihat README bagian "Integrasi OneDrive (Power Automate)".
--
--  PENTING: source baru ini TIDAK melewati aturan wajib-alasan untuk
--  perubahan pada minggu yang sudah terkunci (lihat src/lib/saveEntries.ts,
--  parameter allowPartialOnConflict) — kalau file yang masuk otomatis
--  ternyata mengandung perubahan atas angka yang sudah di-submit, sel itu
--  DILEWATI (tidak disimpan) dan dicatat di onedrive_sync_runs sebagai
--  butuh tindak lanjut manusia, bukan disimpan diam-diam atau menggagalkan
--  seluruh file.
-- =====================================================================

-- Tambah 'power_automate' ke enum sumber revisi yang sudah ada.
alter type public.revision_source add value if not exists 'power_automate';

-- ---------------------------------------------------------------------
-- Log tiap kali webhook dipanggil Power Automate — sukses maupun gagal.
-- Ini yang membuat flow yang diam-diam berhenti (kredensial OneDrive
-- kedaluwarsa, folder dipindah, dll.) TERLIHAT dari dashboard, bukan baru
-- ketahuan saat ada yang komplain data cabang telat.
-- ---------------------------------------------------------------------
create table if not exists public.onedrive_sync_runs (
  id                uuid primary key default gen_random_uuid(),
  branch_id         uuid references public.branches(id) on delete set null,
  branch_code       text not null,          -- disimpan apa adanya juga, untuk kasus branch_id tidak ditemukan
  period_id         uuid references public.periods(id) on delete set null,
  file_name         text,
  status            text not null check (status in ('ok', 'partial', 'failed')),
  rows_parsed       int not null default 0,
  rows_saved        int not null default 0,
  rows_skipped      int not null default 0,  -- butuh alasan tapi otomatis tidak bisa mengisi -> dilewati
  parse_issues      jsonb,                    -- ParseIssue[] dari parseBranchTemplate, bila ada
  skipped_fields    jsonb,                    -- SaveConflict[] yang dilewati, untuk ditindaklanjuti admin
  error_message     text,
  created_at        timestamptz not null default now()
);

create index if not exists idx_onedrive_sync_runs_branch
  on public.onedrive_sync_runs (branch_id, created_at desc);

-- RLS: hanya admin & ho_pic (monitoring) yang boleh membaca log ini lewat
-- client biasa. Webhook sendiri menulis lewat service role key, yang
-- melewati RLS sepenuhnya — jadi policy INSERT di bawah ini sebenarnya
-- tidak pernah dipakai jalur webhook, hanya berjaga-jaga.
alter table public.onedrive_sync_runs enable row level security;

create policy "onedrive_sync_runs_read_ho"
  on public.onedrive_sync_runs for select
  to authenticated
  using (public.is_ho());
