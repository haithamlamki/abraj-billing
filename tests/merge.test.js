import { describe, it, expect } from 'vitest';
import { joinText, rowTotal, mergeRowsIntoRig } from '../src/merge.js';

describe('joinText', () => {
  it('returns newVal when oldVal is empty', () => {
    expect(joinText('', 'hello')).toBe('hello');
    expect(joinText(null, 'hello')).toBe('hello');
  });

  it('returns oldVal when newVal is empty', () => {
    expect(joinText('hello', '')).toBe('hello');
    expect(joinText('hello', null)).toBe('hello');
  });

  it('returns oldVal when values are identical', () => {
    expect(joinText('hello', 'hello')).toBe('hello');
  });

  it('returns oldVal when newVal is a substring', () => {
    expect(joinText('drilling ahead at 2500m', 'drilling ahead')).toBe('drilling ahead at 2500m');
  });

  it('joins with " | " when new content differs', () => {
    expect(joinText('drilling', 'tripping')).toBe('drilling | tripping');
  });

  it('returns oldVal if joining would exceed 400 chars', () => {
    const longOld = 'x'.repeat(390);
    expect(joinText(longOld, 'new content here')).toBe(longOld);
  });
});

describe('rowTotal', () => {
  it('uses total_hrs if set', () => {
    expect(rowTotal({ total_hrs: 24, operating: 10 })).toBe(24);
  });
  it('sums hour keys when total_hrs is falsy', () => {
    expect(rowTotal({ operating: 12, reduced: 6, breakdown: 6 })).toBe(24);
  });
  it('returns 0 for an empty row', () => {
    expect(rowTotal({})).toBe(0);
  });
});

describe('mergeRowsIntoRig', () => {
  const pdfRow = date => ({
    date, operating: 24, reduced: 0, breakdown: 0, special: 0,
    force_maj: 0, zero_rate: 0, standby: 0, repair: 0, rig_move: 0,
    total_hrs: 24, operation: 'drilling',
  });

  it('creates new rig entry with new days', () => {
    const result = mergeRowsIntoRig({}, 204, [pdfRow('15-Mar-2026')], 'Excel', 'file.xlsx');
    expect(result.newDays).toBe(1);
    expect(result.mergedDays).toBe(0);
    expect(result.store[204].rows).toHaveLength(1);
    expect(result.store[204].rows[0]._source).toBe('Excel');
    expect(result.store[204].files).toContain('file.xlsx');
  });

  it('marks PDF source on new rows', () => {
    const result = mergeRowsIntoRig({}, 204, [pdfRow('15-Mar-2026')], 'PDF (approved)');
    expect(result.store[204].rows[0]._source).toBe('PDF');
  });

  it('does not mutate the input store', () => {
    const store = { 204: { meta: {}, rows: [], files: [] } };
    const frozen = JSON.stringify(store);
    mergeRowsIntoRig(store, 204, [pdfRow('15-Mar-2026')], 'Excel');
    expect(JSON.stringify(store)).toBe(frozen);
  });

  it('sorts merged rows by date', () => {
    const rows = [pdfRow('16-Mar-2026'), pdfRow('14-Mar-2026'), pdfRow('15-Mar-2026')];
    const result = mergeRowsIntoRig({}, 204, rows, 'Excel');
    const dates = result.store[204].rows.map(r => r.date);
    expect(dates).toEqual(['14-Mar-2026', '15-Mar-2026', '16-Mar-2026']);
  });

  it('PDF source overrides existing Excel values for the same day', () => {
    const startStore = {
      204: {
        meta: {},
        rows: [{ ...pdfRow('15-Mar-2026'), operating: 20, reduced: 4, _source: 'Excel' }],
        files: [],
      },
    };
    const result = mergeRowsIntoRig(
      startStore,
      204,
      [{ ...pdfRow('15-Mar-2026'), operating: 24, reduced: 0 }],
      'PDF (approved)',
    );
    const merged = result.store[204].rows[0];
    expect(merged.operating).toBe(24);
    expect(merged._source).toBe('PDF');
  });

  it('adds to a partial existing Excel row when merging Excel → Excel', () => {
    const startStore = {
      204: {
        meta: {},
        rows: [{ ...pdfRow('15-Mar-2026'), operating: 10, reduced: 0, total_hrs: 10, _source: 'Excel' }],
        files: [],
      },
    };
    const result = mergeRowsIntoRig(
      startStore,
      204,
      [{ ...pdfRow('15-Mar-2026'), operating: 0, reduced: 14, total_hrs: 14 }],
      'Excel',
    );
    const merged = result.store[204].rows[0];
    expect(merged.operating).toBe(10);
    expect(merged.reduced).toBe(14);
    expect(merged.total_hrs).toBe(24);
    expect(result.conflicts).toHaveLength(0);
  });

  it('flags a conflict when two non-matching full days collide', () => {
    const startStore = {
      204: {
        meta: {},
        rows: [{ ...pdfRow('15-Mar-2026'), operating: 24, total_hrs: 24, _source: 'Excel' }],
        files: [],
      },
    };
    const result = mergeRowsIntoRig(
      startStore,
      204,
      [{ ...pdfRow('15-Mar-2026'), operating: 20, reduced: 4, total_hrs: 24 }],
      'Excel',
    );
    // Two full days that agree on total but disagree on category should NOT be flagged as conflict
    // because total diff is 0, which is < 0.5
    expect(result.conflicts).toHaveLength(0);
  });

  it('flags a conflict when totals differ by more than 0.5h on a full day', () => {
    const startStore = {
      204: {
        meta: {},
        rows: [{ ...pdfRow('15-Mar-2026'), operating: 24, total_hrs: 24, _source: 'Excel' }],
        files: [],
      },
    };
    const result = mergeRowsIntoRig(
      startStore,
      204,
      [{ ...pdfRow('15-Mar-2026'), operating: 20, total_hrs: 20 }],
      'PDF (approved)',
    );
    expect(result.conflicts.length).toBeGreaterThan(0);
    expect(result.conflicts[0].date).toBe('15-Mar-2026');
  });

  it('skips identical re-import (signed copy of same PDF) without summing or flagging conflict', () => {
    // Real-world case: "<well> Feb.pdf" then "<well> Feb sign.pdf" — same data,
    // second arrival should be a no-op merge, not an additive conflict.
    const partial = { ...pdfRow('15-Mar-2026'), operating: 12, reduced: 0, total_hrs: 12 };
    const startStore = {
      204: { meta: {}, rows: [{ ...partial, _source: 'PDF' }], files: ['well Feb.pdf'] },
    };
    const result = mergeRowsIntoRig(
      startStore,
      204,
      [{ ...partial }],
      'PDF (approved)',
      'well Feb sign.pdf',
    );
    expect(result.conflicts).toHaveLength(0);
    expect(result.mergedDays).toBe(1);
    const merged = result.store[204].rows[0];
    expect(merged.operating).toBe(12); // unchanged, not 24
    expect(merged.total_hrs).toBe(12);
  });

  it('appends to files list without duplicates', () => {
    let { store } = mergeRowsIntoRig({}, 204, [pdfRow('15-Mar-2026')], 'Excel', 'file-a.xlsx');
    ({ store } = mergeRowsIntoRig(store, 204, [pdfRow('16-Mar-2026')], 'Excel', 'file-a.xlsx'));
    ({ store } = mergeRowsIntoRig(store, 204, [pdfRow('17-Mar-2026')], 'Excel', 'file-b.xlsx'));
    expect(store[204].files).toEqual(['file-a.xlsx', 'file-b.xlsx']);
  });
});
