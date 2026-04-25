import { describe, it, expect } from 'vitest';
import { buildTimelineHTML, buildFleetMissingHTML } from '../src/views/fleetOverview.js';

// ─── helpers ────────────────────────────────────────────────────────────────

/** Build a rigEntry with all days of a non-leap Feb filled at 24h. */
function febFullEntry() {
  const months = 'Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec'.split(',');
  const rows = [];
  for (let d = 1; d <= 28; d++) {
    rows.push({
      date: `${String(d).padStart(2, '0')}-Feb-2026`,
      operating: 24, reduced: 0, breakdown: 0, total_hrs: 24,
    });
  }
  return { rows };
}

// ─── buildTimelineHTML ───────────────────────────────────────────────────────

describe('buildTimelineHTML', () => {
  it('returns an HTML string with a timeline-31 wrapper', () => {
    const { html } = buildTimelineHTML(null, 2026, 2);
    expect(html).toContain('class="timeline-31"');
  });

  it('counts 28 missing days for Feb 2026 with no data', () => {
    const result = buildTimelineHTML(null, 2026, 2);
    expect(result.missingDays).toBe(28);
    expect(result.missingHrs).toBe(28 * 24);
    expect(result.incompleteDays).toBe(0);
    expect(result.overDays).toBe(0);
  });

  it('counts 0 missing days when all Feb days are at 24h', () => {
    const result = buildTimelineHTML(febFullEntry(), 2026, 2);
    expect(result.missingDays).toBe(0);
    expect(result.missingHrs).toBe(0);
  });

  it('marks a partial day when total is > 0 but < 23.5h', () => {
    const rows = [{ date: '01-Feb-2026', operating: 12, reduced: 0, breakdown: 0, total_hrs: 12 }];
    const result = buildTimelineHTML({ rows }, 2026, 2);
    expect(result.incompleteDays).toBe(1);
    // 1 partial day (12h gap) + 27 missing days (27 × 24 = 648h) = 660h total
    expect(result.missingHrs).toBeCloseTo(660, 1);
  });

  it('marks an over-24h day and increments overDays', () => {
    const rows = [{ date: '01-Feb-2026', operating: 25, reduced: 0, breakdown: 0, total_hrs: 25 }];
    const result = buildTimelineHTML({ rows }, 2026, 2);
    expect(result.overDays).toBe(1);
  });

  it('produces one day-cell div per calendar day in Feb 2026 (28)', () => {
    const { html } = buildTimelineHTML(null, 2026, 2);
    const cells = (html.match(/class="day-cell/g) || []).length;
    expect(cells).toBe(28);
  });

  it('produces 31 day-cells for March', () => {
    const { html } = buildTimelineHTML(null, 2026, 3);
    const cells = (html.match(/class="day-cell/g) || []).length;
    expect(cells).toBe(31);
  });

  it('handles rigEntry with empty rows array without throwing', () => {
    const result = buildTimelineHTML({ rows: [] }, 2026, 3);
    expect(result.missingDays).toBe(31);
  });

  it('full month → exactly 0 missing, 0 incomplete, 0 over', () => {
    const result = buildTimelineHTML(febFullEntry(), 2026, 2);
    expect(result.missingDays).toBe(0);
    expect(result.incompleteDays).toBe(0);
    expect(result.overDays).toBe(0);
  });
});

// ─── buildFleetMissingHTML ───────────────────────────────────────────────────

describe('buildFleetMissingHTML', () => {
  it('returns "All rigs complete" when reviewRigs is 0', () => {
    const html = buildFleetMissingHTML({ reviewRigs: 0, rigSummaries: [] });
    expect(html).toContain('All rigs complete');
  });

  it('lists incomplete rigs when reviewRigs > 0', () => {
    const qc = {
      reviewRigs: 1,
      rigSummaries: [
        { rig: 204, status: 'Incomplete', missingDays: 3, partialDays: 1, overDays: 0, missingHrs: 72 },
      ],
    };
    const html = buildFleetMissingHTML(qc);
    expect(html).toContain('Rig 204');
    expect(html).toContain('3 missing');
  });

  it('caps output at 10 rigs', () => {
    const summaries = Array.from({ length: 15 }, (_, i) => ({
      rig: 100 + i, status: 'Incomplete', missingDays: 1, partialDays: 0, overDays: 0, missingHrs: 24,
    }));
    const html = buildFleetMissingHTML({ reviewRigs: 15, rigSummaries: summaries });
    const spans = (html.match(/<span/g) || []).length;
    expect(spans).toBe(10);
  });

  it('omits Complete rigs from the missing list', () => {
    const qc = {
      reviewRigs: 1,
      rigSummaries: [
        { rig: 104, status: 'Complete', missingDays: 0, partialDays: 0, overDays: 0, missingHrs: 0 },
        { rig: 204, status: 'Incomplete', missingDays: 5, partialDays: 0, overDays: 0, missingHrs: 120 },
      ],
    };
    const html = buildFleetMissingHTML(qc);
    expect(html).not.toContain('Rig 104');
    expect(html).toContain('Rig 204');
  });
});
