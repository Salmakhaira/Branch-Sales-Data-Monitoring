# Sales Branch Report Data Monitoring

Sistem pengganti alur report Excel berantai (Excel cabang → template cabang → link ke rekap
nasional → kolom rapat monitoring), dengan penguncian data mingguan dan pencatatan alasan
setiap perubahan angka.

**Stack:** Next.js 14 (App Router) · TypeScript · Tailwind CSS · Supabase (PostgreSQL + Auth + RLS)

---

## 1. Ringkasan cara kerja

```
                       ┌──────────────────────────────────────┐
   Cabang              │  Grid input  ATAU  Upload Excel      │
   (13 cabang)         │  (kolom hitungan tidak bisa diketik) │
                       └───────────────┬──────────────────────┘
                                       │ POST /api/entries
                                       ▼
                       ┌──────────────────────────────────────┐
                       │  Server memeriksa tiap sel:          │
                       │  berubah dari yang sudah dilaporkan? │
                       └───────┬──────────────────────┬───────┘
                          tidak│                 ya   │
                               ▼                      ▼
                        langsung simpan        HTTP 409 → modal
                                               "Alasan Perubahan"
                                                       │
                                                       ▼
                       ┌──────────────────────────────────────┐
                       │  report_entries  (nilai terkini)     │
                       │  entry_revisions (audit + alasan)    │
                       └───────────────┬──────────────────────┘
                                       │
                     ┌─────────────────┴────────────────────┐
                     ▼                                      ▼
          Rekap Nasional (otomatis)          Monitoring Perubahan (PIC HO)
          total cabang → area → grand        siapa, kapan, dari berapa ke
          total, dihitung ulang dari         berapa, dan ALASANNYA
          angka mentah                       + tombol tinjau / klarifikasi
```

Saat cabang menekan **Submit Minggu N**, seluruh barisnya disalin ke `report_snapshots`
(tidak pernah diubah lagi). Mulai saat itu:

| Jenis kolom | Sebelum submit | Setelah submit Minggu N |
|---|---|---|
| Kolom bulanan (Plan Sales, OL Min PRTM, PO Non SAP, POCO/PRTM, Actual Sales) | bebas diisi | **wajib alasan** |
| Kolom mingguan W1 … W N | bebas diisi | **wajib alasan** |
| Kolom mingguan W(N+1) … W4 | bebas diisi | bebas diisi |

Validasi ini dijalankan **di server** (`src/app/api/entries/route.ts`), bukan hanya di
browser, jadi tidak bisa dilewati lewat devtools atau request manual. Database pun ikut
menjaga lewat `constraint reason_required_check` — baris audit bertanda wajib-alasan
ditolak bila alasannya kosong atau kurang dari 10 karakter.

---

## 2. Halaman yang tersedia

| Alamat | Halaman | Cabang | PIC HO | Admin |
|---|---|:--:|:--:|:--:|
| `/` | Ringkasan status cabang **+ monitoring perubahan** | ✓ | ✓ | ✓ |
| `/input` | Input report — pilih bulan & tahun & minggu, grid + upload | ✓ | — | ✓ |
| `/national` | Rekap nasional + export Excel | ✓ | ✓ | ✓ |
| `/admin` | Hak akses user, master cabang, status periode | — | — | ✓ |
| `/login` | Halaman masuk | — | — | — |

Menu disembunyikan secara default dan dibuka lewat tombol **☰** di bilah atas; menekan
tombol yang sama menutupnya lagi. Isi menu menyesuaikan role secara otomatis: user cabang
tidak melihat menu Administrasi, PIC Head Office tidak melihat menu Input Report.
Monitoring perubahan berada di bagian bawah halaman Ringkasan, bukan menu terpisah.

Di halaman Input Report ada pemilih mode **Isi Langsung** (grid) dan **Upload Excel**.
Keduanya menyimpan lewat API yang sama, jadi aturan wajib-alasan berlaku identik. Pemilih
periodenya dipecah jadi dua kotak — **Bulan** dan **Tahun** — supaya tidak perlu memindai
daftar 24 bulan; berganti bulan otomatis mengatur ulang pilihan minggu.

