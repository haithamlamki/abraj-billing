// OCR fallback for scanned PDFs.
//
// Wraps Tesseract.js (loaded as a CDN global) into two helpers:
//   - createOcrRunner(log) — factory returning { ocrPageToItems }, holds the
//     lazy worker so the ~15MB language data downloads only on first use
//   - ocrPageToItems(page, pageNum, scale?) — render a pdf.js page to canvas,
//     OCR it, and return word-level items with x/y coordinates remapped into
//     pdf.js coordinate space so the downstream column detector can ingest
//     them the same way it ingests embedded text items.
//
// The Tesseract global is read at call time (not at module import time) so
// the test environment doesn't need to stub it.

const TESSERACT_OPTS = {
  tessedit_pageseg_mode: '6',  // assume a single uniform block of text (table body)
  tessedit_char_whitelist:
    '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.,-/:# ',
  preserve_interword_spaces: '1',
};

/**
 * Build an OCR runner with a lazily-initialised Tesseract worker.
 *
 * @param {(msg: string, cls?: string) => void} [log] - optional progress logger
 * @returns {{ ocrPageToItems: (page: any, pageNum: number, scale?: number) => Promise<Array<{x:number,y:number,text:string,page:number}>>, getWorker: () => Promise<any> }}
 */
export function createOcrRunner(log = () => {}) {
  let worker = null;
  let lastProgress = null;

  async function getWorker() {
    if (worker) return worker;
    if (typeof Tesseract === 'undefined') {
      throw new Error('Tesseract.js not loaded (check CDN script tag)');
    }
    log('  Loading OCR engine (first run only; downloads ~15 MB language data)…', 'info');
    worker = await Tesseract.createWorker('eng', 1, {
      logger: m => {
        if (m.status === 'recognizing text' && m.progress > 0) {
          // Per-page progress; throttle via last-value guard
          if (lastProgress === null || Math.abs(m.progress - lastProgress) >= 0.2 || m.progress === 1) {
            lastProgress = m.progress;
            log(`    OCR: ${Math.round(m.progress * 100)}%`, 'info');
          }
        }
      },
    });
    return worker;
  }

  async function ocrPageToItems(page, pageNum, scale = 3.0) {
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    // White background helps OCR on transparent pages.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;

    const w = await getWorker();
    await w.setParameters(TESSERACT_OPTS);
    const { data } = await w.recognize(canvas, {}, { blocks: true, words: true });

    return mapTesseractWordsToPdfItems(data.words || [], scale, page.getViewport({ scale: 1 }).height, pageNum);
  }

  return { ocrPageToItems, getWorker };
}

/**
 * Convert Tesseract word bboxes (top-left origin, y grows down, scaled) into
 * pdf.js item coordinates (origin bottom-left, y grows up, unit scale). Pulled
 * out as a pure function so it can be unit-tested without a Tesseract worker.
 *
 * @param {Array<{text?: string, bbox?: {x0?: number, y0?: number}}>} words
 * @param {number} scale - the scale used when rendering the page
 * @param {number} pageHeightAtScale1 - page.getViewport({scale:1}).height
 * @param {number} pageNum
 */
export function mapTesseractWordsToPdfItems(words, scale, pageHeightAtScale1, pageNum) {
  const out = [];
  const unscale = 1 / scale;
  for (const w of words) {
    const text = (w.text || '').trim();
    if (!text) continue;
    const bbox = w.bbox || {};
    const x = Math.round((bbox.x0 || 0) * unscale);
    const yTop = (bbox.y0 || 0) * unscale;
    const y = Math.round(pageHeightAtScale1 - yTop);
    out.push({ x, y, text, page: pageNum });
  }
  return out;
}
