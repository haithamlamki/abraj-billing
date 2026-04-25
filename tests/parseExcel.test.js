import { describe, it, expect, vi } from 'vitest';
import {
  parseExcelBuffer, looksLikeBillingSheet, EXCLUDED_SHEET_NAME_PATTERN,
} from '../src/pipeline/parseExcel.js';

// A real billing-table header row that findHeaderRow will recognise.
const HEADER_ROW = ['Date', 'Operating', 'Reduced', 'Breakdown', 'Total Hrs'];

function billingSheet(extraRows = 5) {
  const rows = [HEADER_ROW];
  for (let d = 1; d <= extraRows; d++) {
    rows.push([`${String(d).padStart(2, '0')}-Mar-2026`, 24, 0, 0, 24]);
  }
  return { formatted: rows, raw: rows };
}

describe('EXCLUDED_SHEET_NAME_PATTERN', () => {
  it('matches the ancillary sheet names we always skip', () => {
    expect('Diesel Log').toMatch(EXCLUDED_SHEET_NAME_PATTERN);
    expect('Discount Sheet').toMatch(EXCLUDED_SHEET_NAME_PATTERN);
    expect('Ticket Summary').toMatch(EXCLUDED_SHEET_NAME_PATTERN);
    expect('Fuel Reconciliation').toMatch(EXCLUDED_SHEET_NAME_PATTERN);
    expect('4% Royalty').toMatch(EXCLUDED_SHEET_NAME_PATTERN);
  });

  it('does NOT match real billing sheet names', () => {
    expect('Sheet1').not.toMatch(EXCLUDED_SHEET_NAME_PATTERN);
    expect('Billing').not.toMatch(EXCLUDED_SHEET_NAME_PATTERN);
    expect('Rig 204').not.toMatch(EXCLUDED_SHEET_NAME_PATTERN);
    expect('March').not.toMatch(EXCLUDED_SHEET_NAME_PATTERN);
  });
});

describe('looksLikeBillingSheet', () => {
  it('accepts a sheet with a recognisable header', () => {
    expect(looksLikeBillingSheet(billingSheet(2))).toBe(true);
  });

  it('accepts a sheet with no header but enough rows (boilerplate fallback)', () => {
    const rows = Array.from({ length: 10 }, () => ['x', 'y', 'z']);
    expect(looksLikeBillingSheet({ formatted: rows, raw: rows })).toBe(true);
  });

  it('rejects a tiny sheet with no header', () => {
    const rows = [['Notes'], ['One line']];
    expect(looksLikeBillingSheet({ formatted: rows, raw: rows })).toBe(false);
  });

  it('falls back to raw when formatted is empty', () => {
    expect(looksLikeBillingSheet({ formatted: [], raw: [HEADER_ROW, ['01', 24]] })).toBe(true);
  });
});

describe('parseExcelBuffer', () => {
  /** Build a stub of just the XLSX surface area parseExcelBuffer touches. */
  function stubXLSX(sheetsByName) {
    return {
      read() {
        return {
          SheetNames: Object.keys(sheetsByName),
          Sheets: Object.fromEntries(
            Object.entries(sheetsByName).map(([n, rows]) => [n, { __rows: rows }]),
          ),
        };
      },
      utils: {
        sheet_to_json(sheet) { return sheet.__rows; },
      },
    };
  }

  it('keeps real billing sheets and skips ancillary ones', () => {
    const XLSX = stubXLSX({
      'Billing': billingSheet(28).formatted,
      'Diesel': [['Diesel Log']],
      'Discount': [['Discount']],
    });
    const result = parseExcelBuffer(new ArrayBuffer(0), { XLSX });
    expect(result.billingSheetNames).toEqual(['Billing']);
    expect(result.skippedByName.sort()).toEqual(['Diesel', 'Discount']);
    expect(result.sheets['Billing']).toBeDefined();
  });

  it('drops sheets that look like boilerplate (no header, < 6 rows)', () => {
    const XLSX = stubXLSX({
      'Cover': [['Abraj Energy'], ['Monthly Report']],
      'Billing': billingSheet(28).formatted,
    });
    const result = parseExcelBuffer(new ArrayBuffer(0), { XLSX });
    expect(result.billingSheetNames).toEqual(['Billing']);
    expect(result.skippedAsBoilerplate).toEqual(['Cover']);
  });

  it('returns empty arrays when the workbook has no usable sheets', () => {
    const XLSX = stubXLSX({
      'Diesel': [['Diesel Log']],
      'Notes': [['Memo']],
    });
    const result = parseExcelBuffer(new ArrayBuffer(0), { XLSX });
    expect(result.billingSheetNames).toEqual([]);
    expect(result.skippedByName).toContain('Diesel');
    expect(result.skippedAsBoilerplate).toContain('Notes');
  });

  it('logs each boilerplate skip', () => {
    const XLSX = stubXLSX({
      'Cover': [['x']],
      'Billing': billingSheet(28).formatted,
    });
    const log = vi.fn();
    parseExcelBuffer(new ArrayBuffer(0), { XLSX, log });
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/Skipping sheet "Cover"/), 'info');
  });

  it('preserves both formatted and raw shapes per sheet', () => {
    const XLSX = stubXLSX({ 'Billing': billingSheet(2).formatted });
    const result = parseExcelBuffer(new ArrayBuffer(0), { XLSX });
    const sheet = result.sheets['Billing'];
    expect(sheet).toHaveProperty('formatted');
    expect(sheet).toHaveProperty('raw');
    expect(Array.isArray(sheet.formatted)).toBe(true);
    expect(Array.isArray(sheet.raw)).toBe(true);
  });
});