Di atas keduanya selalu ada satu panel kecil, **Data Tingkat Cabang**: PLAN SALES MASTER,
OL MIN PRTM, dan ACTUAL SALES. Ketiganya sengaja **tidak** ada di grid per salesman maupun
di template upload — di file Excel asli, ketiga angka itu SELALU diisi sekali di baris TOTAL
cabang, tidak pernah dipecah per orang (dicek langsung di `Sampit.xlsx`: baris salesman untuk
kolom N/AG/BM selalu kosong). Panel ini meniru itu: satu angka per kolom, disimpan ke tabel
terpisah (`report_branch_entries`), dengan aturan wajib-alasan dan jejak audit yang identik
dengan grid. Lihat `src/app/(app)/input/BranchLevelPanel.tsx` dan §8 (BRANCH_INPUT_KEYS di
`src/lib/metrics.ts`).

---

## 3. Menjawab pertanyaan "input pakai form atau upload Excel?"

Keduanya dibangun, dan keduanya melewati pintu validasi yang sama. Perbandingannya:

| | Grid web | Upload Excel |
|---|---|---|
| Risiko salah kolom | nihil — kolom terikat namanya | rendah — parser membaca *kunci teknis* di baris ke-6, bukan posisi kolom |
| Rumus rusak / `#REF!` | mustahil — kolom hitungan tidak ada di form | mustahil — kolom hitungan tidak ada di template |
| Salah tempel antar cabang | mustahil — user cabang hanya melihat cabangnya | terdeteksi — ID salesman dicocokkan, baris asing ditolak |
| Ketahuan sebelum tersimpan | ya, sel berubah langsung ditandai merah | ya, ada layar preview diff sebelum konfirmasi |
| Cocok untuk | pembaruan rutin mingguan | cabang yang sudah terlanjur menyiapkan data di Excel |

**Rekomendasi penerapan:** buka dua-duanya di bulan pertama supaya cabang tidak kaget, lalu
setelah 2–3 bulan matikan upload (cukup hapus tombol modenya di
`src/app/(app)/input/ReportWorkspace.tsx`).
Grid web memberi jejak audit yang paling bersih karena perubahan tercatat per sel saat
diketik, bukan per file.

---

## 4. Instalasi

### 4.1 Siapkan Supabase

