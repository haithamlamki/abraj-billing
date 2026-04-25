import { describe, it, expect } from 'vitest';
import {
  buildRigTableHTML,
  buildCustomerTableHTML,
  buildExceptionTableHTML,
  buildRecordsTableHTML,
  buildHeatmapHTML,
} from '../src/views/summary.js';

// ─── fixtures ────────────────────────────────────────────────────────────────

const rigRows = [
  { rig: 204, customer: 'ARA',  days: 28, total: 672, missingHrs: 0,  status: 'Complete' },
  { rig: 104, customer: 'PDO',  days: 15, total: 360, missingHrs: 312, status: 'Incomplete' },
  { rig: 305, customer: 'OXY',  days: 20, total: 480, missingHrs: 192, status: 'Partial' },
];

const customerRows = [
  { customer: 'ARA', rigs: 1, operating: 600, reduced: 40, breakdown: 32, total: 672, missingHrs: 0 },
  { customer: 'PDO', rigs: 3, operating: 300, reduced: 30, breakdown: 30, total: 360, missingHrs: 48 },
];

const exceptions = [
  { severity: 'critical', rig: 204, customer: 'ARA', date: '01-Feb-2026', submitted: 0, missing: 24, issue: 'Missing day', action: 'Upload file' },
  { severity: 'warning',  rig: 104, customer: 'PDO', date: '05-Feb-2026', submitted: 12, missing: 12, issue: 'Partial day', action: 'Verify' },
];

const records = [
  { rig: 204, customer: 'ARA', well: 'W1', date: '01-Feb-2026', operating: 24, reduced: 0, breakdown: 0, rig_move: 0, total_hrs: 24, qc_status: 'Complete', missing_hrs: 0 },
  { rig: 104, customer: 'PDO', well: 'W2', date: '05-Feb-2026', operating: 12, reduced: 0, breakdown: 0, rig_move: 0, total_hrs: 12, qc_status: 'Partial',   missing_hrs: 12 },
  { rig: 305, customer: 'OXY', well: 'W3', date: '10-Feb-2026', operating: 25, reduced: 0, breakdown: 0, rig_move: 0, total_hrs: 25, qc_status: 'Over',      missing_hrs: 0 },
];

// ─── buildRigTableHTML ────────────────────────────────────────────────────────

