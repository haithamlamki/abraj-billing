import { describe, it, expect } from 'vitest';
import { evaluateIssues, AUTO_ACCEPT_THRESHOLD } from '../src/review.js';

const cleanRows = Array.from({ length: 31 }, (_, i) => ({ date: `${String(i + 1).padStart(2, '0')}-Mar-2026` }));
const highConf = { score: 100, status: 'Auto Accepted', issues: [] };

describe('evaluateIssues', () => {
  it('returns empty array for a clean extraction', () => {
    const issues = evaluateIssues({
      rig: 204,
      headerRow: 4,
      rows: cleanRows,
      confidence: highConf,
      duplicates: 0,
      overHoursCount: 0,
    });
    expect(issues).toEqual([]);
  });

  it('flags missing rig', () => {
    const issues = evaluateIssues({ rig: null, headerRow: 4, rows: cleanRows, confidence: highConf });
    expect(issues).toContain('rig not detected');
  });

  it('flags missing header row', () => {
    const issues = evaluateIssues({ rig: 204, headerRow: -1, rows: cleanRows, confidence: highConf });
    expect(issues).toContain('header row not detected');
  });

  it('flags empty rows', () => {
    const issues = evaluateIssues({ rig: 204, headerRow: 4, rows: [], confidence: highConf });
    expect(issues).toContain('no valid daily rows extracted');
  });

  it('flags over-24h rows with count', () => {
    const issues = evaluateIssues({
      rig: 204, headerRow: 4, rows: cleanRows, confidence: highConf,
      overHoursCount: 3,
    });
    expect(issues.some(i => i.includes('3 row(s) over 24 hours'))).toBe(true);
  });

  it('flags duplicate dates with count', () => {
    const issues = evaluateIssues({
      rig: 204, headerRow: 4, rows: cleanRows, confidence: highConf,
      duplicates: 2,
    });
    expect(issues.some(i => i.includes('2 duplicate date(s)'))).toBe(true);
  });

  it('flags low-confidence scores below threshold', () => {
    const issues = evaluateIssues({
      rig: 204, headerRow: 4, rows: cleanRows,
      confidence: { score: AUTO_ACCEPT_THRESHOLD - 1, status: 'Accepted with Warning', issues: [] },
    });
    expect(issues.some(i => /low confidence/.test(i))).toBe(true);
  });

  it('does NOT flag confidence exactly at threshold', () => {
    const issues = evaluateIssues({
      rig: 204, headerRow: 4, rows: cleanRows,
      confidence: { score: AUTO_ACCEPT_THRESHOLD, status: 'Auto Accepted', issues: [] },
    });
    expect(issues.some(i => /low confidence/.test(i))).toBe(false);
  });

  it('composes multiple issues', () => {
    const issues = evaluateIssues({
      rig: null,
      headerRow: -1,
      rows: [],
      confidence: { score: 40, status: 'Manual Review Required', issues: [] },
      duplicates: 1,
      overHoursCount: 1,
    });
    expect(issues).toHaveLength(6);
    expect(issues).toEqual([
      'rig not detected',
      'header row not detected',
      'no valid daily rows extracted',
      '1 row(s) over 24 hours',
      '1 duplicate date(s)',
      'low confidence (40%)',
    ]);
  });

  it('tolerates missing confidence object', () => {
    const issues = evaluateIssues({ rig: 204, headerRow: 4, rows: cleanRows });
    expect(issues).toEqual([]);
  });
});

describe('AUTO_ACCEPT_THRESHOLD', () => {
  it('is 90 (matches confidence status band)', () => {
    expect(AUTO_ACCEPT_THRESHOLD).toBe(90);
  });
});
