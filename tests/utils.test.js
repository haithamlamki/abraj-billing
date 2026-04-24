import { describe, it, expect } from 'vitest';
import { safeNum, safeStr, fmtNum, clamp } from '../src/utils.js';

describe('safeNum', () => {
  it('returns 0 for null and undefined', () => {
    expect(safeNum(null)).toBe(0);
    expect(safeNum(undefined)).toBe(0);
  });
  it('returns 0 for empty string', () => {
    expect(safeNum('')).toBe(0);
  });
  it('parses numeric strings', () => {
    expect(safeNum('12')).toBe(12);
    expect(safeNum('12.5')).toBe(12.5);
    expect(safeNum('-3.7')).toBe(-3.7);
  });
  it('returns 0 for NaN-producing input', () => {
    expect(safeNum('abc')).toBe(0);
    expect(safeNum('12abc')).toBe(0);
  });
  it('passes through numbers', () => {
    expect(safeNum(42)).toBe(42);
    expect(safeNum(0)).toBe(0);
  });
});

describe('safeStr', () => {
  it('returns empty string for null/undefined', () => {
    expect(safeStr(null)).toBe('');
    expect(safeStr(undefined)).toBe('');
  });
  it('trims whitespace', () => {
    expect(safeStr('  hello  ')).toBe('hello');
  });
  it('coerces numbers to strings', () => {
    expect(safeStr(42)).toBe('42');
  });
  it('handles zero-width and tab-wrapped values', () => {
    expect(safeStr('\tabc\n')).toBe('abc');
  });
});

describe('fmtNum', () => {
  it('formats with thousand separators', () => {
    expect(fmtNum(1234567)).toBe('1,234,567');
  });
  it('respects decimal digits', () => {
    expect(fmtNum(12.345, 1)).toBe('12.3');
    expect(fmtNum(12, 1)).toBe('12.0');
  });
  it('falls back to 0 for invalid input', () => {
    expect(fmtNum('nope')).toBe('0');
  });
});

describe('clamp', () => {
  it('clamps below min', () => {
    expect(clamp(-5, 0, 100)).toBe(0);
  });
  it('clamps above max', () => {
    expect(clamp(150, 0, 100)).toBe(100);
  });
  it('passes through in-range values', () => {
    expect(clamp(50, 0, 100)).toBe(50);
  });
});
