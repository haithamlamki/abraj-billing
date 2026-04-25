import { describe, it, expect } from 'vitest';
import {
  buildResultSummaryHTML,
  buildResultTimelineHTML,
  buildResultTableHTML,
  buildResultWarningsHTML,
  buildConfidenceStripHTML,
} from '../src/views/result.js';

// ─── helpers ────────────────────────────────────────────────────────────────

function makeRow(day, total = 24, overrides = {}) {
  return {
    date: `${String(day).padStart(2, '0')}-Feb-2026`,
    operating: total, reduced: 0, breakdown: 0, special: 0,
    force_maj: 0, zero_rate: 0, standby: 0, repair: 0, rig_move: 0,
    total_hrs: total,
    obm_oper: 0, obm_red: 0, obm_bd: 0, obm_spe: 0, obm_zero: 0,
    operation: '', total_hrs_repair: 0, remarks: '',
    ...overrides,
  };
}

const FULL_28 = Array.from({ length: 28 }, (_, i) => makeRow(i + 1, 24));

// ─── buildResultSummaryHTML ──────────────────────────────────────────────────

describe('buildResultSummaryHTML', () => {
  it('shows rig number', () => {
    const html = buildResultSummaryHTML(204, 'ARA', 'W1', FULL_28, 28);
    expect(html).toContain('204');
  });

  it('shows customer and well', () => {
    const html = buildResultSummaryHTML(204, 'ARA', 'WellX', FULL_28, 28);
    expect(html).toContain('ARA');
    expect(html).toContain('WellX');
  });

  it('shows 100% completion when all 28 Feb days are full', () => {
    const html = buildResultSummaryHTML(204, 'ARA', 'W1', FULL_28, 28);
    expect(html).toContain('100%');
  });

  it('shows partial count when some rows are partial', () => {
    const rows = [...FULL_28.slice(0, 27), makeRow(28, 12)];
    const html = buildResultSummaryHTML(204, 'ARA', 'W1', rows, 28);
    expect(html).toContain('Partial');
    expect(html).toContain('>1<');
  });

  it('shows missing count when fewer rows than days', () => {
    const html = buildResultSummaryHTML(204, 'ARA', 'W1', FULL_28.slice(0, 25), 28);
    expect(html).toContain('Missing');
    expect(html).toContain('>3<');
  });

  it('escapes HTML in customer name', () => {
    const html = buildResultSummaryHTML(204, '<script>x</script>', 'W1', FULL_28, 28);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

// ─── buildResultTimelineHTML ─────────────────────────────────────────────────

describe('buildResultTimelineHTML', () => {
  it('renders one bar column per day (28 for Feb 2026)', () => {
    const html = buildResultTimelineHTML(FULL_28, 2026, 2);
    // Each day has a data-scroll-day attribute
    const matches = (html.match(/data-scroll-day/g) || []).length;
    expect(matches).toBe(28);
  });

  it('marks missing days with red opacity style', () => {
    const html = buildResultTimelineHTML([], 2026, 2);
    expect(html).toContain('no data');
  });

  it('marks full days with green background', () => {
    const html = buildResultTimelineHTML([makeRow(1, 24)], 2026, 2);
    expect(html).toContain('var(--green)');
  });

  it('marks partial days with orange background', () => {
    const html = buildResultTimelineHTML([makeRow(1, 12)], 2026, 2);
    expect(html).toContain('var(--orange)');
  });
});

// ─── buildResultTableHTML ────────────────────────────────────────────────────

describe('buildResultTableHTML', () => {
  it('renders a <table> with thead and tbody', () => {
    const html = buildResultTableHTML(FULL_28);
    expect(html).toContain('<table');
    expect(html).toContain('<thead>');
    expect(html).toContain('<tbody>');
    expect(html).toContain('<tfoot>');
  });

  it('renders one data row per extracted row', () => {
    const html = buildResultTableHTML(FULL_28.slice(0, 5));
    // 5 rows → 5 data-idx attributes in <tr>
    const matches = (html.match(/data-idx="/g) || []).length;
    // Each row has at least 1 td with data-idx plus the <tr> itself
    // The tfoot also has no data-idx. Count <tr data-idx=
    const trMatches = (html.match(/<tr [^>]*data-idx="/g) || []).length;
    expect(trMatches).toBe(5);
  });

  it('shows ✓ for full days and × for zero-total rows', () => {
    const rows = [makeRow(1, 24), makeRow(2, 0)];
    const html = buildResultTableHTML(rows);
    expect(html).toContain('✓');
    expect(html).toContain('×');
  });

  it('escapes HTML in operation text', () => {
    const rows = [makeRow(1, 24, { operation: '<b>drilling</b>' })];
    const html = buildResultTableHTML(rows);
    expect(html).not.toContain('<b>drilling</b>');
    expect(html).toContain('&lt;b&gt;');
  });

  it('shows column totals in tfoot', () => {
    const html = buildResultTableHTML(FULL_28);
    // 28 days × 24h = 672 operating hours in total
    expect(html).toContain('672');
  });
});

// ─── buildResultWarningsHTML ─────────────────────────────────────────────────

describe('buildResultWarningsHTML', () => {
  it('returns empty string when rows == daysInMonth and all are 24h', () => {
    const html = buildResultWarningsHTML(FULL_28, 28);
    expect(html).toBe('');
  });

  it('warns when fewer rows than days', () => {
    const html = buildResultWarningsHTML(FULL_28.slice(0, 25), 28);
    expect(html).toContain('25 of 28 days');
  });

  it('warns when more rows than days', () => {
    const extra = [...FULL_28, makeRow(29, 24)];
    const html = buildResultWarningsHTML(extra, 28);
    expect(html).toContain('29 rows but month only has 28');
  });

  it('warns when some days do not total 24h', () => {
    const rows = [...FULL_28.slice(0, 27), makeRow(28, 12)];
    const html = buildResultWarningsHTML(rows, 28);
    expect(html).toContain('not totaling 24h');
  });
});

// ─── buildConfidenceStripHTML ────────────────────────────────────────────────

describe('buildConfidenceStripHTML', () => {
  it('shows the confidence score and status', () => {
    const html = buildConfidenceStripHTML({ score: 95, status: 'Auto-Accept', issues: [] });
    expect(html).toContain('95%');
    expect(html).toContain('Auto-Accept');
  });

  it('uses green color for score >= 90', () => {
    const html = buildConfidenceStripHTML({ score: 92, status: 'Auto-Accept', issues: [] });
    expect(html).toContain('var(--green)');
  });

  it('uses orange color for score 70-89', () => {
    const html = buildConfidenceStripHTML({ score: 75, status: 'Review', issues: [] });
    expect(html).toContain('var(--orange)');
  });

  it('uses red color for score < 70', () => {
    const html = buildConfidenceStripHTML({ score: 50, status: 'Review', issues: ['no rig'] });
    expect(html).toContain('var(--red)');
  });

  it('lists issues when present', () => {
    const html = buildConfidenceStripHTML({ score: 60, status: 'Review', issues: ['no rig', 'missing header'] });
    expect(html).toContain('no rig');
    expect(html).toContain('missing header');
  });

  it('shows fallback text when issues array is empty', () => {
    const html = buildConfidenceStripHTML({ score: 95, status: 'Auto-Accept', issues: [] });
    expect(html).toContain('look acceptable');
  });
});
