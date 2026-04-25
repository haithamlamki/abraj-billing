import { describe, it, expect } from 'vitest';
import { chooseConflictRow } from '../src/pipeline/conflictResolver.js';

// ─── fixtures ────────────────────────────────────────────────────────────────

const pdfNew = {
  newSource:      'PDF (approved)',
  newRow:         { date: '01-Feb-2026', operating: 22, total_hrs: 22 },
  existingSource: 'Excel',
  existing:       { date: '01-Feb-2026', operating: 20, total_hrs: 20 },
};

const pdfExisting = {
  newSource:      'Excel',
  newRow:         { date: '02-Feb-2026', operating: 18, total_hrs: 18 },
  existingSource: 'PDF (approved)',
  existing:       { date: '02-Feb-2026', operating: 24, total_hrs: 24 },
};

const excelNew = {
  newSource:      'Excel',
  newRow:         { date: '03-Feb-2026', operating: 20, total_hrs: 20 },
  existingSource: 'PDF (approved)',
  existing:       { date: '03-Feb-2026', operating: 22, total_hrs: 22 },
};

// ─── pdf strategy ────────────────────────────────────────────────────────────

describe('chooseConflictRow — pdf strategy', () => {
  it('picks newRow when newSource contains PDF', () => {
    const r = chooseConflictRow(pdfNew, 'pdf');
    expect(r).not.toBeNull();
    expect(r.row).toBe(pdfNew.newRow);
    expect(r.source).toBe('PDF');
  });

  it('picks existing when existingSource contains PDF', () => {
    const r = chooseConflictRow(pdfExisting, 'pdf');
    expect(r).not.toBeNull();
    expect(r.row).toBe(pdfExisting.existing);
    expect(r.source).toBe('PDF');
  });

  it('returns null when neither source is PDF', () => {
    const c = { newSource: 'Excel', existingSource: 'Excel', newRow: {}, existing: {} };
    expect(chooseConflictRow(c, 'pdf')).toBeNull();
  });
});

// ─── excel strategy ───────────────────────────────────────────────────────────

describe('chooseConflictRow — excel strategy', () => {
  it('picks newRow when newSource is Excel', () => {
    const r = chooseConflictRow(excelNew, 'excel');
    expect(r).not.toBeNull();
    expect(r.row).toBe(excelNew.newRow);
    expect(r.source).toBe('Excel');
  });

  it('picks existing when existingSource is Excel', () => {
    const r = chooseConflictRow(pdfNew, 'excel');
    expect(r).not.toBeNull();
    expect(r.row).toBe(pdfNew.existing);
    expect(r.source).toBe('Excel');
  });

  it('returns null when neither source is Excel', () => {
    const c = { newSource: 'PDF', existingSource: 'PDF', newRow: {}, existing: {} };
    expect(chooseConflictRow(c, 'excel')).toBeNull();
  });
});

// ─── other strategies ────────────────────────────────────────────────────────

describe('chooseConflictRow — manual / merge', () => {
  it('returns null for "manual" strategy', () => {
    expect(chooseConflictRow(pdfNew, 'manual')).toBeNull();
  });

  it('returns null for "merge" strategy', () => {
    expect(chooseConflictRow(pdfNew, 'merge')).toBeNull();
  });

  it('handles missing source fields gracefully', () => {
    const c = { newRow: {}, existing: {} }; // no source fields
    expect(chooseConflictRow(c, 'pdf')).toBeNull();
    expect(chooseConflictRow(c, 'excel')).toBeNull();
  });
});
