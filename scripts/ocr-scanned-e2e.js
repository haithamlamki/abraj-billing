import puppeteer from 'puppeteer';

const URL = process.env.URL || 'http://localhost:5173/';
const PDF = process.env.PDF || '/Users/prophones/Downloads/mar.2026/3.2026/New Folder With Items/210_2.pdf';

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 2 });
page.on('dialog', async d => { await d.accept(); });

const errors = [];
const EXPECTED = /ALL_RIGS\.xlsx|Failed to load resource/;
page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));
page.on('console', msg => {
  const t = msg.text();
  if (msg.type() === 'error' && !EXPECTED.test(t)) errors.push(`console.error: ${t}`);
});

// Stream the app's log panel to stdout
await page.exposeFunction('logFromPage', (line) => console.log('  [app]', line));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 2000));

// Poll the LAST log line every 2s instead of streaming all (log() does innerHTML +=, re-creates nodes)
let __lastLine = '';
const pollLog = async () => {
  const line = await page.evaluate(() => document.querySelector('#logEl .log-line:last-child')?.textContent || '');
  if (line && line !== __lastLine) {
    console.log('  [app]', line);
    __lastLine = line;
  }
};

// Align period to March 2026 (the fixture's month)
await page.select('#monthSelect', '3');
await page.$eval('#yearInput', el => { el.value = '2026'; el.dispatchEvent(new Event('change')); });
await new Promise(r => setTimeout(r, 300));

console.log(`--- Dropping ${PDF} ---`);
const input = await page.$('#fileInput');
await input.uploadFile(PDF);

// Wait up to 3 minutes for OCR to finish
const deadline = Date.now() + 180_000;
let done = false;
while (Date.now() < deadline) {
  await new Promise(r => setTimeout(r, 2000));
  await pollLog();
  const state = await page.evaluate(() => ({
    step: document.querySelector('.step.active')?.id,
    reviewCards: document.querySelectorAll('#reviewQueue .card').length,
    sRigs: document.getElementById('sRigs').textContent,
    sRows: document.getElementById('sRows').textContent,
    lastLog: document.querySelector('#logEl .log-line:last-child')?.textContent,
  }));
  if (state.sRigs !== '0' || state.reviewCards > 0 || /OCR complete|error|No text/.test(state.lastLog || '')) {
    console.log('--- Final state:', JSON.stringify(state, null, 2));
    done = true;
    break;
  }
}
if (!done) { console.error('FAIL: timed out waiting for OCR'); process.exit(1); }

// Show review-card issues if any
const cardText = await page.evaluate(() => {
  const cards = document.querySelectorAll('#reviewQueue .card');
  return Array.from(cards).map(c => c.textContent.replace(/\s+/g, ' ').trim().slice(0, 300));
});
if (cardText.length) console.log('--- Review cards:', cardText);

await browser.close();
if (errors.length) {
  console.error('\nERRORS:');
  for (const e of errors) console.error(' ', e);
  process.exit(1);
}
console.log('\nOCR E2E OK.');
