# Abraj Billing Extractor

Client-side dashboard that extracts monthly billing data from rig PDF/Excel sheets, runs full-month QC across the fleet, and produces a consolidated export and executive summary.

All extraction is deterministic and runs in the browser — **no external APIs, no LLMs**.

## Features

- **Drop → Done** workflow: dropped files are auto-extracted silently; only files with real issues surface an inline Review Card.
- Deterministic pipeline: `findHeaderRow` → `autoMapHeaders` → `extractRows` → `mergeRowsIntoRig` → QC.
- Bulk auto-process for multi-file drops with a progress banner, pause/resume, and per-file auto-accept on confidence ≥ 90%.
- Executive Summary view: 24-rig fleet QC, exception report, submission heatmap, customer aggregation, Chart.js visualisations.
- Per-rig detail view with editable row table (auto-saves to `localStorage`).
- OCR fallback for scanned PDFs via Tesseract.js (best-effort; quality depends on the scan).
- Conflict resolution when PDF vs Excel disagree on daily hours for the same rig/date.
- Single-file build via `vite-plugin-singlefile` — one 100 KB HTML you can open from `file://`.

## Run it

```bash
npm install
npm run dev         # Vite dev server at http://localhost:5173/
npm run build       # bundles dist/index.html (one self-contained file)
npm run preview     # serve the built file
npm test            # Vitest — 131 unit tests
```

## Structure

```
src/
  constants.js       # rig list, customer map, hour keys
  utils.js           # safeNum, safeStr, fmtNum, clamp
  dates.js           # toDateStr, parseDate, getDaysInMonth
  mapping.js         # autoMapHeaders, detectUnnamedTextColumns
  detection.js       # findHeaderRow, isFooterRow, classifyRows, detectMeta
  extract.js         # extractRows (pure extraction pipeline)
  merge.js           # rowTotal, joinText, mergeRowsIntoRig
  qc.js              # buildQCModel, computeExtractionConfidence, normalizeExtractedData
  review.js          # evaluateIssues + AUTO_ACCEPT_THRESHOLD
  main.js            # DOM wiring, batch mode, review queue, OCR fallback, exports

tests/               # Vitest unit tests for each pure module
scripts/             # E2E (Puppeteer) + fixture generators
fixtures/            # synthetic billing sheets used in E2E
index.html           # app shell
integrated_billing_extraction_dashboard.html   # original monolithic source (kept for reference)
```

## E2E

```bash
npm run dev &                                       # keep dev server up in another terminal
node scripts/auto-drop-e2e.js                       # single + batch drop → silent extract
node scripts/review-card-e2e.js                     # broken fixtures → review cards
node scripts/batch-e2e.js                           # 3 clean files dropped together
node scripts/real-file-e2e.js <path-to-real.xls>    # drive any real file through the pipeline
```

## Notes

- Preserves a known-latent bug in `src/dates.js`: `toDateStr` uses `getUTCDate()` on xlsx-returned `Date` objects, which shifts dates by one day on non-UTC machines. Real Abraj files store dates as strings, which bypasses this branch. Covered by tests; not fixed here.
- Tesseract.js OCR is best-effort — scanned billing sheets with dense numeric columns produce noisy output that the deterministic column detector often can't parse. Prefer the `.xls`/`.xlsx` source when available.
