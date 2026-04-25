import { describe, it, expect } from 'vitest';
import { autoMapHeaders, detectUnnamedTextColumns } from '../src/mapping.js';

describe('autoMapHeaders', () => {
  it('maps a canonical Abraj header row', () => {
    const headers = [
      'Date', 'Operating', 'Reduced', 'Breakdown', 'Special',
      'Force Maj', 'Zero Rate', 'Standby', 'Repair', 'Rig Move',
      'Total Hrs', 'OBM Oper', 'OBM Red', 'OBM BD', 'OBM Spe', 'OBM Zero',
      'Operation', 'Hours Repair', 'Remarks',
    ];
    const map = autoMapHeaders(headers);
    expect(map.date).toBe(0);
    expect(map.operating).toBe(1);
    expect(map.reduced).toBe(2);
    expect(map.breakdown).toBe(3);
    expect(map.special).toBe(4);
    expect(map.force_maj).toBe(5);
    expect(map.zero_rate).toBe(6);
    expect(map.standby).toBe(7);
    expect(map.rig_move).toBe(9);
    expect(map.total_hrs).toBe(10);
    expect(map.obm_oper).toBe(11);
    expect(map.obm_red).toBe(12);
    expect(map.obm_bd).toBe(13);
    expect(map.obm_spe).toBe(14);
    expect(map.obm_zero).toBe(15);
    expect(map.operation).toBe(16);
    expect(map.total_hrs_repair).toBe(17);
    expect(map.remarks).toBe(18);
  });

  it('does not confuse "Remarks on Reduce Rate" with reduced', () => {
    // This is the bug fix that the inline comment on line 563 calls out.
    const headers = ['Date', 'Remarks on Reduce Rate', 'Reduced Rate'];
    const map = autoMapHeaders(headers);
    expect(map.remarks).toBe(1);
    expect(map.reduced).toBe(2);
  });

  it('maps Rig 305 full BP schema — MOVING + RIG MOVE both → rig_move (sum)', () => {
    const headers = ['DATE', 'MOVING', 'OPERATING', 'PREVENTIVE', 'RAPAIR', 'RIG MOVE-', 'STANDBY', 'ZERO', 'TOTAL', 'DESCRIPTION'];
    const map = autoMapHeaders(headers);
    expect(map.date).toBe(0);
    expect(map.rig_move).toEqual([1, 5]); // MOVING (col 1) + RIG MOVE- (col 5)
    expect(map.operating).toBe(2);
    expect(map.repair).toEqual([3, 4]);   // PREVENTIVE + RAPAIR
    expect(map.standby).toBe(6);
    expect(map.zero_rate).toBe(7);
    expect(map.total_hrs).toBe(8);
    expect(map.operation).toBe(9);
  });

  it('maps BP/KZN PDF schema — PREVENTIVE + RAPAIR both → repair (sum)', () => {
    const headers = ['DATE', 'OPERATING', 'PREVENTIVE', 'RAPAIR', 'STANDBY', 'TOTAL', 'DESCRIPTION'];
    const map = autoMapHeaders(headers);
    expect(map.date).toBe(0);
    expect(map.operating).toBe(1);
    // Both PREVENTIVE (col 2) and RAPAIR (col 3) collapse into repair
    expect(map.repair).toEqual([2, 3]);
    expect(map.standby).toBe(4);
    expect(map.total_hrs).toBe(5);
    expect(map.operation).toBe(6);
  });

  it('falls back bare "OBM" column to obm_oper (Rigs 104, 202, 208)', () => {
    const headers = ['Date', 'Operating', 'OBM', 'Reduced', 'Total'];
    const map = autoMapHeaders(headers);
    expect(map.obm_oper).toBe(2);
  });

  it('accumulates multiple bare "OBM" columns into obm_oper (Rig 304 schema)', () => {
    const headers = ['DATE', 'BREAKDOWN', 'OBM', 'OBM', 'OBM', 'OPERATING', 'REDUCED', 'TOTAL', 'DESCRIPTION'];
    const map = autoMapHeaders(headers);
    expect(map.obm_oper).toEqual([2, 3, 4]);
    expect(map.breakdown).toBe(1);
    expect(map.operating).toBe(5);
    expect(map.reduced).toBe(6);
  });

  it('keeps explicit OBM sub-categories (does not collide with bare-OBM fallback)', () => {
    const headers = ['Date', 'Operating', 'OBM Oper', 'OBM Red', 'OBM BD', 'OBM Spe', 'OBM Zero'];
    const map = autoMapHeaders(headers);
    expect(map.obm_oper).toBe(2);  // single, from explicit "OBM Oper"
    expect(map.obm_red).toBe(3);
    expect(map.obm_bd).toBe(4);
    expect(map.obm_spe).toBe(5);
    expect(map.obm_zero).toBe(6);
  });

  it('maps Medco/YASMEEN schema — EQUIPMENT → repair, OPERATION → operating', () => {
    const headers = ['DATE', 'EQUIPMENT', 'OPERATION', 'STAND', 'TOTAL', 'DESCRIPTION'];
    const map = autoMapHeaders(headers);
    expect(map.date).toBe(0);
    expect(map.repair).toBe(1);        // EQUIPMENT → repair (per ops team)
    expect(map.operating).toBe(2);     // OPERATION (numeric, post-pass swap)
    expect(map.standby).toBe(3);       // STAND → standby
    expect(map.total_hrs).toBe(4);
    expect(map.operation).toBe(5);     // DESCRIPTION → operation (text)
  });

  it('does not confuse "Operations Summary" with operating', () => {
    const headers = ['Date', 'Operations Summary', 'Operating'];
    const map = autoMapHeaders(headers);
    expect(map.operation).toBe(1);
    expect(map.operating).toBe(2);
  });

  it('handles PDF-introduced spaces inside "operatin g"', () => {
    const headers = ['Date', 'operatin g'];
    const map = autoMapHeaders(headers);
    expect(map.operating).toBe(1);
  });

  it('handles the "0peration.hrs" OCR-style typo', () => {
    const headers = ['Date', '0peration.Hrs'];
    const map = autoMapHeaders(headers);
    expect(map.operating).toBe(1);
  });

  it('maps "Hours" alone as total_hrs', () => {
    const headers = ['Date', 'Operating', 'Hours'];
    const map = autoMapHeaders(headers);
    expect(map.total_hrs).toBe(2);
  });

  it('does not map OBM-prefixed columns to plain categories', () => {
    const headers = ['Date', 'OBM Reduced', 'OBM Breakdown', 'OBM Zero', 'OBM Special'];
    const map = autoMapHeaders(headers);
    expect(map.reduced).toBeUndefined();
    expect(map.breakdown).toBeUndefined();
    expect(map.zero_rate).toBeUndefined();
    expect(map.special).toBeUndefined();
    expect(map.obm_red).toBe(1);
    expect(map.obm_bd).toBe(2);
    expect(map.obm_zero).toBe(3);
    expect(map.obm_spe).toBe(4);
  });

  it('maps rig move across variant spellings', () => {
    expect(autoMapHeaders(['Date', 'Rig Move']).rig_move).toBe(1);
    expect(autoMapHeaders(['Date', 'RigMove']).rig_move).toBe(1);
    expect(autoMapHeaders(['Date', 'Move Stat']).rig_move).toBe(1);
  });

  it('skips empty header cells', () => {
    const map = autoMapHeaders(['Date', '', null, 'Operating']);
    expect(map.date).toBe(0);
    expect(map.operating).toBe(3);
  });

  it('returns an empty map for a row with no recognised headers', () => {
    const map = autoMapHeaders(['foo', 'bar', 'baz']);
    expect(map).toEqual({});
  });
});

