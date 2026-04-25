import { describe, it, expect, vi } from 'vitest';
import {
  detectScannedPage, groupItemsByY, findTableHeaderY,
  mergeHeaderColumns, assignItemsToColumns, extractItemsFromPage, parsePdfBuffer,
} from '../src/pipeline/parsePdf.js';

describe('detectScannedPage', () => {
  it('flags a totally empty page as scanned', () => {
    const r = detectScannedPage([]);
    expect(r.scanned).toBe(true);
  });

  it('flags sparse glyph-soup PDFs (lots of single chars)', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ str: String.fromCharCode(65 + (i % 5)) }));
    const r = detectScannedPage(items);
    expect(r.scanned).toBe(true); // < 30 trimmed AND avg length ~1
  });

  it('flags font-encoded scans (almost no real alphanumeric tokens)', () => {
    const items = Array.from({ length: 100 }, () => ({ str: '@' }));
    const r = detectScannedPage(items);
    expect(r.scanned).toBe(true);
  });

  it('treats a normal billing PDF page as NOT scanned', () => {
    const items = [
      { str: 'DATE' }, { str: 'OPERATING' }, { str: 'BREAKDOWN' }, { str: 'TOTAL' },
      { str: '01-Feb-2026' }, { str: '24' }, { str: '0' }, { str: '24' },
      { str: '02-Feb-2026' }, { str: '23' }, { str: '1' }, { str: '24' },
      ...Array.from({ length: 30 }, () => ({ str: 'drilling ahead' })),
    ];
    const r = detectScannedPage(items);
    expect(r.scanned).toBe(false);
  });
});

describe('groupItemsByY', () => {
  it('puts items with close Y values in the same group', () => {
    const items = [
      { x: 10, y: 100, text: 'A' },
      { x: 50, y: 102, text: 'B' }, // within tolerance
      { x: 10, y: 80,  text: 'C' }, // separate row
      { x: 50, y: 81,  text: 'D' },
    ];
    const { yGroups, sortedYs } = groupItemsByY(items, 3);
    expect(sortedYs).toEqual([100, 80]); // top to bottom (descending in PDF coords)
    expect(yGroups[100]).toHaveLength(2);
    expect(yGroups[80]).toHaveLength(2);
  });

  it('is the identity when all Ys are unique and far apart', () => {
    const items = [
      { x: 0, y: 100, text: 'A' },
      { x: 0, y: 50,  text: 'B' },
      { x: 0, y: 10,  text: 'C' },
    ];
    const { yGroups, sortedYs } = groupItemsByY(items);
    expect(sortedYs).toEqual([100, 50, 10]);
    expect(Object.values(yGroups).every(g => g.length === 1)).toBe(true);
  });
});

describe('findTableHeaderY', () => {
  it('finds the first row containing date + operating/total/hours', () => {
    const yGroups = {
      200: [{ text: 'Abraj Energy' }, { text: 'Billing Sheet' }],
      150: [{ text: 'Date' }, { text: 'Operating' }, { text: 'Total' }],
      100: [{ text: '01-Feb-2026' }, { text: '24' }],
    };
    expect(findTableHeaderY(yGroups, [200, 150, 100])).toBe(150);
  });

  it('returns null when no row qualifies', () => {
    const yGroups = {
      200: [{ text: 'Header' }],
      100: [{ text: 'Data' }],
    };
    expect(findTableHeaderY(yGroups, [200, 100])).toBeNull();
  });
});

describe('mergeHeaderColumns', () => {
  it('merges adjacent fragments into known header tokens', () => {
    // pdf.js often splits "Rig Move" into two items; should collapse.
    const items = [
      { x: 10, text: 'Date' },
      { x: 100, text: 'Operating' },
      { x: 200, text: 'Rig' },
      { x: 215, text: 'Move' }, // close enough to merge
    ];
    const cols = mergeHeaderColumns(items);
    expect(cols.map(c => c.text)).toEqual(['Date', 'Operating', 'RigMove']);
  });

  it('keeps distinct columns when the gap is wide and no token forms', () => {
    const items = [
      { x: 10, text: 'Date' },
      { x: 100, text: 'Operating' },
      { x: 200, text: 'Description' },
    ];
    const cols = mergeHeaderColumns(items);
    expect(cols.map(c => c.text)).toEqual(['Date', 'Operating', 'Description']);
  });
});

