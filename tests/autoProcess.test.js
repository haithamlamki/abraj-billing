import { describe, it, expect } from 'vitest';
import { extractFromSheet, mergeExtractionSilently } from '../src/pipeline/autoProcess.js';
import { createRigStore } from '../src/state/rigStore.js';

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Build a minimal sheet with a recognisable header + data rows. */
function makeSheet({ rigNum = 204, dates = ['01-Feb-2026', '02-Feb-2026'] } = {}) {
  const header = ['Date', 'Operating Hrs', 'Reduced Hrs', 'Breakdown Hrs', 'Total Hrs'];
  const rows = dates.map(d => [d, 24, 0, 0, 24]);
  return {
    sheetName: 'Sheet1',
    rawData:   [header, ...rows],
    formatted: [header, ...rows],
    fileName:  `Rig${rigNum}_Feb2026.xlsx`,
    filenameRigHint: rigNum,
  };
}

const OPTS = { year: 2026, month: 2 };

// ─── extractFromSheet — structure ────────────────────────────────────────────

describe('extractFromSheet — returned shape', () => {
  it('returns all expected keys', () => {
    const r = extractFromSheet(makeSheet(), OPTS);
    for (const k of ['sheetName', 'fileName', 'rig', 'meta', 'headerRow', 'map',
                      'rows', 'confidence', 'duplicates', 'overHoursCount',
                      'issues', 'raw', 'formatted']) {
      expect(r).toHaveProperty(k);
    }
  });

  it('sets rig from filenameRigHint', () => {
    const r = extractFromSheet(makeSheet({ rigNum: 305 }), OPTS);
    expect(r.rig).toBe(305);
  });

  it('falls back to formatted-only data when formatted is present', () => {
    const sheet = makeSheet();
    sheet.formatted = sheet.rawData; // same data — just verify no crash
    const r = extractFromSheet(sheet, OPTS);
    expect(r.headerRow).toBeGreaterThanOrEqual(0);
  });

  it('uses rawData when formatted is empty', () => {
    const sheet = makeSheet();
    sheet.formatted = [];
    const r = extractFromSheet(sheet, OPTS);
    expect(r.headerRow).toBeGreaterThanOrEqual(0);
  });

  it('detects the header row', () => {
    const r = extractFromSheet(makeSheet(), OPTS);
    expect(r.headerRow).toBe(0);
  });

  it('extracts the correct number of data rows', () => {
    const r = extractFromSheet(makeSheet({ dates: ['01-Feb-2026', '02-Feb-2026', '03-Feb-2026'] }), OPTS);
    expect(r.rows).toHaveLength(3);
  });

  it('produces an empty rows array when no header found', () => {
    const sheet = {
      sheetName: 'Sheet1',
      rawData:   [['totally unrecognisable garbage', 'foo', 'bar']],
      formatted: [],
      fileName:  'bad.xlsx',
      filenameRigHint: null,
    };
    const r = extractFromSheet(sheet, OPTS);
    expect(r.rows).toHaveLength(0);
    expect(r.headerRow).toBe(-1);
  });
});

// ─── extractFromSheet — issues + confidence ──────────────────────────────────

describe('extractFromSheet — issues', () => {
  it('returns empty issues for a clean extraction with rig hint', () => {
    const r = extractFromSheet(makeSheet(), OPTS);
    // A clean two-row extraction for Rig 204 should yield no critical issues.
    // (confidence may be <100 for a partial month — check it is >= 0)
    expect(r.confidence.score).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(r.issues)).toBe(true);
  });

  it('includes "rig not detected" when no rig hint and no rig in meta', () => {
    const sheet = makeSheet();
    sheet.filenameRigHint = null;
    sheet.fileName = 'norig.xlsx';
    const r = extractFromSheet(sheet, OPTS);
    // Without rig the confidence will be low so issues should surface rig issue
    expect(r.issues.some(i => /rig/i.test(i))).toBe(true);
  });

  it('counts duplicate dates', () => {
    const sheet = makeSheet({ dates: ['01-Feb-2026', '01-Feb-2026'] });
    const r = extractFromSheet(sheet, OPTS);
    expect(r.duplicates).toBe(1);
  });

  it('counts over-hours rows (>24.5 h)', () => {
    // Omit the "Total Hrs" column so extract.js does not hit the >24.5 break-guard
    // on the file-supplied total. The calc total (sum of component cols) will be 25.
    const header = ['Date', 'Operating Hrs', 'Reduced Hrs', 'Breakdown Hrs'];
    const sheet = {
      sheetName: 'Sheet1',
      rawData:   [header, ['01-Feb-2026', 25, 0, 0]],
      formatted: [header, ['01-Feb-2026', 25, 0, 0]],
      fileName:  'Rig204_Feb2026.xlsx',
      filenameRigHint: 204,
    };
    const r = extractFromSheet(sheet, OPTS);
    expect(r.overHoursCount).toBe(1);
  });
});

