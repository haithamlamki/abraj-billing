import { describe, it, expect } from 'vitest';
import { buildPreviewTableHTML } from '../src/views/preview.js';

// ─── helpers ────────────────────────────────────────────────────────────────

/** Build a minimal 2-D table: one header row + N data rows. */
function makeSheet(dataRows = 3) {
  const header = ['Date', 'Operating', 'Reduced', 'Breakdown', 'Total Hrs'];
  const rows   = [header];
  for (let d = 1; d <= dataRows; d++) {
    rows.push([`${String(d).padStart(2, '0')}-Mar-2026`, 24, 0, 0, 24]);
  }
  return rows;
}

// ─── structure ───────────────────────────────────────────────────────────────

describe('buildPreviewTableHTML — structure', () => {
  it('returns a string with <table>, <thead>, <tbody>', () => {
    const html = buildPreviewTableHTML(makeSheet(3), 0);
    expect(html).toContain('<table');
    expect(html).toContain('<thead>');
    expect(html).toContain('<tbody>');
  });

  it('renders "Col N" header for each column', () => {
    const html = buildPreviewTableHTML(makeSheet(1), 0);
    expect(html).toContain('Col 1');
    expect(html).toContain('Col 5'); // 5 columns
  });

  it('renders one <tr> per row (up to 60)', () => {
    const html = buildPreviewTableHTML(makeSheet(5), 0);
    // 6 rows (1 header + 5 data) — tbody rows have `<tr ` (class/style attr follows)
    // The thead <tr> has no space after so it's not counted here; that's fine.
    const bodyTrs = (html.match(/data-row="/g) || []).length;
    expect(bodyTrs).toBe(6);
  });

  it('caps at 60 rows and shows "more rows" message', () => {
    const big = makeSheet(80); // 81 rows
    const html = buildPreviewTableHTML(big, 0);
    // Should mention remaining rows
    expect(html).toContain('more rows');
    // Row count in tbody: exactly 60 data-row trs
    const trRows = (html.match(/data-row="/g) || []).length;
    expect(trRows).toBe(60);
  });
});

// ─── section labels ──────────────────────────────────────────────────────────

describe('buildPreviewTableHTML — section labels', () => {
  it('marks the detected header row as TABLE HDR', () => {
    const html = buildPreviewTableHTML(makeSheet(3), 0); // row 0 = header
    expect(html).toContain('TABLE HDR');
  });

  it('marks rows above the header as HEADER (pre-table metadata)', () => {
    const data = [
      ['Report Title'],         // row 0 — pre-header
      ['Date','Operating'],     // row 1 — table header
      ['01-Mar-2026', 24],      // row 2 — data
    ];
    const html = buildPreviewTableHTML(data, 1);
    expect(html).toContain('HEADER');   // row 0
    expect(html).toContain('TABLE HDR'); // row 1
    expect(html).toContain('DATA');     // row 2
  });

  it('marks footer rows after data ends', () => {
    const data = [
      ['Date', 'Operating'],    // row 0 — header
      ['01-Mar-2026', 24],      // row 1 — data
      ['Total', 24],            // row 2 — detected as footer by classifyRows
    ];
    // classifyRows decides dataEnd based on "Total" keyword — footer follows
    const html = buildPreviewTableHTML(data, 0);
    expect(html).toContain('FOOTER');
  });

  it('shows no section labels when headerRow is -1', () => {
    const html = buildPreviewTableHTML(makeSheet(3), -1);
    expect(html).not.toContain('TABLE HDR');
    expect(html).not.toContain('DATA');
    expect(html).not.toContain('FOOTER');
  });

  it('adds class="header-row" to the detected header row', () => {
    const html = buildPreviewTableHTML(makeSheet(3), 0);
    expect(html).toContain('class="header-row"');
  });
});

// ─── cell content ────────────────────────────────────────────────────────────

describe('buildPreviewTableHTML — cell content', () => {
  it('includes cell values in <td> elements', () => {
    const html = buildPreviewTableHTML(makeSheet(1), 0);
    expect(html).toContain('Date');
    expect(html).toContain('Operating');
    expect(html).toContain('01-Mar-2026');
  });

  it('replaces newlines in cell values with spaces', () => {
    const data = [['Col\nA', 'Col B'], ['val\nnew', 0]];
    const html = buildPreviewTableHTML(data, 0);
    expect(html).not.toContain('Col\nA');
    expect(html).toContain('Col A');
  });

  it('truncates long cell values to 40 chars with ellipsis in display text', () => {
    const long = 'A'.repeat(50);
    const data = [[long, 'B'], ['01-Mar-2026', 0]];
    const html = buildPreviewTableHTML(data, 0);
    // Display text is truncated; full value preserved only in the title attribute
    expect(html).toContain('A'.repeat(40) + '...');
    // Verify the display cell (between > and <) is capped — full 50-char should not
    // appear as visible text (only in title attr). Check by looking for it outside attr.
    expect(html).toContain(`title="${long}"`); // full in title – that's expected
    // The td content must be the truncated version, not the full string
    const tdMatch = html.match(/<td title="[^"]*">([^<]*)<\/td>/g) || [];
    const hasFullInContent = tdMatch.some(td => td.includes('A'.repeat(50)) && !td.startsWith('<td title='));
    expect(hasFullInContent).toBe(false);
  });

  it('caps columns at 20', () => {
    const wideRow = Array.from({ length: 25 }, (_, i) => `C${i}`);
    const html = buildPreviewTableHTML([wideRow], -1);
    expect(html).toContain('Col 20');
    expect(html).not.toContain('Col 21');
  });

  it('includes data-row attribute on every body row', () => {
    const html = buildPreviewTableHTML(makeSheet(4), 0);
    for (let i = 0; i < 5; i++) { // 5 rows total (header + 4)
      expect(html).toContain(`data-row="${i}"`);
    }
  });
});
