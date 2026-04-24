import { describe, it, expect } from 'vitest';
import { findHeaderRow, isFooterRow, classifyRows, detectMeta } from '../src/detection.js';

describe('findHeaderRow', () => {
  it('returns -1 when no row has "date"', () => {
    const data = [
      ['some', 'top', 'info'],
      ['more', 'stuff'],
    ];
    expect(findHeaderRow(data)).toBe(-1);
  });

  it('finds the row with the most billing keywords', () => {
    const data = [
      ['Rig 204'],
      ['Contract #', 'XYZ-123'],
      ['Date', 'Oper', 'Reduced', 'Breakdown', 'Total Hrs', 'Operation'],
      ['15-Mar-2026', '24', '0', '0', '24', 'Drilling'],
    ];
    expect(findHeaderRow(data)).toBe(2);
  });

  it('prefers a richer billing header over a lone "Date" row', () => {
    const data = [
      ['Rig 204'],
      ['Date'],
      ['Date', 'Operating', 'Reduced', 'Breakdown', 'Total Hrs'],
    ];
    expect(findHeaderRow(data)).toBe(2);
  });

  it('only looks at the first 25 rows', () => {
    const data = Array.from({ length: 40 }, () => ['padding']);
    data[30] = ['Date', 'Operating', 'Reduced', 'Breakdown', 'Total Hrs'];
    expect(findHeaderRow(data)).toBe(-1);
  });

  it('handles rows with multi-line header cells', () => {
    const data = [
      ['Date\n(dd/mm)', 'Operating\nHrs', 'Reduced\nRate', 'Breakdown'],
    ];
    expect(findHeaderRow(data)).toBe(0);
  });
});

describe('isFooterRow', () => {
  it('matches rows starting with common summary labels', () => {
    expect(isFooterRow(['Total', '24'], 0)).toBe(true);
    expect(isFooterRow(['Hrs:', '720'], 0)).toBe(true);
    expect(isFooterRow(['Days', '30'], 0)).toBe(true);
    expect(isFooterRow(['Subtotal', '...'], 0)).toBe(true);
    expect(isFooterRow(['Net Total', '...'], 0)).toBe(true);
    expect(isFooterRow(['Abraj Energy', '...'], 0)).toBe(true);
    expect(isFooterRow(['Client signature'], 0)).toBe(true);
  });

  it('does not match data rows with numbers or dates', () => {
    expect(isFooterRow(['15-Mar-2026', '24'], 0)).toBe(false);
    expect(isFooterRow(['15', '12'], 0)).toBe(false);
  });

  it('does not false-fire on "Rate changed..." in col 0 thanks to the word-boundary', () => {
    expect(isFooterRow(['Rate changed during shift'], 0)).toBe(false);
  });

  it('handles null row gracefully', () => {
    expect(isFooterRow(null, 0)).toBe(false);
  });

  it('falls back to column 0 when the dateCol cell is empty', () => {
    expect(isFooterRow(['Total', '', ''], 2)).toBe(true);
  });
});

describe('classifyRows', () => {
  it('identifies data end at the footer row', () => {
    const data = [
      ['Rig 204'],
      ['Date', 'Operating', 'Total Hrs'],
      ['15-Mar-2026', 24, 24],
      ['16-Mar-2026', 22, 22],
      ['Total', 46, 46],
      ['some footer'],
    ];
    const sections = classifyRows(data, 1);
    expect(sections.tableHeader).toBe(1);
    expect(sections.dataStart).toBe(2);
    expect(sections.dataEnd).toBe(3);
    expect(sections.footerStart).toBe(4);
  });

  it('identifies dateCol from the header row', () => {
    const data = [
      ['', 'Date', 'Operating'],
      ['', '15-Mar-2026', 24],
    ];
    const sections = classifyRows(data, 0);
    expect(sections.dateCol).toBe(1);
  });

  it('uses last row as dataEnd if no footer is found', () => {
    const data = [
      ['Date', 'Operating'],
      ['15-Mar-2026', 24],
      ['16-Mar-2026', 24],
    ];
    const sections = classifyRows(data, 0);
    expect(sections.dataEnd).toBe(2);
  });
});

describe('detectMeta', () => {
  it('extracts customer PDO from header rows', () => {
    const data = [
      ['Abraj Energy — PDO Monthly Billing'],
      ['Date', 'Operating'],
    ];
    const meta = detectMeta(data, 1);
    expect(meta.cust).toBe('PDO');
  });

  it('picks up OXY with word boundaries, not inside "Oxygen"', () => {
    const data = [
      ['Customer: OXY'],
      ['Date', 'Operating'],
    ];
    expect(detectMeta(data, 1).cust).toBe('OXY');
  });

  it('captures well from "Well:" label', () => {
    const data = [
      ['Well:', 'AMAL-42'],
      ['Date', 'Operating'],
    ];
    const meta = detectMeta(data, 1);
    expect(meta.well).toBe('AMAL-42');
  });

  it('captures contract and P.O values', () => {
    const data = [
      ['Contract No:', 'C-12345', 'P.O:', 'PO-98765'],
      ['Date', 'Operating'],
    ];
    const meta = detectMeta(data, 1);
    expect(meta.contract).toBe('C-12345');
    expect(meta.po).toBe('PO-98765');
  });

  it('returns empty meta when nothing is detected', () => {
    const data = [['some random'], ['Date', 'Operating']];
    const meta = detectMeta(data, 1);
    expect(meta).toEqual({ rig: '', cust: '', well: '', contract: '', po: '' });
  });

  it('skips an adjacent cell that matches contract/PO labels when resolving well', () => {
    // If row[c+1] looks like another label, it should be skipped and the next cell used instead.
    const data = [
      ['Well:', 'Contract No:', 'C-1'],
      ['Date', 'Operating'],
    ];
    const meta = detectMeta(data, 1);
    // Current behavior: skips 'Contract No:' (matches the exclusion regex), then takes 'C-1'
    expect(meta.well).toBe('C-1');
  });
});