1. Buat project baru di [supabase.com](https://supabase.com) (free tier cukup untuk 13 cabang).
2. Buka **SQL Editor**, jalankan berurutan:
   - `supabase/schema.sql` — tabel, tipe, RLS, view monitoring
   - `supabase/seed.sql` — 3 area, 13 cabang, 39 salesman, periode Agustus 2026
   - `supabase/migrations/004_mode_onedrive.sql` — status alasan & fungsi kunci
     minggu. **Wajib** (nama file historis; tabel sync di dalamnya sudah
     dihapus lagi oleh migration 006 — lihat di bawah).
   - `supabase/migrations/005_input_tingkat_cabang.sql` — tempat penyimpanan
     khusus untuk PLAN SALES MASTER / OL MIN PRTM / ACTUAL SALES (diisi
     sekali per cabang, bukan per salesman — lihat §2). **Wajib**.
   - `supabase/migrations/006_hapus_onedrive.sql` — bersih-bersih sisa tabel/fungsi
     mode OneDrive yang tidak lagi dipakai (`sync_sources`, `sync_runs`,
     `submit_revision_reason`). **Wajib** dijalankan sekali.
   - `supabase/migrations/007_periode_2026_2027.sql` — membuat seluruh periode
     Januari 2026 s/d Desember 2027 sekaligus, supaya pemilih bulan di halaman
     Input Report langsung berisi penuh. **Wajib**; aman diulang.

   > Master data di `seed.sql` diambil langsung dari sheet `MOS AGUSTUS 2026`
   > pada *WEEKLY REPORT MOS NASIONAL 2026.xlsx*, jadi sudah sesuai kondisi nyata.

3. **Authentication → Providers**: aktifkan *Email*, matikan *Confirm email* bila akun
   dibuat manual oleh admin.
4. **Authentication → Users → Add user**: buat akun untuk admin, PIC HO, dan tiap cabang.
   Centang *Auto Confirm User*.
5. Kembali ke **SQL Editor**, tetapkan role:

   ```sql
   update public.profiles set role = 'admin'  where email = 'admin@perusahaan.co.id';
   update public.profiles set role = 'ho_pic' where email = 'pic.ho@perusahaan.co.id';

   update public.profiles
      set role = 'cabang',
          branch_id = (select id from public.branches where code = 'SMP')
    where email = 'sampit@perusahaan.co.id';
   ```

   Setelah ada satu admin, sisanya bisa diatur lewat menu **Administrasi** di web.

### 4.2 Jalankan aplikasi

```bash
npm install
cp .env.local.example .env.local     # Windows: copy .env.local.example .env.local
npm run dev                          # http://localhost:3000
```

Isi `.env.local` dengan **Project URL** dan **anon public key** dari
Supabase → Project Settings → API. Hanya dua nilai itu yang dibutuhkan.

### 4.3 Deploy

```bash
# Vercel (paling cepat, gratis untuk pemakaian internal)
npx vercel
# tambahkan kedua environment variable di Vercel → Settings → Environment Variables
```

Bisa juga di-deploy ke server internal:

```bash
npm run build && npm run start       # default port 3000
```

---

## 5. Periode & minggu berjalan sendiri

Minggu berjalan dihitung dari tanggal hari ini, jadi admin tidak perlu menggesernya
tiap Senin:

| Minggu | Tanggal |
|---|---|
| Minggu 1 | 1 – 7 |
| Minggu 2 | 8 – 14 |
| Minggu 3 | 15 – 21 |
| Minggu 4 | 22 – akhir bulan |

Sengaja tidak pernah ada "minggu ke-5" — sisa hari di akhir bulan tetap masuk Minggu 4,
sama seperti kolom W1–W4 di Excel.

Perhitungan memakai zona waktu **Asia/Jakarta**, bukan zona server. Ini penting karena
Vercel menjalankan server dalam UTC — tanpa penyesuaian ini, pergantian minggu akan
terjadi pukul 07:00 WIB, bukan tengah malam. Logikanya ada di `src/lib/period.ts`.

### Cabang tetap bisa memilih bulan & minggu

Yang otomatis hanya **default**-nya. Di halaman Input Report, cabang bebas berpindah:

- **Pilih bulan** — untuk menyusul atau memperbaiki data bulan lalu, selama periodenya
  belum ditutup Administrator.
- **Pilih minggu** — misalnya melapor untuk Minggu 2 padahal hari ini sudah Minggu 4.
  Yang dikunci saat Submit adalah minggu yang dipilih, jadi snapshot tersimpan jujur
  sebagai laporan minggu tersebut.

Keempat kolom W1–W4 selalu terlihat di grid; kolom minggu yang sedang dilaporkan ditandai
biru, dan kolom turunan (TOTAL OL PRTM dst.) dihitung dari kolom minggu itu.

Satu batasan yang ditegakkan **di server**: pada bulan berjalan, cabang tidak bisa submit
untuk minggu yang belum tiba. Datanya boleh diisi lebih dulu, tapi submit-nya menunggu
minggunya berjalan. Pada bulan yang sudah lewat, keempat minggu terbuka.

**Periode bulan baru juga dibuat sendiri.** Saat halaman pertama kali dibuka pada bulan
yang belum punya periode, fungsi database `ensure_current_period()` membuatnya otomatis.
Fungsi itu `SECURITY DEFINER` dan tidak menerima parameter apa pun — satu-satunya baris
yang bisa dibuatnya adalah bulan berjalan — sehingga user cabang bisa memicunya tanpa
diberi hak tulis ke tabel `periods`.

Hasilnya, panel Administrasi tidak punya tugas rutin sama sekali: tidak ada tombol geser
minggu, tidak ada form buat periode.

Bila suatu saat benar-benar perlu membekukan minggu (misal libur panjang membuat pelaporan
digeser), override dilakukan lewat SQL:

```sql
update public.periods
   set auto_week = false, current_week = 3
 where year = 2026 and month = 8;
```

Begitu override aktif, panel Administrasi otomatis menampilkan tombol pemilih minggu
beserta tombol **Kembalikan ke otomatis** — jadi tidak perlu SQL lagi untuk mengembalikannya.

---

## 6. Alur pemakaian mingguan

| Hari | Pelaku | Tindakan |
|---|---|---|
| — | *(otomatis)* | Minggu berjalan berganti sendiri mengikuti tanggal |
| Senin–Selasa | Cabang | **Input Report** (atau **Upload Excel**) → **Simpan** |
| Selasa sore | Cabang | Tekan **Submit Minggu N** → angka terkunci |
| Rabu | PIC HO | **Rekap Nasional** → tinjau angka, **Export Excel** untuk bahan rapat |
| Kapan saja | PIC HO | **Ringkasan** → gulir ke Monitoring Perubahan, baca alasan tiap angka yang berubah, tandai *Ditinjau* atau *Perlu klarifikasi* |
| Awal bulan | *(otomatis)* | Periode bulan baru terbentuk sendiri |

Jika setelah submit ternyata ada angka yang keliru, cabang tetap boleh memperbaikinya —
sistem hanya menuntut kategori + keterangan minimal 10 karakter, lalu perubahan itu
langsung muncul di layar PIC Head Office.

---

## 7. Struktur kode

```
supabase/
  schema.sql                    tabel, RLS, view monitoring
  seed.sql                      master area/cabang/salesman (dari Excel asli)
  migrations/001_revisi_agustus.sql     \
  migrations/002_hapus_back_order.sql    } untuk database yang sudah terlanjur dibuat
  migrations/003_periode_otomatis.sql    /
  migrations/004_mode_onedrive.sql      status alasan & kunci minggu (WAJIB)
  migrations/005_input_tingkat_cabang.sql  data tingkat cabang: Plan Sales/OL MIN PRTM/Actual Sales (WAJIB)
  migrations/006_hapus_onedrive.sql     bersih-bersih sisa tabel/fungsi mode OneDrive (WAJIB)
  migrations/007_periode_2026_2027.sql  seluruh periode Jan 2026 - Des 2027 (WAJIB)

public/
  logo-traktor-nusantara.png    logo penuh (header aplikasi & halaman masuk)
  logo-mark.png                 lambang kotaknya saja
  icon.png / apple-icon.png     ikon tab & layar utama ponsel

src/lib/
  metrics.ts        ★ SUMBER KEBENARAN — definisi kolom + semua rumus turunan
  period.ts           perhitungan minggu berjalan dari kalender
  excel.ts            parser file upload (SheetJS, jalan di browser)
  xlsx-styled.ts      pembuat file Excel bergaya (ExcelJS, jalan di server)
  report.ts           query data (server-side)
  format.ts           format angka/tanggal gaya Indonesia
  types.ts            tipe data bersama
  supabase/           client browser & server

src/app/
  layout.tsx                    root layout
  login/                        halaman masuk (di luar shell aplikasi)
  (app)/                        route group — shell dengan header & tab navigasi
    layout.tsx                  cek login, muat profil & nama cabang
    page.tsx                    Ringkasan + status submit tiap cabang  →  /
    input/page.tsx              pemilih bulan, minggu & cabang
    input/ReportWorkspace.tsx   pemilih mode: grid atau upload Excel
    input/BranchLevelPanel.tsx  Plan Sales/OL MIN PRTM/Actual Sales — sekali per cabang
    input/InputGrid.tsx       ★ grid ala Excel + penandaan sel terkunci
    input/UploadPanel.tsx     ★ unduh template, upload, preview diff
    national/                   rekap nasional + export
    admin/                      hak akses user, master cabang, status periode
  api/
    entries/route.ts          ★ penyimpanan + penegakan aturan alasan
    submit/route.ts             snapshot & penguncian mingguan
    export/route.ts             rekap nasional .xlsx bergaya (ExcelJS)
    template/route.ts           template input cabang .xlsx (ExcelJS)
    admin/                      periode & user

src/components/
  AppSidebar.tsx                bilah atas + panel menu geser (tombol ☰) sesuai role
  MonthYearPicker.tsx           pemilih Bulan & Tahun terpisah (halaman Input Report)
  PeriodPicker.tsx              pemilih periode gabungan, dikelompokkan per tahun
  admin/PeriodStatus.tsx        status periode (bukan panel pengaturan)
  RevisionMonitor.tsx           tabel audit perubahan (dipakai di Ringkasan)
  ReasonModal.tsx             ★ modal wajib-isi-alasan
  ReviewControls.tsx            tombol tinjau/klarifikasi untuk PIC HO
  …

scripts/
  verify-formula.ts             uji rumus terhadap data Excel asli
  verify-week.ts                uji aturan minggu & batas tengah malam WIB
  preview-export.ts             buat contoh file Excel tanpa perlu database
  fixtures/mos-sampit.json      data uji dari sheet MOS Sampit.xlsx
```

> Nama folder `(app)` memakai tanda kurung — itu *route group* Next.js, yang tidak ikut
> muncul di URL. Jadi `(app)/national/page.tsx` beralamat `/national`, bukan
> `/app/national`. Gunanya: seluruh halaman di dalamnya otomatis memakai header dan
> pemeriksaan login yang sama, sementara `/login` tetap di luar.

### Menambah kolom baru

Cukup satu tempat: tambahkan objek `Metric` di `src/lib/metrics.ts`. Grid input, template
Excel, parser upload, rekap nasional, dan export semuanya membaca daftar yang sama, jadi
tidak ada risiko satu bagian ketinggalan. Kalau kolom barunya seperti PLAN SALES MASTER —
satu angka untuk seluruh cabang, bukan per salesman — beri `level: 'branch'`; otomatis
muncul di panel Data Tingkat Cabang, bukan di grid per salesman.

Isi juga field `mos: { top, sub, tier }` supaya kolom itu muncul di posisi yang benar pada
header bertingkat tiga — `top` = judul grup besar, `sub` = judul kolom, `tier` = rincian
seperti `>80%` (opsional). Header **grid web dan template Excel** sama-sama dibuat persis
seperti sheet `MOS` di file Excel cabang supaya user tidak perlu belajar tata letak baru.

**Urutan kolom** tidak lagi diatur daftar terpisah: seluruh aplikasi mengurutkan kolom
berdasarkan huruf kolom Excel di field `excel` (lihat `ORDERED_METRICS`). Jadi cukup isi
`excel` dengan huruf kolom aslinya dan kolom baru otomatis muncul di posisi yang benar,
baik di grid, template, maupun rekap nasional.

### Menambah atau menghapus tab

Ubah array `nav` di `src/components/AppSidebar.tsx`. Menu selalu berupa panel geser yang
dibuka-tutup lewat tombol ☰ di bilah atas.

---

## 8. Verifikasi rumus

```bash
npm run test:formula      # bandingkan rumus dengan angka Excel asli
npm run test:week         # uji aturan minggu & zona waktu WIB
npm run preview:export    # buat contoh file Excel tanpa perlu database
```

Skrip ini membandingkan mesin perhitungan dengan **159 angka asli** dari sheet `MOS` pada
*Sampit.xlsx* — hasilnya identik seluruhnya (toleransi 1e-6).

Skrip yang sama juga melaporkan temuan pada file Excel yang berjalan sekarang: **5 dari 53
baris salesman** memiliki rumus yang menunjuk kolom minggu berbeda antara `TOTAL OL PRTM`
dan `TOTAL PO` pada baris yang sama, contohnya

```
Baris 46 — ALIF ALVIANTO
  AF (TOTAL OL PRTM): =SUM(Q46,Y46,AE46)   ← minggu 3
  AJ (TOTAL PO)     : =O46+AI46            ← minggu 1
```

Di file *WEEKLY REPORT MOS NASIONAL 2026.xlsx* pun sheet `MOS AGUSTUS 2026` masih memakai
rumus minggu ke-4 (`=R8+AB8+AE8`) padahal data yang terisi baru minggu ke-1, dan baris
`TOTAL` menampilkan `#REF!` akibat tautan antar-file yang putus.

Ini bukan kesalahan siapa pun — memang begitulah sifat rumus yang disalin manual antar
bulan dan antar file. Di sistem baru rumus ditulis satu kali dan dipakai seragam, sehingga
kelas kesalahan ini hilang sepenuhnya.

---

## 9. Peran & hak akses

| Peran | Lihat | Isi data | Submit | Tinjau perubahan | Kelola sistem |
|---|---|---|---|---|---|
| **Cabang** | cabangnya sendiri | ✓ cabangnya | ✓ | — | — |
| **PIC Head Office** | semua cabang | — | — | ✓ | — |
| **Administrator** | semua cabang | ✓ semua | ✓ | ✓ | ✓ |

Pembatasan ini ditegakkan di tiga lapis: tab navigasi (UI), API route (server), dan Row
Level Security PostgreSQL. Walaupun seseorang memanggil API Supabase langsung dengan anon
key, RLS tetap menolak akses ke data cabang lain.

---

## 10. Yang sengaja belum dibuat

Bagian ini disiapkan untuk tahap berikutnya, bukan kelalaian:

- **Kolom lanjutan** — DFO (Proposed/Approved/ETA), Problem Identification & Corrective
  Action beserta PIC/Due Date/Status, PO Carry Over, serta perbandingan *Branch version*
  vs *HDO version*. Semua tinggal ditambahkan di `src/lib/metrics.ts`.
- **Notifikasi** — pengingat otomatis untuk cabang yang belum submit, dan pemberitahuan ke
  PIC HO saat ada perubahan besar. Paling ringan lewat email Supabase Edge Function.
- **Integrasi SAP/CRM** — kolom `ACT PRTM by SO SAP` dan `LIVE QUOTATION by CRM` idealnya
  ditarik otomatis, bukan diketik. Ini penghapus human error terbesar berikutnya.
- **Riwayat grafik** — tren OL Revenue per cabang antar minggu; datanya sudah tersimpan
  lengkap di `report_snapshots`, tinggal divisualkan.
