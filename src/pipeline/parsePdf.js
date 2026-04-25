// PDF text-layer extraction → row/column grid.
//
// The orchestrator `parsePdfBuffer` takes a raw ArrayBuffer + dependencies
// (pdfjsLib, ocrPageToItems, log) and returns a 2D grid that downstream code
// (extractRows / autoMapHeaders) can ingest as if it were an Excel sheet.
//
// The grid-building helpers (groupItemsByY, findTableHeaderY,
// mergeHeaderColumns, assignItemsToColumns) are pure and unit-tested
// independently of pdf.js / OCR.

const KNOWN_HEADER_TOKEN = /^(date|operating|reduced|breakdown|special|rigmove|rig move|total|hours|description|statistical|rate|zero|force|standby|repair|obm|upgrade|sbm)$/i;

/**
 * "Scanned-PDF" heuristic. Triggers OCR when text-layer extraction looks
 * unusable:
 *   - completely empty → certainly scanned
 *   - very sparse (< 30 items) AND average token length < 3 chars → forms/scans
 *   - very few alphanumeric "real" tokens → custom-encoded font (glyph soup)
 *
 * @param {Array<{str?: string}>} textItems
 * @returns {{ scanned: boolean, trimmedCount: number, realTokenCount: number }}
 */
export function detectScannedPage(textItems) {
  const trimmed = textItems.map(it => (it.str || '').trim()).filter(Boolean);
  const realTokens = trimmed.filter(t => /[a-zA-Z0-9]{3,}/.test(t));
  const avgLen = trimmed.length ? trimmed.reduce((s, t) => s + t.length, 0) / trimmed.length : 0;
  const scanned =
    textItems.length === 0
    || (trimmed.length < 30 && avgLen < 3)
    || (trimmed.length > 0 && realTokens.length < Math.max(5, trimmed.length * 0.1));
  return { scanned, trimmedCount: trimmed.length, realTokenCount: realTokens.length };
}

/**
 * Group items into rows by Y-coordinate, with a small tolerance to merge items
 * whose baselines drift by a couple of points. Returns the groups keyed by the
 * first Y seen for each band, plus the sorted Y list (top to bottom in pdf.js
 * coords, which means descending numerically).
 *
 * @param {Array<{x:number,y:number,text:string,page?:number}>} items
 * @param {number} [tolerance=3]
 * @returns {{ yGroups: Object<string, Array>, sortedYs: number[] }}
 */
export function groupItemsByY(items, tolerance = 3) {
  const yGroups = {};
  for (const item of items) {
    let foundY = null;
    for (const yk of Object.keys(yGroups)) {
      if (Math.abs(Number(yk) - item.y) <= tolerance) { foundY = yk; break; }
    }
    const key = foundY || item.y;
    if (!yGroups[key]) yGroups[key] = [];
    yGroups[key].push(item);
  }
  const sortedYs = Object.keys(yGroups).map(Number).sort((a, b) => b - a);
  return { yGroups, sortedYs };
}

/**
 * Locate the row that looks like the column header. Heuristic: contains
 * "date" + at least one of operat/total/hours.
 *
 * @returns {number | null} - the y-key of the header row, or null if missing
 */
export function findTableHeaderY(yGroups, sortedYs) {
  for (const y of sortedYs) {
    const rowText = yGroups[y].map(i => i.text).join(' ').toLowerCase();
    if (/\bdate\b/.test(rowText) && /operat|total|hours/.test(rowText)) {
      return y;
    }
  }
  return null;
}

/**
 * Reconstruct multi-token column headers split by pdf.js. Adjacent items merge
 * when:
 *   - they form a known header token together (e.g. "Rig" + "Move" → "RigMove")
 *   - the next item is a fragment (≤ 2 chars after stripping)
 *   - the gap between items is < 15 px (tight wrap)
 *
 * Returns the column anchors as [{ x, text }, …] sorted left-to-right.
 */
export function mergeHeaderColumns(headerItems, gapThreshold = 15) {
  const sorted = [...headerItems].sort((a, b) => a.x - b.x);
  const cols = [];
  for (const item of sorted) {
    const prev = cols.length > 0 ? cols[cols.length - 1] : null;
    if (prev) {
      const gap = item.x - prev.x;
      const merged = (prev.text + item.text).replace(/[\s\-]/g, '');
      const formsKnown = KNOWN_HEADER_TOKEN.test(merged);
      const isFragment = item.text.replace(/[\s.\-]/g, '').length <= 2;
      const isTiny = gap < gapThreshold;
      if (formsKnown || isFragment || isTiny) {
        prev.text += item.text;
        continue;
      }
    }
    cols.push({ x: item.x, text: item.text });
  }
  return cols;
}

