import { describe, it, expect } from 'vitest';
import { extractRows } from '../src/extract.js';

describe('extractRows', () => {
  const baseMap = {
    date: 0,
    operating: 1,
    reduced: 2,
    breakdown: 3,
    total_hrs: 4,
    operation: 5,
  };

  it('extracts all data rows between header and footer', () => {
    const rawData = [
      ['Date', 'Operating', 'Reduced', 'Breakdown', 'Total Hrs', 'Operation'],
      [new Date(Date.UTC(2026, 2, 15)), 24, 0, 0, 24, 'Drilling'],
      [new Date(Date.UTC(2026, 2, 16)), 20, 4, 0, 24, 'Tripping'],
      ['Total', '', '', '', 48],
    ];
    const { rows } = extractRows({
      rawData,
      formatted: rawData,
      headerRow: 0,
      map: baseMap,
      billingYear: 2026,
      billingMonth: 3,
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].date).toBe('15-Mar-2026');
    expect(rows[0].operating).toBe(24);
    expect(rows[1].date).toBe('16-Mar-2026');
    expect(rows[1].reduced).toBe(4);
  });

  it('recomputes total_hrs from category sums, not the file column', () => {
    // File says 18h total but categories actually sum to 20. Output should be 20.
    // (file totals > 24.5 are treated as a summary row and break extraction — tested separately)
    const rawData = [
      ['Date', 'Operating', 'Reduced', 'Breakdown', 'Total Hrs', 'Operation'],
      ['15-Mar-2026', 10, 5, 5, 18, ''],
    ];
    const { rows } = extractRows({
      rawData,
      formatted: rawData,
      headerRow: 0,
      map: baseMap,
      billingYear: 2026,
      billingMonth: 3,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].total_hrs).toBe(20);
  });

  it('breaks when the file total column reports > 24.5 (summary row detection)', () => {
    const rawData = [
      ['Date', 'Operating', 'Reduced', 'Breakdown', 'Total Hrs', 'Operation'],
      ['15-Mar-2026', 24, 0, 0, 24, 'Drilling'],
      ['16-Mar-2026', 0, 0, 0, 720, 'Month Summary'],
      ['17-Mar-2026', 24, 0, 0, 24, 'Drilling'],
    ];
    const { rows } = extractRows({
      rawData,
      formatted: rawData,
      headerRow: 0,
      map: baseMap,
      billingYear: 2026,
      billingMonth: 3,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].date).toBe('15-Mar-2026');
  });

  it('skips rows with an unparseable date', () => {
    const rawData = [
      ['Date', 'Operating', 'Reduced', 'Breakdown', 'Total Hrs', 'Operation'],
      ['15-Mar-2026', 24, 0, 0, 24, 'Drilling'],
      ['', 0, 0, 0, 0, ''],
      ['16-Mar-2026', 24, 0, 0, 24, 'Drilling'],
    ];
    const { rows } = extractRows({
      rawData,
      formatted: rawData,
      headerRow: 0,
      map: baseMap,
      billingYear: 2026,
      billingMonth: 3,
    });
    expect(rows.map(r => r.date)).toEqual(['15-Mar-2026', '16-Mar-2026']);
  });

  it('stops at a footer row ("Total")', () => {
    const rawData = [
      ['Date', 'Operating', 'Reduced', 'Breakdown', 'Total Hrs', 'Operation'],
      ['15-Mar-2026', 24, 0, 0, 24, 'Drilling'],
      ['Total', '', '', '', 24],
      ['16-Mar-2026', 24, 0, 0, 24, 'Drilling'],
    ];
    const { rows } = extractRows({
      rawData,
      formatted: rawData,
      headerRow: 0,
      map: baseMap,
      billingYear: 2026,
      billingMonth: 3,
    });
    expect(rows).toHaveLength(1);
  });

  it('falls back to formatted date when raw date is missing', () => {
    const raw = [
      ['Date', 'Operating', 'Reduced', 'Breakdown', 'Total Hrs', 'Operation'],
      [null, 24, 0, 0, 24, 'Drilling'],
    ];
    const formatted = [
      ['Date', 'Operating', 'Reduced', 'Breakdown', 'Total Hrs', 'Operation'],
      ['15-Mar-2026', 24, 0, 0, 24, 'Drilling'],
    ];
    const { rows } = extractRows({
      rawData: raw,
      formatted,
      headerRow: 0,
      map: baseMap,
      billingYear: 2026,
      billingMonth: 3,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].date).toBe('15-Mar-2026');
  });

  it('accepts day numbers 1-31 with the billing month/year context', () => {
    const rawData = [
      ['Date', 'Operating', 'Reduced', 'Breakdown', 'Total Hrs', 'Operation'],
      [5, 24, 0, 0, 24, 'Drilling'],
      [6, 12, 12, 0, 24, 'Drilling'],
    ];
    const { rows } = extractRows({
      rawData,
      formatted: rawData,
      headerRow: 0,
      map: baseMap,
      billingYear: 2026,
      billingMonth: 3,
    });
    expect(rows.map(r => r.date)).toEqual(['05-Mar-2026', '06-Mar-2026']);
  });
});
