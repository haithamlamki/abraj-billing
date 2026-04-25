import { describe, it, expect } from 'vitest';
import { buildReviewCardHTML } from '../src/views/reviewQueue.js';

/** Minimal card fixture. */
function makeCard(overrides = {}) {
  return {
    id: 1,
    fileName: 'Rig204_Feb2026.xlsx',
    sheetName: 'Billing',
    rig: 204,
    meta: { customer: 'ARA', well: 'W1', contract: 'C1', po: 'P1' },
    confidence: { score: 92 },
    rows: [{ date: '01-Feb-2026', operating: 24 }],
    issues: ['low confidence'],
    ...overrides,
  };
}

describe('buildReviewCardHTML', () => {
  it('includes the fileName, sheetName and rig number', () => {
    const html = buildReviewCardHTML(makeCard());
    expect(html).toContain('Rig204_Feb2026.xlsx');
    expect(html).toContain('[Billing]');
    expect(html).toContain('Rig 204');
  });

  it('shows customer and confidence score', () => {
    const html = buildReviewCardHTML(makeCard());
    expect(html).toContain('ARA');
    expect(html).toContain('92%');
  });

  it('lists issues in an <ul>', () => {
    const html = buildReviewCardHTML(makeCard({ issues: ['missing header', 'low confidence'] }));
    expect(html).toContain('<li>missing header</li>');
    expect(html).toContain('<li>low confidence</li>');
  });

  it('shows Edit + Accept + Skip buttons when rig and rows exist', () => {
    const html = buildReviewCardHTML(makeCard());
    expect(html).toContain('data-review-action="edit"');
    expect(html).toContain('data-review-action="accept"');
    expect(html).toContain('data-review-action="skip"');
  });

  it('omits Edit and Accept when rig is null', () => {
    const html = buildReviewCardHTML(makeCard({ rig: null }));
    expect(html).not.toContain('data-review-action="edit"');
    expect(html).not.toContain('data-review-action="accept"');
    expect(html).toContain('data-review-action="skip"');
  });

  it('omits Edit and Accept when rows array is empty', () => {
    const html = buildReviewCardHTML(makeCard({ rows: [] }));
    expect(html).not.toContain('data-review-action="edit"');
    expect(html).not.toContain('data-review-action="accept"');
    expect(html).toContain('data-review-action="skip"');
  });

  it('shows "Rig ?" when rig is null', () => {
    const html = buildReviewCardHTML(makeCard({ rig: null }));
    expect(html).toContain('Rig ?');
  });

  it('shows "—" for customer when meta.customer is empty', () => {
    const html = buildReviewCardHTML(makeCard({ meta: { customer: '' } }));
    expect(html).toContain('—');
  });

  it('omits sheet label when sheetName is empty', () => {
    const html = buildReviewCardHTML(makeCard({ sheetName: '' }));
    expect(html).not.toContain('[');
  });

  it('escapes HTML in fileName and issues to prevent XSS', () => {
    const html = buildReviewCardHTML(makeCard({
      fileName: '<script>alert(1)</script>.xlsx',
      issues: ['<b>bad</b>'],
    }));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<b>bad</b>');
    expect(html).toContain('&lt;b&gt;bad&lt;/b&gt;');
  });

  it('shows the row count in the header line', () => {
    const html = buildReviewCardHTML(makeCard({ rows: [1, 2, 3] }));
    expect(html).toContain('3 rows extracted');
  });

  it('embeds data-review-id matching card.id', () => {
    const html = buildReviewCardHTML(makeCard({ id: 42 }));
    expect(html).toContain('data-review-id="42"');
  });
});
