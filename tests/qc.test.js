import { describe, it, expect } from 'vitest';
import {
  getDayMap,
  normalizeExtractedData,
  buildQCModel,
  generateExecutiveSummary,
  computeExtractionConfidence,
  issueAction,
} from '../src/qc.js';

const BILLING_YEAR = 2026;
const BILLING_MONTH = 3;

function makeRow(date, overrides = {}) {
  return {
    date,
    operating: 24, reduced: 0, breakdown: 0, special: 0, force_maj: 0,
    zero_rate: 0, standby: 0, repair: 0, rig_move: 0,
    total_hrs: 24,
    operation: '', remarks: '',
    ...overrides,
  };
}

function makeStore(rigRows) {
  const store = {};
  for (const [rig, rows] of Object.entries(rigRows)) {
    store[rig] = { meta: { customer: 'PDO' }, rows, files: ['test.xlsx'] };
  }
  return store;
}

describe('issueAction', () => {
  it('returns a non-empty action for each known issue', () => {
    expect(issueAction('Missing Full Day')).toMatch(/request/i);
    expect(issueAction('Partial Submission')).toMatch(/verify|complete/i);
    expect(issueAction('Over 24 Hours')).toMatch(/duplicate|mapping/i);
    expect(issueAction('Duplicate Date')).toMatch(/duplicate/i);
    expect(issueAction('Invalid Date')).toMatch(/correct/i);
  });
  it('falls back to "Review" for unknown issues', () => {
    expect(issueAction('Something Else')).toBe('Review');
  });
});

describe('getDayMap', () => {
  it('maps rows by day number and filters out wrong-month rows', () => {
    const store = {
      rows: [
        makeRow('15-Mar-2026'),
        makeRow('16-Mar-2026'),
        makeRow('15-Feb-2026'),
      ],
    };
    const { map, duplicates, invalid } = getDayMap(store, BILLING_YEAR, BILLING_MONTH);
    expect(Object.keys(map).sort()).toEqual(['15', '16']);
    expect(invalid).toHaveLength(1);
    expect(invalid[0].date).toBe('15-Feb-2026');
    expect(duplicates).toHaveLength(0);
  });

  it('detects duplicate entries for the same day', () => {
    const store = {
      rows: [makeRow('15-Mar-2026'), makeRow('15-Mar-2026', { operating: 12 })],
    };
    const { duplicates } = getDayMap(store, BILLING_YEAR, BILLING_MONTH);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].day).toBe(15);
    expect(duplicates[0].rows).toHaveLength(2);
  });

  it('returns empty results for missing store', () => {
    expect(getDayMap(null, BILLING_YEAR, BILLING_MONTH)).toEqual({
      map: {}, duplicates: [], invalid: [],
    });
    expect(getDayMap({ rows: [] }, BILLING_YEAR, BILLING_MONTH).map).toEqual({});
  });

  it('flags unparseable dates as invalid', () => {
    const store = { rows: [makeRow('not-a-date')] };
    const { invalid } = getDayMap(store, BILLING_YEAR, BILLING_MONTH);
    expect(invalid).toHaveLength(1);
  });
});

describe('normalizeExtractedData', () => {
  it('injects rig, customer and defaults into each row', () => {
    const store = makeStore({ 204: [makeRow('15-Mar-2026')] });
    const records = normalizeExtractedData(store, [204]);
    expect(records).toHaveLength(1);
    expect(records[0].rig).toBe(204);
    expect(records[0].customer).toBe('PDO');
    expect(records[0].qc_status).toBe('Complete');
    expect(records[0].missing_hrs).toBe(0);
    expect(records[0].day).toBe(15);
  });

  it('marks rows with 0 total as Missing', () => {
    const row = makeRow('15-Mar-2026', {
      operating: 0, total_hrs: 0,
    });
    const store = makeStore({ 204: [row] });
    const [rec] = normalizeExtractedData(store, [204]);
    expect(rec.qc_status).toBe('Missing');
    expect(rec.missing_hrs).toBe(24);
  });

  it('marks partial rows correctly', () => {
    const row = makeRow('15-Mar-2026', { operating: 12, total_hrs: 12 });
    const store = makeStore({ 204: [row] });
    const [rec] = normalizeExtractedData(store, [204]);
    expect(rec.qc_status).toBe('Partial');
    expect(rec.missing_hrs).toBe(12);
  });

  it('sorts across rigs then by date', () => {
    const store = makeStore({
      204: [makeRow('16-Mar-2026'), makeRow('15-Mar-2026')],
      103: [makeRow('15-Mar-2026')],
    });
    const records = normalizeExtractedData(store, [204, 103]);
    expect(records.map(r => [r.rig, r.date])).toEqual([
      [103, '15-Mar-2026'],
      [204, '15-Mar-2026'],
      [204, '16-Mar-2026'],
    ]);
  });

  it('skips rigs with no rows', () => {
    const store = { 204: { meta: { customer: 'PDO' }, rows: [], files: [] } };
    expect(normalizeExtractedData(store, [204])).toEqual([]);
  });
});

