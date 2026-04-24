import { describe, it, expect } from 'vitest';
import { toDateStr, parseDate, getDaysInMonth, getMonthName, dateForDay } from '../src/dates.js';

describe('getDaysInMonth', () => {
  it('returns 31 for January', () => {
    expect(getDaysInMonth(2026, 1)).toBe(31);
  });
  it('returns 28 for Feb non-leap', () => {
    expect(getDaysInMonth(2026, 2)).toBe(28);
  });
  it('returns 29 for Feb leap year', () => {
    expect(getDaysInMonth(2024, 2)).toBe(29);
  });
  it('returns 30 for April', () => {
    expect(getDaysInMonth(2026, 4)).toBe(30);
  });
});

describe('getMonthName', () => {
  it('maps 1-12 to Jan-Dec', () => {
    expect(getMonthName(1)).toBe('Jan');
    expect(getMonthName(3)).toBe('Mar');
    expect(getMonthName(12)).toBe('Dec');
  });
});

describe('dateForDay', () => {
  it('formats day with leading zero', () => {
    expect(dateForDay(5, 2026, 3)).toBe('05-Mar-2026');
  });
  it('leaves two-digit day unpadded beyond pad', () => {
    expect(dateForDay(15, 2026, 11)).toBe('15-Nov-2026');
  });
});

describe('toDateStr', () => {
  it('returns null for null/empty', () => {
    expect(toDateStr(null, 2026, 3)).toBeNull();
    expect(toDateStr('', 2026, 3)).toBeNull();
    expect(toDateStr(undefined, 2026, 3)).toBeNull();
  });

  it('formats JS Date objects using UTC', () => {
    const d = new Date(Date.UTC(2026, 2, 15));
    expect(toDateStr(d, 2026, 3)).toBe('15-Mar-2026');
  });

  it('treats numeric 1-31 as a day-of-billing-month', () => {
    expect(toDateStr(5, 2026, 3)).toBe('05-Mar-2026');
    expect(toDateStr(31, 2026, 3)).toBe('31-Mar-2026');
    expect(toDateStr('12', 2026, 3)).toBe('12-Mar-2026');
  });

  it('returns null for day-only input with no billing context', () => {
    expect(toDateStr(5)).toBeNull();
  });

  it('treats Excel serial dates (>40000) as serial days', () => {
    expect(toDateStr(45382, 2026, 3)).toBe('31-Mar-2024');
  });

  it('returns null for out-of-range numeric values', () => {
    expect(toDateStr(35, 2026, 3)).toBeNull();
    expect(toDateStr(1000, 2026, 3)).toBeNull();
  });

  it('parses "dd-Mmm-yyyy" strings', () => {
    expect(toDateStr('15-Mar-2026')).toBe('15-Mar-2026');
    expect(toDateStr('1-mar-2026')).toBe('01-Mar-2026');
  });

  it('parses "dd-Mmm-yy" strings as 20xx', () => {
    expect(toDateStr('15-Mar-26')).toBe('15-Mar-2026');
  });

  it('parses dd/mm/yyyy and dd-mm-yyyy strings', () => {
    expect(toDateStr('15/03/2026')).toBe('15-Mar-2026');
    expect(toDateStr('15-03-2026')).toBe('15-Mar-2026');
    expect(toDateStr('15.03.2026')).toBe('15-Mar-2026');
  });

  it('parses yyyy/mm/dd strings', () => {
    expect(toDateStr('2026-03-15')).toBe('15-Mar-2026');
    expect(toDateStr('2026/3/5')).toBe('05-Mar-2026');
  });

  it('strips spaces that PDFs introduce', () => {
    expect(toDateStr('04- 03- 2026')).toBe('04-Mar-2026');
    expect(toDateStr(' 15 - Mar - 2026 ')).toBe('15-Mar-2026');
  });

  it('returns null for invalid month numbers', () => {
    expect(toDateStr('15-13-2026')).toBeNull();
    expect(toDateStr('15/00/2026')).toBeNull();
  });

  it('returns null for garbage strings', () => {
    expect(toDateStr('hello')).toBeNull();
    expect(toDateStr('not-a-date-string')).toBeNull();
  });
});

describe('parseDate', () => {
  it('round-trips a dd-Mmm-yyyy string to a Date', () => {
    const d = parseDate('15-Mar-2026');
    expect(d).not.toBeNull();
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(15);
  });

  it('is case-insensitive on month', () => {
    const d = parseDate('15-mar-2026');
    expect(d.getMonth()).toBe(2);
  });

  it('returns null for invalid format', () => {
    expect(parseDate(null)).toBeNull();
    expect(parseDate('')).toBeNull();
    expect(parseDate('not a date')).toBeNull();
    expect(parseDate('15/03/2026')).toBeNull();
  });

  it('returns null for unknown month abbreviation', () => {
    expect(parseDate('15-Xyz-2026')).toBeNull();
  });
});
