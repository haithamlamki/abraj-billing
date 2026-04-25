import { describe, it, expect } from 'vitest';
import { mapTesseractWordsToPdfItems, createOcrRunner } from '../src/pipeline/ocr.js';

describe('mapTesseractWordsToPdfItems', () => {
  it('flips y-axis (top-left → bottom-left) and un-scales x/y', () => {
    // Tesseract output at scale=3, page height at scale=1 is 800.
    // A word at top-left (5, 10) at scale 3 → x = 5/3 ≈ 2, y = 800 - 10/3 ≈ 797
    const items = mapTesseractWordsToPdfItems(
      [{ text: 'DATE', bbox: { x0: 6, y0: 12 } }],
      3,
      800,
      1,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({ x: 2, y: 796, text: 'DATE', page: 1 });
  });

  it('drops empty / whitespace-only words', () => {
    const items = mapTesseractWordsToPdfItems(
      [
        { text: 'A', bbox: { x0: 0, y0: 0 } },
        { text: '   ', bbox: { x0: 10, y0: 0 } },
        { text: '', bbox: { x0: 20, y0: 0 } },
        { text: null, bbox: { x0: 30, y0: 0 } },
        { text: 'B', bbox: { x0: 40, y0: 0 } },
      ],
      1, 100, 2,
    );
    expect(items.map(i => i.text)).toEqual(['A', 'B']);
    expect(items.every(i => i.page === 2)).toBe(true);
  });

  it('handles missing bbox gracefully (defaults to 0,0)', () => {
    const items = mapTesseractWordsToPdfItems([{ text: 'X' }], 1, 50, 1);
    expect(items[0]).toEqual({ x: 0, y: 50, text: 'X', page: 1 });
  });

  it('returns empty array on empty input', () => {
    expect(mapTesseractWordsToPdfItems([], 1, 100, 1)).toEqual([]);
  });
});

describe('createOcrRunner', () => {
  it('exposes ocrPageToItems and getWorker', () => {
    const r = createOcrRunner();
    expect(typeof r.ocrPageToItems).toBe('function');
    expect(typeof r.getWorker).toBe('function');
  });

  it('getWorker throws a clear error when Tesseract is not loaded', async () => {
    // In Node test env there's no Tesseract global — the error message should
    // point the user to the CDN script tag, not crash with a generic ReferenceError.
    const r = createOcrRunner();
    await expect(r.getWorker()).rejects.toThrow(/Tesseract\.js not loaded/);
  });
});
