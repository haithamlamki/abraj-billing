import * as XLSX from 'xlsx';
import { writeFileSync, mkdirSync } from 'node:fs';

mkdirSync('fixtures', { recursive: true });

// A fixture with NO rig prefix in the filename AND no header row recognizable
// → triggers: rig not detected, header row not detected, no valid daily rows.
function brokenSheet() {
  return [
    ['Some random header row'],
    ['Garbled', 'data', 'no date', 'no operating'],
    ['more', 'gibberish'],
    ['foo', 'bar', 'baz'],
  ];
}

const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet(brokenSheet(), { cellDates: true });
XLSX.utils.book_append_sheet(wb, ws, 'Billing');
const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
writeFileSync('fixtures/broken_no_header.xlsx', buf);
console.log(`Wrote fixtures/broken_no_header.xlsx (${buf.length} bytes)`);

// Fixture with duplicate dates → triggers the duplicates issue
function duplicateDatesSheet() {
  return [
    ['Abraj Energy — PDO Monthly Billing'],
    ['Rig', '999'],  // deliberately not in RIGS list
    [],
    ['Date', 'Operating', 'Reduced', 'Breakdown', 'Total Hrs', 'Operation'],
    ['15-Mar-2026', 24, 0, 0, 24, 'Drilling'],
    ['15-Mar-2026', 12, 12, 0, 24, 'Duplicate date'],  // same date again
    ['16-Mar-2026', 24, 0, 0, 24, 'Drilling'],
    ['Total', '', '', '', 72],
  ];
}

const wb2 = XLSX.utils.book_new();
const ws2 = XLSX.utils.aoa_to_sheet(duplicateDatesSheet());
XLSX.utils.book_append_sheet(wb2, ws2, 'Billing');
const buf2 = XLSX.write(wb2, { type: 'buffer', bookType: 'xlsx' });
// Filename prefix routes to rig 204; duplicates + low confidence trigger review card
writeFileSync('fixtures/204_dup_dates.xlsx', buf2);
console.log(`Wrote fixtures/204_dup_dates.xlsx (${buf2.length} bytes)`);
