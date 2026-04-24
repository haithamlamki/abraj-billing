import * as XLSX from 'xlsx';
import { writeFileSync, mkdirSync } from 'node:fs';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const CUSTOMER_BY_RIG = {
  104: 'PDO', 105: 'Medco', 106: 'PDO', 107: 'PDO', 108: 'PDO', 109: 'PDO',
  110: 'OQ', 111: 'OQ', 112: 'OQ',
  201: 'PDO', 202: 'PDO', 203: 'PDO', 204: 'ARA', 205: 'OQ',
  206: 'OXY', 207: 'OXY', 208: 'OXY', 209: 'OXY',
  210: 'PDO', 211: 'PDO',
  302: 'PDO', 303: 'PDO', 304: 'PDO', 305: 'BP',
};

function makeSheet({ rig, month, year }) {
  const customer = CUSTOMER_BY_RIG[rig] || 'PDO';
  const monthName = MONTHS[month - 1];
  const daysInMonth = new Date(year, month, 0).getDate();

  const rows = [
    [`Abraj Energy — ${customer} Monthly Billing`],
    ['Rig', String(rig)],
    ['Well:', `RIG-${rig}-WELL`, '', 'Contract No:', `C-${rig}`, 'P.O:', `PO-${rig}`],
    [],
    ['Date', 'Operating', 'Reduced', 'Breakdown', 'Special',
      'Force Maj', 'Zero Rate', 'Standby', 'Repair', 'Rig Move',
      'Total Hrs', 'OBM Oper', 'OBM Red', 'OBM BD', 'OBM Spe', 'OBM Zero',
      'Operation', 'Hours Repair', 'Remarks'],
  ];

  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${String(d).padStart(2, '0')}-${monthName}-${year}`;
    if (d === 10) {
      rows.push([date, 12, 6, 6, 0, 0, 0, 0, 0, 0, 24, 0, 0, 0, 0, 0, 'Tripping out of hole', 0, '']);
    } else if (d === 20) {
      rows.push([date, 10, 4, 4, 0, 0, 0, 0, 0, 0, 18, 0, 0, 0, 0, 0, 'Waiting on cement', 0, 'partial']);
    } else if (d === 25) {
      rows.push([date, 0, 0, 0, 0, 0, 0, 0, 0, 24, 24, 0, 0, 0, 0, 0, 'Rig move to next well', 0, '']);
    } else {
      rows.push([date, 24, 0, 0, 0, 0, 0, 0, 0, 0, 24, 0, 0, 0, 0, 0, 'Drilling 12.25" hole section', 0, '']);
    }
  }
  rows.push(['Total', '', '', '', '', '', '', '', '', '', '']);
  rows.push(['Client signature', '', '', '', '']);
  return rows;
}

function writeFixture({ rig, month = 3, year = 2026, outDir = 'fixtures', filename }) {
  const monthName = MONTHS[month - 1];
  const name = filename || `${rig}_${monthName}_${year}.xlsx`;
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(makeSheet({ rig, month, year }), { cellDates: true });
  XLSX.utils.book_append_sheet(wb, ws, 'Billing');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true });
  mkdirSync(outDir, { recursive: true });
  const path = `${outDir}/${name}`;
  writeFileSync(path, buf);
  return { path, size: buf.length };
}

// CLI: node scripts/make-fixture.js [rig] [month] [year]
// Also preserves backward-compat: no args → 204_March_2026.xlsx
const [rigArg, monthArg, yearArg] = process.argv.slice(2);
if (rigArg) {
  const rig = parseInt(rigArg);
  const month = monthArg ? parseInt(monthArg) : 3;
  const year = yearArg ? parseInt(yearArg) : 2026;
  const { path, size } = writeFixture({ rig, month, year });
  console.log(`Wrote ${path} (${size} bytes)`);
} else {
  const { path, size } = writeFixture({ rig: 204, month: 3, year: 2026, filename: '204_March_2026.xlsx' });
  console.log(`Wrote ${path} (${size} bytes)`);
}

export { writeFixture };
