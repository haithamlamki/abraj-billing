import puppeteer from 'puppeteer';

const URL = process.env.URL || 'http://localhost:5173/';

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();

const errors = [];
const EXPECTED_404_RE = /(ALL_RIGS\.xlsx)/i;

page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));
page.on('console', msg => {
  if (msg.type() === 'error') {
    const text = msg.text();
    if (!EXPECTED_404_RE.test(text) && !text.includes('Failed to load resource')) {
      errors.push(`console.error: ${text}`);
    }
  }
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 2000));

console.log('--- Test 1: switch to Executive Summary tab ---');
await page.click('#tabSummary');
await new Promise(r => setTimeout(r, 500));
const summaryVisible = await page.evaluate(() =>
  document.getElementById('summaryView').style.display === 'block'
);
console.log('  summaryView visible:', summaryVisible);
const emptyMsg = await page.evaluate(() =>
  document.getElementById('summaryEmpty').textContent.trim().slice(0, 60)
);
console.log('  empty message:', emptyMsg);

console.log('--- Test 2: back to extraction tab ---');
await page.click('#tabExtraction');
await new Promise(r => setTimeout(r, 300));
const extractionVisible = await page.evaluate(() =>
  document.getElementById('extractionView').style.display !== 'none'
);
console.log('  extractionView visible:', extractionVisible);

console.log('--- Test 3: change billing month ---');
await page.select('#monthSelect', '6');
await new Promise(r => setTimeout(r, 300));
const rigDays = await page.evaluate(() =>
  document.querySelector('#rigList .r-days')?.textContent
);
console.log('  rig days after month=Jun:', rigDays, '(expected 0/30)');

console.log('--- Test 4: click a rig to select it ---');
await page.click('#ri-204');
await new Promise(r => setTimeout(r, 300));
const selectedRig = await page.evaluate(() =>
  document.getElementById('metaRig')?.value
);
console.log('  meta rig value:', selectedRig);

console.log('--- Test 5: open a mapping group (collapsed by default) ---');
// Navigate to step 2 by simulating a mock file drop first — skip, just toggle the existing step
// Step 2 panel is hidden until a file is loaded, so we test collapsed/expanded directly
const hoursGroupBefore = await page.evaluate(() =>
  document.getElementById('grpHours')?.classList.contains('collapsed')
);
console.log('  hours group collapsed before (should be true, but panel not visible yet):', hoursGroupBefore);

console.log('--- Test 6: import JSON state ---');
// Build a tiny synthetic state file and feed it through importJSONFile
const state = {
  version: '2.0-qc',
  billingMonth: 3,
  billingYear: 2026,
  rigs: {
    204: {
      meta: { customer: 'ARA', well: 'AMAL-42', contract: 'C-1', po: 'PO-1' },
      rows: [
        { date: '15-Mar-2026', operating: 24, reduced: 0, breakdown: 0, special: 0,
          force_maj: 0, zero_rate: 0, standby: 0, repair: 0, rig_move: 0,
          total_hrs: 24, operation: 'Drilling', remarks: '' },
        { date: '16-Mar-2026', operating: 12, reduced: 12, breakdown: 0, special: 0,
          force_maj: 0, zero_rate: 0, standby: 0, repair: 0, rig_move: 0,
          total_hrs: 24, operation: 'Tripping', remarks: '' },
      ],
      files: ['synthetic'],
    },
  },
};

// Suppress the "Imported JSON state" alert
page.on('dialog', async dialog => {
  console.log('  dialog:', dialog.message().slice(0, 80));
  await dialog.accept();
});

await page.evaluate(async (stateStr) => {
  const file = new File([stateStr], 'state.json', { type: 'application/json' });
  window.importJSONFile(file);
  // Wait a beat for the reader
  await new Promise(r => setTimeout(r, 300));
}, JSON.stringify(state));

await new Promise(r => setTimeout(r, 800));

const afterImport = await page.evaluate(() => ({
  sRigs: document.getElementById('sRigs').textContent,
  sRows: document.getElementById('sRows').textContent,
  sOper: document.getElementById('sOper').textContent,
  rig204DayCount: document.querySelector('#ri-204 .r-days')?.textContent,
  monthSelect: document.getElementById('monthSelect').value,
}));
console.log('  after import:', afterImport);

console.log('--- Test 7: switch to summary view (should show data now) ---');
await page.click('#tabSummary');
await new Promise(r => setTimeout(r, 700));
const summaryState = await page.evaluate(() => ({
  summaryVisible: document.getElementById('summaryContent').style.display === 'block',
  kpiActive: document.getElementById('kpiActiveRigs')?.textContent,
  kpiOperating: document.getElementById('kpiOperating')?.textContent,
  kpiTotalBilled: document.getElementById('kpiTotalBilled')?.textContent,
  rigTableRows: document.querySelectorAll('#summaryRigTable tr').length,
  exceptionRows: document.querySelectorAll('#summaryExceptionTable tr').length,
  heatmapCells: document.querySelectorAll('#summaryHeatmap .summary-heat-cell').length,
}));
console.log('  summary state:', summaryState);

await browser.close();

if (errors.length) {
  console.error('\nERRORS:');
  for (const e of errors) console.error(' ', e);
  process.exit(1);
}
console.log('\nALL INTERACTIONS OK.');
