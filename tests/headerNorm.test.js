import { describe, it, expect, vi } from 'vitest';
import { normalizeHeaderRow, applyAboveRowHints } from '../src/mapping.js';

// ─── normalizeHeaderRow ───────────────────────────────────────────────────────

describe('normalizeHeaderRow', () => {
  it('keeps fmtRow text when it is a real header label', () => {
    const result = normalizeHeaderRow(['Date', 'Operating', 'Remarks'], []);
    expect(result).toEqual(['Date', 'Operating', 'Remarks']);
  });

  it('prefers rawRow when fmtRow cell looks like a date (DD/MM/YYYY)', () => {
    // fmtRow: date-formatted cell rendered as "01/02/2026", rawRow: real header
    const result = normalizeHeaderRow(['01/02/2026', '02/02/2026'], ['Operating', 'Standby']);
    expect(result).toEqual(['Operating', 'Standby']);
  });

  it('prefers rawRow when fmtRow cell looks like a date (MM-DD-YYYY)', () => {
    const result = normalizeHeaderRow(['12-31-2025'], ['Total Hrs']);
    expect(result).toEqual(['Total Hrs']);
  });

  it('does NOT prefer rawRow when rawRow cell starts with a digit', () => {
    // rawRow also looks like a number — fall back to fmtRow
    const result = normalizeHeaderRow(['01/02/2026'], ['123']);
    // fmtRow matches date pattern, rawRow starts with digit → fmtRow wins (neither is ideal)
    expect(result).toEqual(['01/02/2026']);
  });

  it('prefers rawRow when fmtRow is empty', () => {
    const result = normalizeHeaderRow(['', 'Date'], ['Operating', '']);
    expect(result).toEqual(['Operating', 'Date']);
  });

  it('falls back to rawRow when fmtRow is whitespace only', () => {
    const result = normalizeHeaderRow(['   '], ['Standby']);
    // safeStr('   ').replace trims → empty → rawRow wins
    expect(result).toEqual(['Standby']);
  });

  it('uses fmtRow when rawRow is empty', () => {
    const result = normalizeHeaderRow(['Operating'], ['']);
    expect(result).toEqual(['Operating']);
  });

  it('produces empty string when both cells are empty', () => {
    const result = normalizeHeaderRow([''], ['']);
    expect(result).toEqual(['']);
  });

  it('handles arrays of different lengths — fills up to the longer one', () => {
    const result = normalizeHeaderRow(['A', 'B'], ['X', 'Y', 'Z']);
    expect(result).toHaveLength(3);
    expect(result[2]).toBe('Z');
  });

  it('handles undefined/null cell values gracefully', () => {
    const result = normalizeHeaderRow([null, undefined, 'Operating'], []);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe('');
    expect(result[1]).toBe('');
    expect(result[2]).toBe('Operating');
  });

  it('strips embedded newlines from both rows', () => {
    const result = normalizeHeaderRow(['Total\nHrs'], []);
    expect(result[0]).toBe('Total Hrs');
  });

  it('defaults to empty arrays without throwing', () => {
    expect(() => normalizeHeaderRow()).not.toThrow();
    expect(normalizeHeaderRow()).toEqual([]);
  });
});

// ─── applyAboveRowHints ───────────────────────────────────────────────────────

describe('applyAboveRowHints', () => {
  it('detects total_hrs when prevRow+"hRow" cell matches "total h..."', () => {
    // prevRow: "Total", hRow: "Hrs" at column 3
    const detected = {};
    applyAboveRowHints(detected, ['', '', '', 'Total'], ['', '', '', 'Hrs']);
    expect(detected.total_hrs).toBe(3);
  });

  it('detects total_hrs from "Total Hrs" split: prevRow "Total", hRow "Hours"', () => {
    const detected = {};
    applyAboveRowHints(detected, ['Total'], ['Hours']);
    expect(detected.total_hrs).toBe(0);
  });

  it('does NOT overwrite an already-detected total_hrs', () => {
    const detected = { total_hrs: 5 };
    applyAboveRowHints(detected, ['Total', 'Total'], ['Hrs', 'Hrs']);
    expect(detected.total_hrs).toBe(5); // unchanged
  });

  it('detects operation from combined "Operation Hrs"', () => {
    const detected = {};
    applyAboveRowHints(detected, ['Operation'], ['Hrs']);
    expect(detected.operation).toBe(0);
  });

  it('does NOT overwrite an already-detected operation', () => {
    const detected = { operation: 2 };
    applyAboveRowHints(detected, ['Operation'], ['Summary']);
    expect(detected.operation).toBe(2);
  });

  it('skips columns where prevRow cell is empty', () => {
    const detected = {};
    applyAboveRowHints(detected, ['', 'Total'], ['Hrs', 'Hrs']);
    // col 0: prevRow empty → skip; col 1: "Total Hrs" → total_hrs=1
    expect(detected.total_hrs).toBe(1);
  });

  it('skips columns where hRow cell is empty', () => {
    const detected = {};
    applyAboveRowHints(detected, ['Total', 'Total'], ['', 'Hrs']);
    // col 0: hRow empty → skip; col 1: "Total Hrs" → total_hrs=1
    expect(detected.total_hrs).toBe(1);
  });

  it('calls the log callback with the right message for total_hrs', () => {
    const logSpy = vi.fn();
    const detected = {};
    applyAboveRowHints(detected, ['Total'], ['Hrs'], logSpy);
    expect(logSpy).toHaveBeenCalledOnce();
    expect(logSpy.mock.calls[0][0]).toContain('total_hrs');
    expect(logSpy.mock.calls[0][1]).toBe('info');
  });

  it('does NOT call log when no combined header is found', () => {
    const logSpy = vi.fn();
    applyAboveRowHints({}, ['Random'], ['Text'], logSpy);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('returns the detected object (same reference)', () => {
    const detected = {};
    const returned = applyAboveRowHints(detected, [], []);
    expect(returned).toBe(detected);
  });

  it('handles empty prevRow and hRow without throwing', () => {
    expect(() => applyAboveRowHints({}, [], [])).not.toThrow();
  });
});
