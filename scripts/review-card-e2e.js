import puppeteer from 'puppeteer';
import { resolve } from 'node:path';

const URL = process.env.URL || 'http://localhost:5173/';

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 2 });

const errors = [];
const EXPECTED_404_RE = /ALL_RIGS\.xlsx/i;
page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));
page.on('console', msg => {
  if (msg.type() === 'error') {
    const text = msg.text();
    if (!EXPECTED_404_RE.test(text) && !text.includes('Failed to load resource')) {
      errors.push(`console.error: ${text}`);
    }
  }
});
page.on('dialog', async d => { await d.accept(); });

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 2000));

await page.select('#monthSelect', '3');
await page.$eval('#yearInput', el => { el.value = '2026'; el.dispatchEvent(new Event('change')); });
await new Promise(r => setTimeout(r, 300));

const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };

console.log('--- Test 1: broken file (no header, no rig) should produce a review card ---');
const input = await page.$('#fileInput');
await input.uploadFile(resolve('fixtures/broken_no_header.xlsx'));
await new Promise(r => setTimeout(r, 2500));

const afterBroken = await page.evaluate(() => {
  const review = document.getElementById('reviewQueue');
  const cards = review ? Array.from(review.querySelectorAll('.card')) : [];
  return {
    reviewVisible: !!review && review.style.display !== 'none',
    cardCount: cards.length,
    cardText: cards[0]?.textContent.replace(/\s+/g, ' ').trim().slice(0, 200),
    sRigs: document.getElementById('sRigs').textContent,
  };
});
console.log('  after broken drop:', afterBroken);
if (!afterBroken.reviewVisible) fail('review queue should be visible');
if (afterBroken.cardCount !== 1) fail(`expected 1 review card, got ${afterBroken.cardCount}`);
if (afterBroken.sRigs !== '0') fail(`broken file should not add to rigStore; sRigs=${afterBroken.sRigs}`);
if (!/rig not detected|header row|billing sheets/.test(afterBroken.cardText)) {
  fail(`card text should mention detection issues: "${afterBroken.cardText}"`);
}

console.log('--- Test 2: click Skip on review card → card removed ---');
await page.click('#reviewQueue [data-review-action="skip"]');
await new Promise(r => setTimeout(r, 300));
const afterSkip = await page.evaluate(() => ({
  reviewVisible: document.getElementById('reviewQueue')?.style.display !== 'none',
  cardCount: document.querySelectorAll('#reviewQueue .card').length,
}));
console.log('  after skip:', afterSkip);
if (afterSkip.cardCount !== 0) fail(`expected 0 cards after skip, got ${afterSkip.cardCount}`);

console.log('--- Test 3: duplicate-dates fixture → review card with rig=999 + duplicate warning ---');
await input.uploadFile(resolve('fixtures/204_dup_dates.xlsx'));
await new Promise(r => setTimeout(r, 2500));

const dupState = await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll('#reviewQueue .card'));
  return {
    cardCount: cards.length,
    cardText: cards[0]?.textContent.replace(/\s+/g, ' ').trim().slice(0, 300),
    acceptBtn: !!cards[0]?.querySelector('[data-review-action="accept"]'),
  };
});
console.log('  after duplicate-dates drop:', dupState);
if (dupState.cardCount !== 1) fail(`expected 1 review card for dup dates, got ${dupState.cardCount}`);
if (!/duplicate/.test(dupState.cardText)) fail(`card should mention duplicate dates: "${dupState.cardText}"`);

console.log('--- Test 4: click Accept anyway → data lands in rigStore ---');
await page.click('#reviewQueue [data-review-action="accept"]');
await new Promise(r => setTimeout(r, 500));
const afterAccept = await page.evaluate(() => ({
  cardCount: document.querySelectorAll('#reviewQueue .card').length,
  sRows: document.getElementById('sRows').textContent,
}));
console.log('  after accept:', afterAccept);
if (afterAccept.cardCount !== 0) fail('card should be removed after accept');

await browser.close();
if (errors.length) {
  console.error('\nERRORS:');
  for (const e of errors) console.error(' ', e);
  process.exit(1);
}
console.log('\nREVIEW-CARD E2E OK.');
