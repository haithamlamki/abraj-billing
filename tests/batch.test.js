import { describe, it, expect } from 'vitest';
import {
  createBatch, startBatch, addToBatch, recordSuccess, recordReview,
  pauseBatch, resumeBatch, finishBatch, resetBatch, isRunning,
  hasPendingWork, batchProgress,
} from '../src/state/batch.js';

describe('createBatch', () => {
  it('returns a fresh inactive state', () => {
    const s = createBatch();
    expect(s.active).toBe(false);
    expect(s.total).toBe(0);
    expect(s.processed).toBe(0);
    expect(s.autoAccepted).toBe(0);
    expect(s.needsReview).toBe(0);
    expect(s.paused).toBe(false);
    expect(s.reviews).toEqual([]);
    expect(s.startedAt).toBe(0);
  });
});

describe('startBatch', () => {
  it('activates and stamps startedAt', () => {
    const s = createBatch();
    startBatch(s, 5);
    expect(s.active).toBe(true);
    expect(s.total).toBe(5);
    expect(s.paused).toBe(false);
    expect(s.startedAt).toBeGreaterThan(0);
  });

  it('clears stale per-run counters from a previous run', () => {
    const s = createBatch();
    startBatch(s, 5);
    recordSuccess(s);
    recordReview(s, 'foo.pdf', 204, 'fail');
    finishBatch(s);

    startBatch(s, 3);
    expect(s.processed).toBe(0);
    expect(s.autoAccepted).toBe(0);
    expect(s.needsReview).toBe(0);
    expect(s.reviews).toEqual([]);
    expect(s.total).toBe(3);
  });
});

describe('addToBatch', () => {
  it('grows total without resetting counters', () => {
    const s = createBatch();
    startBatch(s, 5);
    recordSuccess(s);
    addToBatch(s, 3);
    expect(s.total).toBe(8);
    expect(s.processed).toBe(1);
    expect(s.autoAccepted).toBe(1);
  });
});

describe('recordSuccess / recordReview', () => {
  it('recordSuccess advances both processed and autoAccepted', () => {
    const s = createBatch();
    startBatch(s, 2);
    recordSuccess(s);
    recordSuccess(s);
    expect(s.processed).toBe(2);
    expect(s.autoAccepted).toBe(2);
    expect(s.needsReview).toBe(0);
  });

  it('recordReview captures file/rig/reason and bumps needsReview', () => {
    const s = createBatch();
    startBatch(s, 1);
    recordReview(s, 'BST_383_Move.pdf', 111, 'no rows extracted');
    expect(s.processed).toBe(1);
    expect(s.needsReview).toBe(1);
    expect(s.reviews).toEqual([
      { file: 'BST_383_Move.pdf', rig: 111, reason: 'no rows extracted' },
    ]);
  });

  it('handles a mixed run', () => {
    const s = createBatch();
    startBatch(s, 4);
    recordSuccess(s);
    recordReview(s, 'a.pdf', 110, 'header not detected');
    recordSuccess(s);
    recordReview(s, 'b.pdf', 205, 'low confidence');
    expect(s.processed).toBe(4);
    expect(s.autoAccepted).toBe(2);
    expect(s.needsReview).toBe(2);
    expect(s.reviews).toHaveLength(2);
  });
});

describe('pause / resume / finish / reset', () => {
  it('pause/resume toggles the paused flag', () => {
    const s = createBatch();
    startBatch(s, 5);
    pauseBatch(s);
    expect(s.paused).toBe(true);
    expect(isRunning(s)).toBe(false);
    resumeBatch(s);
    expect(s.paused).toBe(false);
    expect(isRunning(s)).toBe(true);
  });

  it('finishBatch deactivates but preserves counters for the done banner', () => {
    const s = createBatch();
    startBatch(s, 2);
    recordSuccess(s);
    recordReview(s, 'a.pdf', 110, 'fail');
    finishBatch(s);
    expect(s.active).toBe(false);
    expect(s.processed).toBe(2);
    expect(s.autoAccepted).toBe(1);
    expect(s.needsReview).toBe(1);
    expect(hasPendingWork(s)).toBe(true); // still shows the done banner
  });

  it('resetBatch clears everything', () => {
    const s = createBatch();
    startBatch(s, 5);
    recordSuccess(s);
    finishBatch(s);
    resetBatch(s);
    expect(s).toEqual(createBatch());
    expect(hasPendingWork(s)).toBe(false);
  });
});

describe('batchProgress', () => {
  it('computes percent and ETA from processed/total + elapsed time', () => {
    const s = createBatch();
    startBatch(s, 10);
    s.startedAt = 1_000_000;
    recordSuccess(s);
    recordSuccess(s);
    // 2 processed in 4000ms = 2000ms/file. 8 remaining → 16s ETA.
    const p = batchProgress(s, 1_004_000);
    expect(p.pct).toBe(20);
    expect(p.remaining).toBe(8);
    expect(p.etaSec).toBe(16);
  });

  it('returns 0% / 0 ETA when nothing has been processed yet', () => {
    const s = createBatch();
    startBatch(s, 5);
    s.startedAt = 1_000_000;
    const p = batchProgress(s, 1_001_000);
    expect(p.pct).toBe(0);
    expect(p.etaSec).toBe(0);
  });

  it('returns 100% / 0 ETA when complete', () => {
    const s = createBatch();
    startBatch(s, 2);
    s.startedAt = 1_000_000;
    recordSuccess(s);
    recordSuccess(s);
    const p = batchProgress(s, 1_004_000);
    expect(p.pct).toBe(100);
    expect(p.remaining).toBe(0);
    expect(p.etaSec).toBe(0);
  });
});
