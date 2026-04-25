import { describe, it, expect } from 'vitest';
import { buildBatchBannerHTML, buildBatchDoneHTML } from '../src/views/batchBanner.js';

// ─── fixtures ────────────────────────────────────────────────────────────────

function makeActive({ paused = false } = {}) {
  return { active: true, total: 20, processed: 8, autoAccepted: 6, needsReview: 2, paused, reviews: [] };
}

function makeDone() {
  return {
    active: false, total: 10, autoAccepted: 8, needsReview: 2,
    reviews: [
      { file: 'Rig204_Feb.xlsx', rig: 204, reason: 'low confidence' },
      { file: 'Rig305_Feb.pdf',  rig: 305, reason: '2 conflict(s)' },
    ],
  };
}

const PROGRESS = { pct: 40, remaining: 12, etaSec: 90 };

// ─── buildBatchBannerHTML ────────────────────────────────────────────────────

describe('buildBatchBannerHTML', () => {
  it('shows processed / total files', () => {
    const html = buildBatchBannerHTML(makeActive(), PROGRESS);
    expect(html).toContain('8 / 20');
  });

  it('shows auto-accepted count', () => {
    const html = buildBatchBannerHTML(makeActive(), PROGRESS);
    expect(html).toContain('6 auto-accepted');
  });

  it('shows needs-review count', () => {
    const html = buildBatchBannerHTML(makeActive(), PROGRESS);
    expect(html).toContain('2 need review');
  });

  it('shows "processing" label when not paused', () => {
    const html = buildBatchBannerHTML(makeActive({ paused: false }), PROGRESS);
    expect(html).toContain('processing');
  });

  it('shows "paused" label when paused', () => {
    const html = buildBatchBannerHTML(makeActive({ paused: true }), PROGRESS);
    expect(html).toContain('paused');
  });

  it('shows Pause button when not paused', () => {
    const html = buildBatchBannerHTML(makeActive({ paused: false }), PROGRESS);
    expect(html).toContain('id="batchPause"');
    expect(html).not.toContain('id="batchResume"');
  });

  it('shows Resume button when paused', () => {
    const html = buildBatchBannerHTML(makeActive({ paused: true }), PROGRESS);
    expect(html).toContain('id="batchResume"');
    expect(html).not.toContain('id="batchPause"');
  });

  it('shows ETA in minutes when etaSec >= 60', () => {
    const html = buildBatchBannerHTML(makeActive(), { pct: 40, remaining: 12, etaSec: 90 });
    expect(html).toContain('2m left');
  });

  it('shows ETA in seconds when etaSec < 60', () => {
    const html = buildBatchBannerHTML(makeActive(), { pct: 90, remaining: 2, etaSec: 30 });
    expect(html).toContain('30s left');
  });

  it('omits ETA text when remaining === 0', () => {
    const html = buildBatchBannerHTML(makeActive(), { pct: 100, remaining: 0, etaSec: 0 });
    // etaTxt is empty — no "s left" or "m left" timing text should appear
    expect(html).not.toMatch(/\d+[sm] left/);
  });

  it('progress bar width reflects pct', () => {
    const html = buildBatchBannerHTML(makeActive(), { pct: 40, remaining: 5, etaSec: 20 });
    expect(html).toContain('width:40%');
  });
});

// ─── buildBatchDoneHTML ──────────────────────────────────────────────────────

describe('buildBatchDoneHTML', () => {
  it('shows "Batch done" heading', () => {
    const html = buildBatchDoneHTML(makeDone());
    expect(html).toContain('Batch done');
  });

  it('shows total file count', () => {
    const html = buildBatchDoneHTML(makeDone());
    expect(html).toContain('10 files');
  });

  it('shows auto-accepted count', () => {
    const html = buildBatchDoneHTML(makeDone());
    expect(html).toContain('8 auto-accepted');
  });

  it('shows needs-review count', () => {
    const html = buildBatchDoneHTML(makeDone());
    expect(html).toContain('2 need manual review');
  });

  it('includes Dismiss button', () => {
    const html = buildBatchDoneHTML(makeDone());
    expect(html).toContain('id="batchDismiss"');
  });

  it('lists review files when reviews present', () => {
    const html = buildBatchDoneHTML(makeDone());
    expect(html).toContain('Rig204_Feb.xlsx');
    expect(html).toContain('Rig 204');
    expect(html).toContain('low confidence');
  });

  it('shows no review list when reviews is empty', () => {
    const html = buildBatchDoneHTML({ ...makeDone(), reviews: [] });
    expect(html).not.toContain('<ul');
  });

  it('shows "?" for rig when rig is null', () => {
    const state = { ...makeDone(), reviews: [{ file: 'bad.xlsx', rig: null, reason: 'no rig' }] };
    const html = buildBatchDoneHTML(state);
    expect(html).toContain('Rig ?');
  });
});
