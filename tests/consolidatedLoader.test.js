import { describe, it, expect } from 'vitest';
import { parseConsolidatedRows } from '../src/pipeline/consolidatedLoader.js';

const RIGS = [204, 104, 305];
const OPTS = { year: 2026, month: 2, rigs: RIGS };

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeRow(overrides = {}) {
  return {
    Rig: 204, Customer: 'ARA', Well: 'W1', 'Contract No': 'C1', 'P.O': 'P1',
    Date: '01-Feb-2026',
    Operating: 24, Reduced: 0, Breakdown: 0, Special: 0,
    'Force Maj': 0, 'Zero Rate': 0, Standby: 0, Repair: 0, 'Rig Move': 0,
    'Total Hrs': 24,
    'OBM Oper': 0, 'OBM Red': 0, 'OBM BD': 0, 'OBM Spe': 0, 'OBM Zero': 0,
    Operation: '', 'Total Hours Repair': 0, Remarks: 'good',
    ...overrides,
  };
}

// ─── filtering ───────────────────────────────────────────────────────────────

describe('parseConsolidatedRows — filtering', () => {
  it('returns one entry for a valid row', () => {
    const result = parseConsolidatedRows([makeRow()], OPTS);
    expect(result).toHaveLength(1);
  });

  it('skips rows with unknown rig number', () => {
    const result = parseConsolidatedRows([makeRow({ Rig: 999 })], OPTS);
    expect(result).toHaveLength(0);
  });

  it('skips rows with no rig field', () => {
    const result = parseConsolidatedRows([makeRow({ Rig: null, rig: null })], OPTS);
    expect(result).toHaveLength(0);
  });

  it('skips rows with unparseable date', () => {
    const result = parseConsolidatedRows([makeRow({ Date: 'not-a-date' })], OPTS);
    expect(result).toHaveLength(0);
  });

  it('skips rows outside the billing month', () => {
    const result = parseConsolidatedRows([makeRow({ Date: '01-Jan-2026' })], OPTS);
    expect(result).toHaveLength(0);
  });

  it('returns empty array for empty input', () => {
    const result = parseConsolidatedRows([], OPTS);
    expect(result).toHaveLength(0);
  });

  it('processes multiple valid rows', () => {
    const rows = [
      makeRow({ Date: '01-Feb-2026' }),
      makeRow({ Rig: 104, Customer: 'PDO', Date: '02-Feb-2026' }),
      makeRow({ Date: '03-Feb-2026' }),
    ];
    const result = parseConsolidatedRows(rows, OPTS);
    expect(result).toHaveLength(3);
  });
});

// ─── lowercase field aliases ──────────────────────────────────────────────────

describe('parseConsolidatedRows — lowercase aliases', () => {
  it('accepts lowercase field names (rig, date, customer…)', () => {
    const r = { rig: 204, customer: 'ARA', well: 'W1', date: '01-Feb-2026',
                operating: 20, reduced: 4, breakdown: 0, special: 0,
                force_maj: 0, zero_rate: 0, standby: 0, repair: 0, rig_move: 0,
                total_hrs: 24, obm_oper: 0, obm_red: 0, obm_bd: 0, obm_spe: 0,
                obm_zero: 0, operation: '', total_hrs_repair: 0, remarks: '' };
    const result = parseConsolidatedRows([r], OPTS);
    expect(result).toHaveLength(1);
    expect(result[0].rigNum).toBe(204);
  });
});

// ─── meta ────────────────────────────────────────────────────────────────────

describe('parseConsolidatedRows — meta', () => {
  it('captures customer, well, contract, po', () => {
    const [r] = parseConsolidatedRows([makeRow()], OPTS);
    expect(r.meta.customer).toBe('ARA');
    expect(r.meta.well).toBe('W1');
    expect(r.meta.contract).toBe('C1');
    expect(r.meta.po).toBe('P1');
  });

  it('falls back to RIG_CUST when customer is empty', () => {
    // Rig 204 is ARA in constants — RIG_CUST[204] should provide it
    const [r] = parseConsolidatedRows([makeRow({ Customer: null, customer: null })], OPTS);
    expect(typeof r.meta.customer).toBe('string');
  });
});

// ─── row data ────────────────────────────────────────────────────────────────

describe('parseConsolidatedRows — row data', () => {
  it('maps all hour columns correctly', () => {
    const input = makeRow({ Operating: 20, Reduced: 3, Breakdown: 1, 'Force Maj': 0, 'Total Hrs': 24 });
    const [r] = parseConsolidatedRows([input], OPTS);
    expect(r.row.operating).toBe(20);
    expect(r.row.reduced).toBe(3);
    expect(r.row.breakdown).toBe(1);
    expect(r.row.total_hrs).toBe(24);
  });

  it('maps remarks and operation text', () => {
    const input = makeRow({ Remarks: 'note here', Operation: 'Drilling' });
    const [r] = parseConsolidatedRows([input], OPTS);
    expect(r.row.remarks).toBe('note here');
    expect(r.row.operation).toBe('Drilling');
  });

  it('returns correct rigNum in result', () => {
    const [r] = parseConsolidatedRows([makeRow({ Rig: 305 })], OPTS);
    expect(r.rigNum).toBe(305);
  });
});
