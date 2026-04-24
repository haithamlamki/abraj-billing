import puppeteer from 'puppeteer';
import { resolve } from 'node:path';

const URL = process.env.URL || 'http://localhost:5173/';
const FIXTURES = [
  resolve('fixtures/204_March_2026.xlsx'),
  resolve('fixtures/205_Mar_2026.xlsx'),
  resolve('fixtures/206_Mar_2026.xlsx'),
];

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 2 });
page.on('dialog', async d => { await d.accept(); });

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 2000));

// Align billing period to fixtures (March 2026)
await page.select('#monthSelect', '3');
await page.$eval('#yearInput', el => { el.value = '2026'; el.dispatchEvent(new Event('change')); });
await new Promise(r => setTimeout(r, 400));

// 1) Before upload
await page.screenshot({ path: '/tmp/batch-before.png', fullPage: false });

// Start upload + capture mid-batch
const input = await page.$('#fileInput');
const uploadP = input.uploadFile(...FIXTURES);
await uploadP;
await new Promise(r => setTimeout(r, 250));
await page.screenshot({ path: '/tmp/batch-during.png', fullPage: false });

// Wait for completion
await new Promise(r => setTimeout(r, 5000));
await page.screenshot({ path: '/tmp/batch-done.png', fullPage: false });

// Switch to summary
await page.evaluate(() => window.showAppView('summary'));
await new Promise(r => setTimeout(r, 800));
await page.screenshot({ path: '/tmp/batch-summary.png', fullPage: false });

await browser.close();
console.log('Screenshots: /tmp/batch-before.png /tmp/batch-during.png /tmp/batch-done.png /tmp/batch-summary.png');
