import puppeteer from 'puppeteer';
import { resolve } from 'node:path';

const URL = process.env.URL || 'http://localhost:4173/';

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 2 });
page.on('dialog', async d => { await d.accept(); });

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 2000));

await page.select('#monthSelect', '3');
await page.$eval('#yearInput', el => { el.value = '2026'; el.dispatchEvent(new Event('change')); });
await new Promise(r => setTimeout(r, 300));

// 1) Idle state
await page.screenshot({ path: '/tmp/dd-1-idle.png' });

// 2) After dropping a broken fixture: review card visible
const input = await page.$('#fileInput');
await input.uploadFile(resolve('fixtures/204_dup_dates.xlsx'));
await new Promise(r => setTimeout(r, 2500));
await page.screenshot({ path: '/tmp/dd-2-review.png' });

// 3) Accept the review → clean, then drop 3 clean files to show batch
await page.click('#reviewQueue [data-review-action="accept"]');
await new Promise(r => setTimeout(r, 500));

await input.uploadFile(
  resolve('fixtures/204_March_2026.xlsx'),
  resolve('fixtures/205_Mar_2026.xlsx'),
  resolve('fixtures/206_Mar_2026.xlsx'),
);
await new Promise(r => setTimeout(r, 6000));
await page.screenshot({ path: '/tmp/dd-3-batch-done.png' });

// 4) Rig detail view (click a rig)
await page.click('#ri-205');
await new Promise(r => setTimeout(r, 500));
await page.screenshot({ path: '/tmp/dd-4-detail.png' });

await browser.close();
console.log('Screenshots: /tmp/dd-1-idle.png /tmp/dd-2-review.png /tmp/dd-3-batch-done.png /tmp/dd-4-detail.png');