describe('buildQCModel', () => {
  it('counts a fully submitted rig as Complete', () => {
    const rows = [];
    for (let d = 1; d <= 31; d++) {
      rows.push(makeRow(`${String(d).padStart(2, '0')}-Mar-2026`));
    }
    const store = makeStore({ 204: rows });
    const qc = buildQCModel(store, BILLING_YEAR, BILLING_MONTH, [204]);
    expect(qc.daysInMonth).toBe(31);
    expect(qc.rigSummaries).toHaveLength(1);
    expect(qc.rigSummaries[0].status).toBe('Complete');
    expect(qc.fullRigs).toBe(1);
    expect(qc.reviewRigs).toBe(0);
    expect(qc.exceptions).toEqual([]);
  });

  it('flags missing days as critical exceptions', () => {
    const store = makeStore({ 204: [makeRow('15-Mar-2026')] });
    const qc = buildQCModel(store, BILLING_YEAR, BILLING_MONTH, [204]);
    const missingExceptions = qc.exceptions.filter(e => e.issue === 'Missing Full Day');
    expect(missingExceptions).toHaveLength(30);
    expect(qc.rigSummaries[0].status).toBe('Missing Days');
    expect(qc.rigSummaries[0].missingDays).toBe(30);
  });

  it('flags partial days with warning severity', () => {
    const rows = [];
    for (let d = 1; d <= 31; d++) {
      const date = `${String(d).padStart(2, '0')}-Mar-2026`;
      rows.push(d === 15
        ? makeRow(date, { operating: 12, total_hrs: 12 })
        : makeRow(date));
    }
    const store = makeStore({ 204: rows });
    const qc = buildQCModel(store, BILLING_YEAR, BILLING_MONTH, [204]);
    const partials = qc.exceptions.filter(e => e.issue === 'Partial Submission');
    expect(partials).toHaveLength(1);
    expect(partials[0].severity).toBe('warning');
    expect(partials[0].missing).toBe(12);
    expect(qc.rigSummaries[0].status).toBe('Partial');
  });

  it('flags over-24h days as critical', () => {
    const rows = [];
    for (let d = 1; d <= 31; d++) {
      const date = `${String(d).padStart(2, '0')}-Mar-2026`;
      rows.push(d === 15
        ? makeRow(date, { operating: 26, total_hrs: 26 })
        : makeRow(date));
    }
    const store = makeStore({ 204: rows });
    const qc = buildQCModel(store, BILLING_YEAR, BILLING_MONTH, [204]);
    const overs = qc.exceptions.filter(e => e.issue === 'Over 24 Hours');
    expect(overs).toHaveLength(1);
    expect(overs[0].severity).toBe('critical');
    expect(qc.rigSummaries[0].status).toBe('Over 24h');
  });

  it('computes fleet completion', () => {
    const rows = [];
    for (let d = 1; d <= 31; d++) rows.push(makeRow(`${String(d).padStart(2, '0')}-Mar-2026`));
    const store = makeStore({ 204: rows });
    const qc = buildQCModel(store, BILLING_YEAR, BILLING_MONTH, [204]);
    expect(qc.expectedHours).toBe(31 * 24);
    expect(qc.submittedHours).toBe(31 * 24);
    expect(qc.completion).toBe(100);
  });

  it('respects a custom rigs list', () => {
    const store = makeStore({ 204: [makeRow('15-Mar-2026')] });
    const qc = buildQCModel(store, BILLING_YEAR, BILLING_MONTH, [204, 205]);
    expect(qc.rigSummaries).toHaveLength(2);
    expect(qc.expectedHours).toBe(2 * 31 * 24);
  });
});

describe('generateExecutiveSummary', () => {
  it('returns a summary shape mirroring buildQCModel', () => {
    const store = makeStore({ 204: [makeRow('15-Mar-2026')] });
    const summary = generateExecutiveSummary(store, BILLING_YEAR, BILLING_MONTH, [204]);
    expect(summary.records).toHaveLength(1);
    expect(summary.rigRows).toHaveLength(1);
    expect(summary.rigRows[0].rig).toBe(204);
    expect(summary.qc.daysInMonth).toBe(31);
  });
});

describe('computeExtractionConfidence', () => {
  const fullRow = makeRow('15-Mar-2026');

  it('auto-accepts a clean extraction', () => {
    const conf = computeExtractionConfidence({
      rigNum: 204,
      headerRow: 3,
      map: { date: 0, operating: 1, total_hrs: 5 },
      rows: Array.from({ length: 31 }, () => fullRow),
      daysInMonth: 31,
    });
    expect(conf.status).toBe('Auto Accepted');
    expect(conf.score).toBeGreaterThanOrEqual(90);
    expect(conf.issues).toEqual([]);
  });

  it('reduces score for missing rig', () => {
    const conf = computeExtractionConfidence({
      rigNum: null,
      headerRow: 3,
      map: { date: 0, operating: 1 },
      rows: [fullRow],
      daysInMonth: 31,
    });
    expect(conf.issues).toContain('rig not detected');
    expect(conf.score).toBeLessThan(90);
  });

  it('lists over-24h and invalid dates', () => {
    const conf = computeExtractionConfidence({
      rigNum: 204,
      headerRow: 3,
      map: { date: 0, operating: 1 },
      rows: [
        makeRow('15-Mar-2026', { total_hrs: 26, operating: 26 }),
        makeRow('not-a-date'),
      ],
      daysInMonth: 31,
    });
    expect(conf.issues.some(i => i.includes('over-24h'))).toBe(true);
    expect(conf.issues.some(i => i.includes('invalid date'))).toBe(true);
  });

  it('clamps score to 0 minimum', () => {
    const conf = computeExtractionConfidence({
      rigNum: null,
      headerRow: -1,
      map: {},
      rows: [],
      daysInMonth: 31,
    });
    expect(conf.score).toBe(0);
    expect(conf.status).toBe('Manual Review Required');
  });
});
