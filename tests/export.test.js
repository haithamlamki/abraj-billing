import { describe, it, expect } from 'vitest';
import { buildAllRowsData, buildExceptionReportSheets, EXPORT_COL_WIDTHS } from '../src/pipeline/export.js';

// ─── fixtures ────────────────────────────────────────────────────────────────

function makeStore() {
  return {
    204: {
      meta: { customer: 'ARA', well: 'W1', contract: 'C1', po: 'P1' },
      rows: [
        { date: '01-Feb-2026', operating: 24, reduced: 0, breakdown: 0,
          special: 0, force_maj: 0, zero_rate: 0, standby: 0, repair: 0, rig_move: 0,
          total_hrs: 24, obm_oper: 0, obm_red: 0, obm_bd: 0, obm_spe: 0, obm_zero: 0,
          operation: '', total_hrs_repair: 0, remarks: '' },
        { date: '02-Feb-2026', operating: 20, reduced: 4, breakdown: 0,
          special: 0, force_maj: 0, zero_rate: 0, standby: 0, repair: 0, rig_move: 0,
          total_hrs: 24, obm_oper: 0, obm_red: 0, obm_bd: 0, obm_spe: 0, obm_zero: 0,
          operation: '', total_hrs_repair: 0, remarks: '' },
      ],
    },
    104: {
      meta: { customer: 'PDO', well: 'W2', contract: 'C2', po: 'P2' },
      rows: [
        { date: '01-Feb-2026', operating: 18, reduced: 0, breakdown: 6,
          special: 0, force_maj: 0, zero_rate: 0, standby: 0, repair: 0, rig_move: 0,
          total_hrs: 24, obm_oper: 0, obm_red: 0, obm_bd: 0, obm_spe: 0, obm_zero: 0,
          operation: '', total_hrs_repair: 0, remarks: 'note' },
      ],
    },
  };
}

function makeQCModel() {
  return {
    exceptions: [
      { rig: 104, customer: 'PDO', date: '05-Feb-2026', submitted: 12, missing: 12, issue: 'Partial day', action: 'Verify', severity: 'warning' },
      { rig: 305, customer: 'OXY', date: '10-Feb-2026', submitted: 0,  missing: 24, issue: 'Missing day', action: 'Upload', severity: 'critical' },
    ],
    rigSummaries: [
      { rig: 204, customer: 'ARA', well: 'W1', submittedDays: 28, expectedDays: 28,
        completeDays: 28, missingDays: 0, partialDays: 0, overDays: 0,
        total: 672, missingHrs: 0, completion: 100, status: 'Complete' },
    ],
    daily: [
      { day: 1, expected: 504, submitted: 480, missing_hrs: 24, completeRigs: 20, issueRigs: 1 },
      { day: 2, expected: 504, submitted: 504, missing_hrs: 0,  completeRigs: 21, issueRigs: 0 },
    ],
  };
}

// ─── buildAllRowsData ────────────────────────────────────────────────────────

describe('buildAllRowsData', () => {
  it('returns correct total row count', () => {
    const rows = buildAllRowsData(makeStore(), [204, 104]);
    expect(rows).toHaveLength(3); // 2 rows for 204, 1 for 104
  });

  it('skips rigs not in rigs array', () => {
    const rows = buildAllRowsData(makeStore(), [204]);
    expect(rows).toHaveLength(2);
  });

  it('skips rigs with no rows', () => {
    const store = { 999: { meta: {}, rows: [] } };
    const rows = buildAllRowsData(store, [999]);
    expect(rows).toHaveLength(0);
  });

  it('returns empty array for empty store', () => {
    const rows = buildAllRowsData({}, [204, 104]);
    expect(rows).toHaveLength(0);
  });

  it('each row has expected keys', () => {
    const rows = buildAllRowsData(makeStore(), [204]);
    const keys = ['Rig', 'Customer', 'Well', 'Contract No', 'P.O', 'Date',
                  'Operating', 'Reduced', 'Breakdown', 'Total Hrs',
                  'OBM Oper', 'Operation', 'Remarks'];
    for (const k of keys) expect(rows[0]).toHaveProperty(k);
  });

  it('propagates rig meta correctly', () => {
    const rows = buildAllRowsData(makeStore(), [204]);
    expect(rows[0].Rig).toBe(204);
    expect(rows[0].Customer).toBe('ARA');
    expect(rows[0].Well).toBe('W1');
    expect(rows[0]['Contract No']).toBe('C1');
  });

  it('propagates row data correctly', () => {
    const rows = buildAllRowsData(makeStore(), [204]);
    expect(rows[0].Operating).toBe(24);
    expect(rows[1].Reduced).toBe(4);
  });

  it('preserves remarks', () => {
    const rows = buildAllRowsData(makeStore(), [104]);
    expect(rows[0].Remarks).toBe('note');
  });
});

// ─── buildExceptionReportSheets ──────────────────────────────────────────────

describe('buildExceptionReportSheets', () => {
  it('returns three arrays', () => {
    const { exRows, rigRows, dailyRows } = buildExceptionReportSheets(makeQCModel());
    expect(Array.isArray(exRows)).toBe(true);
    expect(Array.isArray(rigRows)).toBe(true);
    expect(Array.isArray(dailyRows)).toBe(true);
  });

  it('exRows has one entry per exception', () => {
    const { exRows } = buildExceptionReportSheets(makeQCModel());
    expect(exRows).toHaveLength(2);
  });

  it('exRows row has correct keys', () => {
    const { exRows } = buildExceptionReportSheets(makeQCModel());
    for (const k of ['Rig', 'Customer', 'Date', 'Submitted Hrs', 'Missing Hrs', 'Issue', 'Action Required', 'Severity']) {
      expect(exRows[0]).toHaveProperty(k);
    }
  });

  it('rigRows has one entry per rig summary', () => {
    const { rigRows } = buildExceptionReportSheets(makeQCModel());
    expect(rigRows).toHaveLength(1);
  });

  it('rigRows row has correct keys', () => {
    const { rigRows } = buildExceptionReportSheets(makeQCModel());
    for (const k of ['Rig', 'Submitted Days', 'Missing Hrs', 'Completion %', 'Status']) {
      expect(rigRows[0]).toHaveProperty(k);
    }
  });

  it('dailyRows has one entry per day', () => {
    const { dailyRows } = buildExceptionReportSheets(makeQCModel());
    expect(dailyRows).toHaveLength(2);
  });

  it('numbers are rounded to 2 dp', () => {
    const qc = { ...makeQCModel() };
    qc.exceptions = [{ ...makeQCModel().exceptions[0], submitted: 12.12345, missing: 11.99999 }];
    const { exRows } = buildExceptionReportSheets(qc);
    expect(exRows[0]['Submitted Hrs']).toBe(12.12);
    expect(exRows[0]['Missing Hrs']).toBe(12);
  });
});

// ─── EXPORT_COL_WIDTHS ───────────────────────────────────────────────────────

describe('EXPORT_COL_WIDTHS', () => {
  it('has 24 column entries', () => {
    expect(EXPORT_COL_WIDTHS).toHaveLength(24);
  });

  it('each entry has a wch property', () => {
    for (const col of EXPORT_COL_WIDTHS) expect(col).toHaveProperty('wch');
  });
});