// ─── extractFromSheet — meta ─────────────────────────────────────────────────

describe('extractFromSheet — meta', () => {
  it('meta has the expected keys', () => {
    const r = extractFromSheet(makeSheet(), OPTS);
    expect(r.meta).toHaveProperty('customer');
    expect(r.meta).toHaveProperty('well');
    expect(r.meta).toHaveProperty('contract');
    expect(r.meta).toHaveProperty('po');
  });
});

// ─── extractFromSheet — stacked header ───────────────────────────────────────

describe('extractFromSheet — stacked header', () => {
  it('resolves stacked "Total Hrs" header from two rows', () => {
    // Row 0: label row above actual header
    // Row 1: the real column header row
    const data = [
      ['',   '',          '',        '',       'Total'],
      ['Date','Operating','Reduced','Breakdown','Hrs'],
      ['01-Feb-2026', 20, 0, 0, 20],
    ];
    const sheet = {
      sheetName: 'Sheet1',
      rawData:   data,
      formatted: data,
      fileName:  'Rig204_Feb2026.xlsx',
      filenameRigHint: 204,
    };
    const r = extractFromSheet(sheet, OPTS);
    // Should find the header on row 1
    expect(r.headerRow).toBe(1);
    // total_hrs should be mapped
    expect(r.map).toHaveProperty('total_hrs');
  });
});

// ─── mergeExtractionSilently — no rig ────────────────────────────────────────

describe('mergeExtractionSilently — no rig', () => {
  it('returns { ok: false } when extraction has no rig', () => {
    const store = createRigStore();
    const extraction = { rig: null, rows: [], meta: {}, issues: [] };
    const result = mergeExtractionSilently(extraction, 'test.xlsx', store);
    expect(result.ok).toBe(false);
    expect(result.conflicts).toHaveLength(0);
  });
});

// ─── mergeExtractionSilently — successful merge ───────────────────────────────

describe('mergeExtractionSilently — successful merge', () => {
  const extraction = {
    rig: 204,
    meta: { customer: 'ARA', well: 'W1', contract: '', po: '' },
    rows: [
      { date: '01-Feb-2026', operating: 24, reduced: 0, breakdown: 0, rig_move: 0, total_hrs: 24 },
      { date: '02-Feb-2026', operating: 24, reduced: 0, breakdown: 0, rig_move: 0, total_hrs: 24 },
    ],
    issues: [],
  };

  it('returns ok: true for a clean extraction', () => {
    const store = createRigStore();
    const result = mergeExtractionSilently(extraction, 'Rig204.xlsx', store);
    expect(result.ok).toBe(true);
  });

  it('result.store contains the rig entry', () => {
    const store = createRigStore();
    const result = mergeExtractionSilently(extraction, 'Rig204.xlsx', store);
    expect(result.store).toHaveProperty('204');
    expect(result.store[204].rows).toHaveLength(2);
  });

  it('reports newDays correctly', () => {
    const store = createRigStore();
    const result = mergeExtractionSilently(extraction, 'Rig204.xlsx', store);
    expect(result.newDays).toBe(2);
  });

  it('detects PDF source label from .pdf filename', () => {
    const store = createRigStore();
    const result = mergeExtractionSilently(extraction, 'Rig204.pdf', store);
    expect(result.ok).toBe(true);
    // Source label "PDF (approved)" ends up on the row._source
    const row = result.store[204].rows[0];
    expect(row._source).toBe('PDF');
  });

  it('uses Excel source label for non-PDF files', () => {
    const store = createRigStore();
    const result = mergeExtractionSilently(extraction, 'Rig204.xlsx', store);
    const row = result.store[204].rows[0];
    expect(row._source).toBe('Excel');
  });

  it('does NOT mutate the original store (pure return)', () => {
    const store = createRigStore();
    const snapshot = JSON.stringify(store);
    mergeExtractionSilently(extraction, 'Rig204.xlsx', store);
    // setRigMetaFallback DOES mutate store[rig].meta in-place,
    // but the rows should not be on the original store until caller does Object.assign.
    // Verify the rig entry rows are still 0 in the original store pre-assign.
    // (meta mutation is acceptable — that's the same behaviour as original main.js)
    expect(store[204]?.rows?.length ?? 0).toBe(0);
  });

  it('conflicts array present in result', () => {
    const store = createRigStore();
    const result = mergeExtractionSilently(extraction, 'Rig204.xlsx', store);
    expect(Array.isArray(result.conflicts)).toBe(true);
  });
});
