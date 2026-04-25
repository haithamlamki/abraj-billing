import { describe, it, expect } from 'vitest';
import { buildConflictRowHTML, buildConflictsHTML } from '../src/views/conflicts.js';

/** Minimal conflict object fixture. */
function makeConflict(overrides = {}) {
  return {
    date: '15-Feb-2026',
    existingSource: 'Excel (Rig204_Jan.xlsx)',
    existingTotal: 20,
    newSource: 'PDF (Rig204_Feb.pdf)',
    newTotal: 24,
    existing: { operating: 20, reduced: 0, breakdown: 0 },
    newRow:   { operating: 24, reduced: 0, breakdown: 0 },
    ...overrides,
  };
}

/** Minimal merged row fixture. */
const mergedRow = { date: '15-Feb-2026', operating: 24, reduced: 0, breakdown: 0, total_hrs: 24 };

describe('buildConflictRowHTML', () => {
  it('includes the conflict date', () => {
    const html = buildConflictRowHTML(makeConflict(), 24);
    expect(html).toContain('15-Feb-2026');
  });

  it('shows both source labels', () => {
    const html = buildConflictRowHTML(makeConflict(), 24);
    expect(html).toContain('Excel (Rig204_Jan.xlsx)');
    expect(html).toContain('PDF (Rig204_Feb.pdf)');
  });

  it('computes the diff correctly (+4.0h)', () => {
    const html = buildConflictRowHTML(makeConflict(), 24);
    expect(html).toContain('+4.0h');
  });

  it('shows a negative diff when newTotal < existingTotal', () => {
    const html = buildConflictRowHTML(makeConflict({ existingTotal: 24, newTotal: 20 }), 20);
    expect(html).toContain('-4.0h');
  });

  it('recommends "Use PDF" when either source contains "PDF"', () => {
    const html = buildConflictRowHTML(makeConflict(), 24);
    expect(html).toContain('Use PDF');
  });

  it('recommends "Manual Review" when neither source is PDF', () => {
    const html = buildConflictRowHTML(makeConflict({
      existingSource: 'Excel A',
      newSource: 'Excel B',
    }), 20);
    expect(html).toContain('Manual Review');
  });

  it('shows the mergedTotal value in the Current Merged column', () => {
    const html = buildConflictRowHTML(makeConflict(), 18);
    expect(html).toContain('18.0h');
  });

  it('handles zero mergedTotal gracefully', () => {
    const html = buildConflictRowHTML(makeConflict(), 0);
    expect(html).toContain('0.0h');
  });
});

describe('buildConflictsHTML', () => {
  const conflicts = [
    makeConflict({ date: '15-Feb-2026', existingTotal: 20, newTotal: 24 }),
    makeConflict({ date: '16-Feb-2026', existingTotal: 12, newTotal: 24,
                   existingSource: 'Excel B', newSource: 'Excel C' }),
  ];
  const rows = [
    { date: '15-Feb-2026', operating: 24, reduced: 0, breakdown: 0, total_hrs: 24 },
    { date: '16-Feb-2026', operating: 12, reduced: 0, breakdown: 0, total_hrs: 12 },
  ];

  it('mentions the conflict count in the header', () => {
    const html = buildConflictsHTML(204, conflicts, rows);
    expect(html).toContain('2 day(s)');
  });

  it('includes every conflict date', () => {
    const html = buildConflictsHTML(204, conflicts, rows);
    expect(html).toContain('15-Feb-2026');
    expect(html).toContain('16-Feb-2026');
  });

  it('renders all four action buttons', () => {
    const html = buildConflictsHTML(204, conflicts, rows);
    expect(html).toContain('data-conflict-action="manual"');
    expect(html).toContain('data-conflict-action="excel"');
    expect(html).toContain('data-conflict-action="pdf"');
    expect(html).toContain('data-conflict-action="merge"');
  });

  it('uses mergedRows to populate the Current Merged column', () => {
    const html = buildConflictsHTML(204, [makeConflict()], [mergedRow]);
    // mergedRow total_hrs = 24 → should appear as 24.0h
    expect(html).toContain('24.0h');
  });

  it('shows 0.0h in Current Merged when mergedRows is empty', () => {
    const html = buildConflictsHTML(204, [makeConflict()], []);
    // mergedTotal falls back to 0
    const mergedColMatches = [...html.matchAll(/var\(--cyan\)[^>]*>(\d+\.\d+)h/g)];
    expect(mergedColMatches.length).toBeGreaterThan(0);
    expect(mergedColMatches[0][1]).toBe('0.0');
  });

  it('handles a single conflict without throwing', () => {
    expect(() => buildConflictsHTML(204, [makeConflict()], [])).not.toThrow();
  });
});
