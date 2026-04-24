import puppeteer from 'puppeteer';

const URL = process.env.URL || 'http://localhost:5173/';
const PDF = process.env.PDF || '/Users/prophones/Downloads/mar.2026/3.2026/New Folder With Items/210_2.pdf';

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 2 });

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 2000));

// Read the PDF from disk into the browser page context, run pdf.js + Tesseract, return raw text.
const fileBase64 = (await import('node:fs')).readFileSync(PDF).toString('base64');

const raw = await page.evaluate(async (b64) => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const allWords = [];
  const worker = await Tesseract.createWorker('eng', 1);
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    const { data } = await worker.recognize(canvas, {}, { text: true, words: true });
    allWords.push({ page: p, text: data.text, words: (data.words || []).map(w => ({ text: w.text, bbox: w.bbox })) });
  }
  await worker.terminate();
  return allWords;
}, fileBase64);

for (const p of raw) {
  console.log(`\n===== PAGE ${p.page} — raw text (${p.words.length} words) =====`);
  console.log(p.text);
}

// Show words with bounding boxes, grouped by approximate row (y bucket = 20px)
for (const p of raw) {
  const buckets = {};
  for (const w of p.words) {
    if (!w.text.trim()) continue;
    const key = Math.round(w.bbox.y0 / 30) * 30;
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(w);
  }
  const rowKeys = Object.keys(buckets).map(Number).sort((a, b) => a - b);
  console.log(`\n===== PAGE ${p.page} — row-grouped (${rowKeys.length} rows) =====`);
  for (const k of rowKeys) {
    const row = buckets[k].sort((a, b) => a.bbox.x0 - b.bbox.x0);
    console.log(`y≈${k}: ${row.map(w => w.text).join(' | ')}`);
  }
}

await browser.close();