/**
 * Drop each item into its column slot by nearest-x-to-the-left. Cleans up
 * inadvertently spaced numbers (e.g. "12 .5" → "12.5") and dates (e.g.
 * "01 - 02 - 2026" → "01-02-2026").
 *
 * If fewer than 3 columns were detected, falls back to dumping items in
 * left-to-right order (the autoMap downstream may still salvage it).
 */
export function assignItemsToColumns(yGroups, sortedYs, colXs) {
  const allRows = [];
  for (const y of sortedYs) {
    const items = [...yGroups[y]].sort((a, b) => a.x - b.x);
    if (colXs.length >= 3) {
      const row = new Array(colXs.length).fill('');
      for (const item of items) {
        let col = 0;
        for (let c = colXs.length - 1; c >= 0; c--) {
          if (item.x >= colXs[c].x - 10) { col = c; break; }
        }
        row[col] = (row[col] ? row[col] + ' ' : '') + item.text;
      }
      for (let c = 0; c < row.length; c++) {
        if (!row[c]) continue;
        const cleaned = row[c].replace(/\s+/g, '');
        if (/^\d+\.?\d*$/.test(cleaned) && row[c].includes(' ')) {
          row[c] = cleaned;
        }
        if (/^\d{1,2}\s*-\s*\d{1,2}\s*-\s*\d{4}$/.test(row[c])) {
          row[c] = row[c].replace(/\s+/g, '');
        }
      }
      allRows.push(row);
    } else {
      allRows.push(items.map(i => i.text));
    }
  }
  return allRows;
}

/**
 * Pull text items out of a single pdf.js page, falling back to OCR when the
 * page looks scanned. Returns both the items and an `ocred` flag for caller
 * accounting. Side-effects: logging only.
 */
export async function extractItemsFromPage(page, pageNum, ocrPageToItems, log) {
  const tc = await page.getTextContent();
  const textItems = tc.items || [];
  const probe = detectScannedPage(textItems);

  if (probe.scanned) {
    const reason = textItems.length === 0
      ? 'no embedded text'
      : `${probe.trimmedCount} weak tokens (${probe.realTokenCount} real)`;
    log(`  Page ${pageNum}: ${reason}, running OCR…`, 'info');
    const ocrItems = await ocrPageToItems(page, pageNum);
    log(`  Page ${pageNum}: OCR extracted ${ocrItems.length} words`, 'info');
    return { items: ocrItems, ocred: true };
  }

  const items = [];
  for (const item of textItems) {
    const text = (item.str || '').trim();
    if (!text) continue;
    items.push({
      x: Math.round(item.transform[4]),
      y: Math.round(item.transform[5]),
      text,
      page: pageNum,
    });
  }
  return { items, ocred: false };
}

/**
 * Top-level orchestrator. Loads the PDF, walks every page, builds the
 * row/column grid, and returns it. Throws on pdf.js load failure (caller
 * decides how to surface the error).
 *
 * @param {ArrayBuffer} buf
 * @param {{ pdfjsLib: any, ocrPageToItems: Function, log?: Function }} deps
 * @returns {Promise<{ rows: string[][], columns: Array<{x:number,text:string}>, ocredPages: number, headerFound: boolean }>}
 */
export async function parsePdfBuffer(buf, { pdfjsLib, ocrPageToItems, log = () => {} }) {
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const allItems = [];
  let ocredPages = 0;

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const { items, ocred } = await extractItemsFromPage(page, p, ocrPageToItems, log);
    if (ocred) ocredPages++;
    allItems.push(...items);
  }

  if (ocredPages > 0) log(`  OCR complete for ${ocredPages} page(s)`, 'ok');

  if (allItems.length === 0) {
    return { rows: [], columns: [], ocredPages, headerFound: false };
  }

  const { yGroups, sortedYs } = groupItemsByY(allItems);
  const headerY = findTableHeaderY(yGroups, sortedYs);

  let colXs = [];
  if (headerY !== null) {
    colXs = mergeHeaderColumns(yGroups[headerY]);
    log(`  PDF columns after merge: ${colXs.map(c => c.text).join(' | ')}`, 'info');
  }

  const rows = assignItemsToColumns(yGroups, sortedYs, colXs);
  return { rows, columns: colXs, ocredPages, headerFound: headerY !== null };
}