describe('detectUnnamedTextColumns', () => {
  it('finds an unnamed column with long text and writes it as operation', () => {
    const map = { date: 0, operating: 1 };
    const rawData = [
      ['Date', 'Oper', 'X'],
      ['1', '12', 'Drilling 12.25" hole to 2500m with BHA #3'],
      ['2', '12', 'Tripping out of hole to inspect bit'],
      ['3', '12', 'Running casing and circulating mud'],
    ];
    const result = detectUnnamedTextColumns(map, rawData, 0);
    expect(result.operation).toBe(2);
  });

  it('does not touch an already-mapped operation column', () => {
    const map = { date: 0, operating: 1, operation: 5 };
    const rawData = [['Date', 'Oper', 'X'], ['1', '12', 'Long long long text here']];
    const result = detectUnnamedTextColumns(map, rawData, 0);
    expect(result.operation).toBe(5);
  });

  it('skips columns already mapped in the map', () => {
    const map = { date: 0, operating: 1, remarks: 2 };
    const rawData = [
      ['Date', 'Oper', 'Remarks'],
      ['1', '12', 'Remarks text that is long enough to be operation'],
    ];
    const result = detectUnnamedTextColumns(map, rawData, 0);
    // Remarks column is already claimed, so operation should not be set to it
    expect(result.operation).toBeUndefined();
  });

  it('is a no-op when headerRow is -1', () => {
    const map = { date: 0 };
    const result = detectUnnamedTextColumns(map, [], -1);
    expect(result).toEqual({ date: 0 });
  });

  it('ignores short text (<=15 chars)', () => {
    const map = { date: 0 };
    const rawData = [
      ['Date', 'X'],
      ['1', 'short'],
      ['2', 'also short'],
    ];
    const result = detectUnnamedTextColumns(map, rawData, 0);
    expect(result.operation).toBeUndefined();
  });
});
