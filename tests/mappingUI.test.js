import { describe, it, expect } from 'vitest';
import { buildColOptionsHTML, buildMappingItemHTML } from '../src/views/mappingUI.js';

// ─── buildColOptionsHTML ─────────────────────────────────────────────────────

describe('buildColOptionsHTML', () => {
  const hRow   = ['Date', 'Operating Hrs', 'Reduced Hrs', 'Breakdown Hrs', 'Total Hrs'];
  const rawRow = ['Date', 'Operating Hrs', 'Reduced Hrs', 'Breakdown Hrs', 'Total Hrs'];

  it('produces one <option> per header column', () => {
    const html = buildColOptionsHTML(hRow, rawRow);
    const count = (html.match(/<option /g) || []).length;
    expect(count).toBe(5);
  });

  it('includes "Col N:" prefix for each option', () => {
    const html = buildColOptionsHTML(hRow, rawRow);
    expect(html).toContain('Col 1:');
    expect(html).toContain('Col 5:');
  });

  it('uses rawRow label when hRow cell is empty', () => {
    const html = buildColOptionsHTML(['', 'Operating'], ['Date', '']);
    expect(html).toContain('Date');
    expect(html).toContain('Operating');
  });

  it('falls back to "(Col N)" when both rows are empty', () => {
    const html = buildColOptionsHTML(['', ''], ['', '']);
    expect(html).toContain('(Col 1)');
    expect(html).toContain('(Col 2)');
  });

  it('truncates header labels longer than 30 chars', () => {
    const longName = 'A'.repeat(35);
    const html = buildColOptionsHTML([longName], []);
    expect(html).toContain('A'.repeat(30) + '...');
    expect(html).not.toContain(longName);
  });

  it('caps header columns at 20', () => {
    const wide = Array.from({ length: 25 }, (_, i) => `H${i}`);
    const html = buildColOptionsHTML(wide, []);
    expect(html).toContain('Col 20:');
    expect(html).not.toContain('Col 21:');
  });

  it('adds "(no header)" entries from extraRow beyond header col count', () => {
    // hRow has 2 cols, extraRow has 4 cols → cols 3-4 added as "no header"
    const html = buildColOptionsHTML(['A', 'B'], [], ['v1', 'v2', 'v3', 'v4']);
    expect(html).toContain('(no header)');
    expect(html).toContain('Col 3:');
    expect(html).toContain('Col 4:');
  });

  it('returns empty string when both rows are empty arrays', () => {
    const html = buildColOptionsHTML([], []);
    expect(html).toBe('');
  });
});

// ─── buildMappingItemHTML ────────────────────────────────────────────────────

describe('buildMappingItemHTML', () => {
  const tc  = { key: 'operating', label: 'Operating Hrs' };
  const col = '<option value="1">Col 2: Operating</option>';

  it('includes the label text', () => {
    const html = buildMappingItemHTML(tc, col);
    expect(html).toContain('Operating Hrs');
  });

  it('includes id="sel-{key}"', () => {
    const html = buildMappingItemHTML(tc, col);
    expect(html).toContain('id="sel-operating"');
  });

  it('includes data-map-key attribute', () => {
    const html = buildMappingItemHTML(tc, col);
    expect(html).toContain('data-map-key="operating"');
  });

  it('includes the "not mapped" default option', () => {
    const html = buildMappingItemHTML(tc, col);
    expect(html).toContain('-- not mapped --');
    expect(html).toContain('value="-1"');
  });

  it('injects the supplied colOptions HTML', () => {
    const html = buildMappingItemHTML(tc, col);
    expect(html).toContain(col);
  });

  it('contains a <label> and a <select>', () => {
    const html = buildMappingItemHTML(tc, col);
    expect(html).toContain('<label>');
    expect(html).toContain('<select');
  });
});