describe('assignItemsToColumns', () => {
  it('places each item in its nearest-x-to-the-left column slot', () => {
    const cols = [{ x: 10, text: 'Date' }, { x: 100, text: 'Operating' }, { x: 200, text: 'Total' }];
    const yGroups = {
      150: [
        { x: 10, text: '01-Feb' }, { x: 100, text: '24' }, { x: 200, text: '24' },
      ],
    };
    const rows = assignItemsToColumns(yGroups, [150], cols);
    expect(rows[0]).toEqual(['01-Feb', '24', '24']);
  });

  it('cleans up spaced numbers and dates (needs ≥3 columns to engage)', () => {
    const cols = [{ x: 10, text: 'Date' }, { x: 100, text: 'Operating' }, { x: 200, text: 'Total' }];
    const yGroups = {
      150: [
        { x: 10, text: '01' }, { x: 12, text: '-' }, { x: 14, text: '02' }, { x: 16, text: '-' }, { x: 18, text: '2026' },
        { x: 100, text: '12' }, { x: 105, text: '.' }, { x: 107, text: '5' },
        { x: 200, text: '24' },
      ],
    };
    const rows = assignItemsToColumns(yGroups, [150], cols);
    expect(rows[0][0]).toBe('01-02-2026');
    expect(rows[0][1]).toBe('12.5');
    expect(rows[0][2]).toBe('24');
  });

  it('falls back to flat item-text list when fewer than 3 columns detected', () => {
    const yGroups = { 150: [{ x: 0, text: 'foo' }, { x: 50, text: 'bar' }] };
    const rows = assignItemsToColumns(yGroups, [150], [{ x: 0, text: 'A' }, { x: 50, text: 'B' }]);
    expect(rows[0]).toEqual(['foo', 'bar']);
  });
});

describe('extractItemsFromPage', () => {
  it('returns items from the text layer when not scanned', async () => {
    const fakePage = {
      getTextContent: vi.fn().mockResolvedValue({
        items: Array.from({ length: 40 }, (_, i) => ({
          str: 'word' + i,
          transform: [1, 0, 0, 1, 10 + i, 100],
        })),
      }),
    };
    const ocr = vi.fn();
    const { items, ocred } = await extractItemsFromPage(fakePage, 1, ocr, () => {});
    expect(ocred).toBe(false);
    expect(ocr).not.toHaveBeenCalled();
    expect(items.length).toBe(40);
    expect(items[0]).toMatchObject({ x: 10, y: 100, text: 'word0', page: 1 });
  });

  it('falls back to OCR when the text layer looks scanned', async () => {
    const fakePage = {
      getTextContent: vi.fn().mockResolvedValue({ items: [] }),
    };
    const ocr = vi.fn().mockResolvedValue([{ x: 5, y: 50, text: 'OCR', page: 1 }]);
    const { items, ocred } = await extractItemsFromPage(fakePage, 1, ocr, () => {});
    expect(ocred).toBe(true);
    expect(ocr).toHaveBeenCalledWith(fakePage, 1);
    expect(items).toHaveLength(1);
  });
});

describe('parsePdfBuffer (orchestration)', () => {
  it('builds a row grid from a fake one-page PDF with detectable header', async () => {
    // Need enough "real" alphanumeric tokens so detectScannedPage doesn't kick OCR in.
    const dataRows = [];
    for (let day = 1; day <= 28; day++) {
      const yRow = 150 - day * 5;
      dataRows.push(
        { str: `${String(day).padStart(2, '0')}-Feb-2026`, transform: [1, 0, 0, 1, 10, yRow] },
        { str: 'drilling', transform: [1, 0, 0, 1, 100, yRow] },
        { str: '24',       transform: [1, 0, 0, 1, 200, yRow] },
      );
    }
    const fakePdf = {
      numPages: 1,
      getPage: vi.fn().mockResolvedValue({
        getTextContent: vi.fn().mockResolvedValue({
          items: [
            { str: 'Date',      transform: [1,0,0,1,10,200] },
            { str: 'Operating', transform: [1,0,0,1,100,200] },
            { str: 'Total',     transform: [1,0,0,1,200,200] },
            ...dataRows,
          ],
        }),
      }),
    };
    const fakePdfjsLib = {
      getDocument: () => ({ promise: Promise.resolve(fakePdf) }),
    };
    const result = await parsePdfBuffer(new ArrayBuffer(0), {
      pdfjsLib: fakePdfjsLib,
      ocrPageToItems: vi.fn(),
      log: () => {},
    });
    expect(result.headerFound).toBe(true);
    expect(result.columns.map(c => c.text)).toEqual(['Date', 'Operating', 'Total']);
    expect(result.rows.length).toBeGreaterThan(20); // header + 28 day rows
    expect(result.rows[1]).toEqual(['01-Feb-2026', 'drilling', '24']);
    expect(result.ocredPages).toBe(0);
  });

  it('returns empty rows + headerFound=false when the PDF has no extractable text', async () => {
    const fakePdf = {
      numPages: 1,
      getPage: vi.fn().mockResolvedValue({
        getTextContent: vi.fn().mockResolvedValue({ items: [] }),
      }),
    };
    const fakePdfjsLib = { getDocument: () => ({ promise: Promise.resolve(fakePdf) }) };
    const result = await parsePdfBuffer(new ArrayBuffer(0), {
      pdfjsLib: fakePdfjsLib,
      ocrPageToItems: vi.fn().mockResolvedValue([]), // OCR also returns nothing
      log: () => {},
    });
    expect(result.rows).toEqual([]);
    expect(result.headerFound).toBe(false);
    expect(result.ocredPages).toBe(1);
  });
});