describe('buildRigTableHTML', () => {
  it('renders one <tr> per rig', () => {
    const html = buildRigTableHTML(rigRows, 28);
    const trs = (html.match(/<tr>/g) || []).length;
    expect(trs).toBe(3);
  });

  it('shows rig number and customer', () => {
    const html = buildRigTableHTML(rigRows, 28);
    expect(html).toContain('204');
    expect(html).toContain('ARA');
  });

  it('uses qc-ok badge for Complete', () => {
    const html = buildRigTableHTML([rigRows[0]], 28);
    expect(html).toContain('qc-ok');
    expect(html).toContain('Complete');
  });

  it('uses qc-bad badge for Incomplete', () => {
    const html = buildRigTableHTML([rigRows[1]], 28);
    expect(html).toContain('qc-bad');
  });

  it('uses qc-warn badge for Partial', () => {
    const html = buildRigTableHTML([rigRows[2]], 28);
    expect(html).toContain('qc-warn');
  });

  it('shows red color when missingHrs > 0', () => {
    const html = buildRigTableHTML([rigRows[1]], 28);
    expect(html).toContain('var(--red)');
  });

  it('escapes HTML in customer name', () => {
    const html = buildRigTableHTML([{ ...rigRows[0], customer: '<script>x</script>' }], 28);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

// ─── buildCustomerTableHTML ──────────────────────────────────────────────────

describe('buildCustomerTableHTML', () => {
  it('renders one row per customer', () => {
    const html = buildCustomerTableHTML(customerRows);
    const trs = (html.match(/<tr>/g) || []).length;
    expect(trs).toBe(2);
  });

  it('shows customer name and rig count', () => {
    const html = buildCustomerTableHTML(customerRows);
    expect(html).toContain('ARA');
    expect(html).toContain('>1<');
  });

  it('uses green color when missingHrs === 0', () => {
    const html = buildCustomerTableHTML([customerRows[0]]);
    expect(html).toContain('var(--green)');
  });
});

// ─── buildExceptionTableHTML ─────────────────────────────────────────────────

describe('buildExceptionTableHTML', () => {
  it('renders one row per exception', () => {
    const html = buildExceptionTableHTML(exceptions);
    const trs = (html.match(/<tr /g) || []).length;
    expect(trs).toBe(2);
  });

  it('uses bad-row class for critical severity', () => {
    const html = buildExceptionTableHTML([exceptions[0]]);
    expect(html).toContain('bad-row');
    expect(html).toContain('qc-bad');
  });

  it('uses conf-row class for warning severity', () => {
    const html = buildExceptionTableHTML([exceptions[1]]);
    expect(html).toContain('conf-row');
    expect(html).toContain('qc-warn');
  });

  it('caps at 1200 and adds overflow message', () => {
    const many = Array.from({ length: 1205 }, (_, i) => ({
      severity: 'warning', rig: 100, customer: 'X', date: `0${(i % 9) + 1}-Feb`, submitted: 12, missing: 12, issue: 'Partial', action: 'Check',
    }));
    const html = buildExceptionTableHTML(many);
    expect(html).toContain('Showing first 1,200 of 1205');
  });

  it('no overflow message when exactly 1200', () => {
    const exactly = Array.from({ length: 1200 }, () => exceptions[0]);
    const html = buildExceptionTableHTML(exactly);
    expect(html).not.toContain('Showing first');
  });
});

// ─── buildRecordsTableHTML ───────────────────────────────────────────────────

describe('buildRecordsTableHTML', () => {
  it('renders one row per record', () => {
    const html = buildRecordsTableHTML(records);
    const trs = (html.match(/<tr>/g) || []).length;
    expect(trs).toBe(3);
  });

  it('shows qc-ok badge for Complete records', () => {
    const html = buildRecordsTableHTML([records[0]]);
    expect(html).toContain('qc-ok');
    expect(html).toContain('Complete');
  });

  it('shows partial label with missing hours', () => {
    const html = buildRecordsTableHTML([records[1]]);
    expect(html).toContain('Partial');
    expect(html).toContain('12');
  });

  it('shows "Over 24h" for total_hrs > 24.5', () => {
    const html = buildRecordsTableHTML([records[2]]);
    expect(html).toContain('Over 24h');
  });

  it('caps at 1000 with overflow notice', () => {
    const many = Array.from({ length: 1005 }, () => records[0]);
    const html = buildRecordsTableHTML(many);
    expect(html).toContain('Showing first 1,000 of 1005');
  });
});

// ─── buildHeatmapHTML ────────────────────────────────────────────────────────

describe('buildHeatmapHTML', () => {
  const rigs = [204, 104];
  const fakeStore = {
    204: { rows: [{ date: '01-Feb-2026', operating: 24, reduced: 0, breakdown: 0, total_hrs: 24 }] },
    104: { rows: [] },
  };

  it('has a label + 28 day-head cells in the header row', () => {
    const html = buildHeatmapHTML(rigs, fakeStore, 2026, 2, 28);
    const dayHeads = (html.match(/summary-day-head/g) || []).length;
    expect(dayHeads).toBe(28);
  });

  it('produces one label cell per rig', () => {
    const html = buildHeatmapHTML(rigs, fakeStore, 2026, 2, 28);
    expect(html).toContain('<strong>204</strong>');
    expect(html).toContain('<strong>104</strong>');
  });

  it('marks a full day with class "full"', () => {
    const html = buildHeatmapHTML([204], fakeStore, 2026, 2, 28);
    expect(html).toContain('summary-heat-cell full');
  });

  it('marks missing days with class "missing"', () => {
    const html = buildHeatmapHTML([104], fakeStore, 2026, 2, 28);
    // All 28 days missing for rig 104
    const missing = (html.match(/summary-heat-cell missing/g) || []).length;
    expect(missing).toBe(28);
  });
});
