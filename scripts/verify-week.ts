/* =====================================================================
 *  UJI PERHITUNGAN MINGGU  —  npm run test:week
 *
 *  Memeriksa aturan minggu pelaporan dan penanganan zona waktu.
 *  Bagian paling rawan adalah batas tengah malam WIB: server berjalan
 *  dalam UTC, jadi tanpa penyesuaian, minggu akan berganti pukul 07:00
 *  pagi WIB. Tes di bawah mengunci perilaku itu.
 * =================================================================== */

import { weekOfMonth, jakartaToday, resolveWeek, weekRange, nextWeekChange, daysInMonth } from '../src/lib/period';
import type { Period } from '../src/lib/types';

let pass = 0, fail = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  if (!ok) console.log(`  ✗ ${label}: dapat ${JSON.stringify(actual)}, harusnya ${JSON.stringify(expected)}`);
}

console.log('--- batas minggu ---');
for (const [d, w] of [[1,1],[7,1],[8,2],[14,2],[15,3],[21,3],[22,4],[28,4],[31,4]] as [number,number][]) {
  eq(`tgl ${d}`, weekOfMonth(d), w);
}

console.log('--- rentang tanggal per minggu (Agustus 31 hari) ---');
eq('W1', weekRange(2026,8,1), {start:1,end:7});
eq('W3', weekRange(2026,8,3), {start:15,end:21});
eq('W4 Agustus', weekRange(2026,8,4), {start:22,end:31});
eq('W4 Februari 2026', weekRange(2026,2,4), {start:22,end:28});
eq('hari Februari 2026', daysInMonth(2026,2), 28);
eq('hari Februari 2028 (kabisat)', daysInMonth(2028,2), 29);

console.log('--- resolveWeek ---');
const mk = (y:number,m:number,auto:boolean,cw=1): Period =>
  ({id:'x',year:y,month:m,current_week:cw,auto_week:auto,is_open:true});
const at = (iso: string) => new Date(iso);

eq('bulan berjalan tgl 27 -> W4', resolveWeek(mk(2026,8,true), at('2026-08-27T05:00:00Z')), 4);
eq('bulan berjalan tgl 9 -> W2',  resolveWeek(mk(2026,8,true), at('2026-08-09T05:00:00Z')), 2);
eq('bulan lampau -> W4',          resolveWeek(mk(2026,7,true), at('2026-08-09T05:00:00Z')), 4);
eq('bulan depan -> W1',           resolveWeek(mk(2026,9,true), at('2026-08-09T05:00:00Z')), 1);
eq('manual dihormati',            resolveWeek(mk(2026,8,false,2), at('2026-08-27T05:00:00Z')), 2);

console.log('--- zona waktu WIB (batas tengah malam) ---');
// 31 Juli 17:00 UTC = 1 Agustus 00:00 WIB
eq('31 Jul 17:00 UTC = 1 Agu WIB', jakartaToday(at('2026-07-31T17:00:00Z')), {year:2026,month:8,day:1});
// 31 Juli 16:59 UTC = 31 Juli 23:59 WIB
eq('31 Jul 16:59 UTC = 31 Jul WIB', jakartaToday(at('2026-07-31T16:59:00Z')), {year:2026,month:7,day:31});
// tgl 7 17:00 UTC = tgl 8 WIB -> pindah ke W2
eq('batas W1->W2 tepat tengah malam WIB',
   weekOfMonth(jakartaToday(at('2026-08-07T17:00:00Z')).day), 2);
eq('masih W1 sebelum tengah malam WIB',
   weekOfMonth(jakartaToday(at('2026-08-07T16:59:00Z')).day), 1);

console.log('--- pergantian minggu berikutnya ---');
eq('dari W2 -> W3 mulai tgl 15', nextWeekChange(mk(2026,8,true), at('2026-08-09T05:00:00Z')), {week:3,day:15});
eq('di W4 tidak ada lagi',       nextWeekChange(mk(2026,8,true), at('2026-08-27T05:00:00Z')), null);

console.log();
console.log(fail === 0 ? `✓ LULUS — ${pass} pemeriksaan` : `✗ GAGAL — ${fail} dari ${pass+fail}`);
process.exit(fail === 0 ? 0 : 1);
