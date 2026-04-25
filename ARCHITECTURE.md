# Abraj Billing Extractor — Architecture

`src/main.js` began life as a 2,499-line monolith. It has been progressively broken apart into focused modules under `src/pipeline/`, `src/state/`, and `src/views/`, each with a matching unit-test file. This document describes the resulting structure and the rules that govern it.

---

## Module map

```
src/
├── constants.js        60 lines  — RIGS, RIG_CUST, TARGET_COLS, MAP_GROUPS, …
├── utils.js            24 lines  — safeNum, safeStr, fmtNum, escapeHtml
├── dates.js            80 lines  — getDaysInMonth, getMonthName, toDateStr, parseDate
├── mapping.js         195 lines  — autoMapHeaders, detectUnnamedTextColumns,
│                                   normalizeHeaderRow, applyAboveRowHints
├── detection.js       124 lines  — findHeaderRow, isFooterRow, classifyRows, detectMeta
├── merge.js           121 lines  — joinText, rowTotal, mergeRowsIntoRig
├── extract.js          82 lines  — extractRows
├── review.js           18 lines  — AUTO_ACCEPT_THRESHOLD
├── qc.js              323 lines  — buildQCModel, generateExecutiveSummary,
│                                   computeExtractionConfidence, normalizeExtractedData
│
├── pipeline/
│   ├── ocr.js          95 lines  — createOcrRunner (Tesseract lazy worker)
│   ├── parsePdf.js    216 lines  — parsePdfBuffer (pdf.js integration)
│   ├── parseExcel.js   75 lines  — parseExcelBuffer (SheetJS integration)
│   ├── autoProcess.js 136 lines  — extractFromSheet, mergeExtractionSilently
│   ├── export.js      107 lines  — buildAllRowsData, buildExceptionReportSheets, EXPORT_COL_WIDTHS
│   ├── consolidatedLoader.js 69 lines — parseConsolidatedRows
│   ├── fileFilter.js   42 lines  — shouldSkipFile, detectRigFromFilename
│   └── conflictResolver.js 27 lines — chooseConflictRow
│
├── state/
│   ├── rigStore.js    139 lines  — ensureRig, getRig, setRigMeta, mergeRowsIntoRig helpers, …
│   ├── batch.js       111 lines  — createBatch, startBatch, recordSuccess, recordReview, …
│   └── storage.js     139 lines  — saveToStorage, loadFromStorage, buildJsonExportPayload, …
│
├── views/
│   ├── reviewQueue.js  99 lines  — buildReviewCardHTML, renderReviewQueue
│   ├── conflicts.js   103 lines  — buildConflictRowHTML, buildConflictsHTML, renderConflicts
│   ├── fleetOverview.js 124 lines — buildTimelineHTML, renderFleetOverview
│   ├── result.js      276 lines  — buildResultHTML, renderResult
│   ├── preview.js     101 lines  — buildPreviewTableHTML, renderPreviewTable
│   ├── summary.js     280 lines  — buildSummaryHTML, renderSummary
│   ├── mappingUI.js    56 lines  — buildColOptionsHTML, buildMappingItemHTML
│   ├── batchBanner.js 111 lines  — buildBatchBannerHTML, ensureBatchBanner, renderBatchBanner, …
│   └── rigCard.js      29 lines  — buildRigCardHTML
│
└── main.js           1,455 lines — App bootstrap, DOM orchestration, event wiring
```

**Total extracted: ~2,300 lines across 26 modules (original: 2,499 lines in one file).**

---

## Extraction pattern

Every extraction follows the same three-layer rule:

### Layer 1 — Pure builder (`buildXxxHTML` / `parseXxx`)
- No DOM, no `document`, no module globals
- Receives all inputs as explicit parameters
- Returns a string (HTML) or plain data structure
- Fully testable in Vitest without jsdom

### Layer 2 — DOM renderer (`renderXxx`)
- Writes the builder's output into a known DOM element
- May wire event listeners via callback parameters (`onAction`, `onClick`, …)
- Lives in `src/views/` alongside its builder
- Not directly unit-tested (DOM coupling), exercised by integration / manual testing

### Layer 3 — Thin wrapper in `main.js`
- Closes over the app's module-level state (`billingYear`, `billingMonth`, `rigStore`, …)
- Calls the renderer with those closed-over values
- Usually 1–3 lines; no business logic

**Example** (conflicts panel):
```js
// src/views/conflicts.js  — layers 1 + 2
export function buildConflictRowHTML(c, mergedTotal) { /* pure HTML */ }
export function buildConflictsHTML(rigNum, conflicts, mergedRows) { /* pure HTML */ }
export function renderConflicts(rigNum, conflicts, mergedRows, onAction) { /* DOM writer */ }

// src/main.js  — layer 3
function showConflicts(rigNum, conflicts) {
  LAST_CONFLICTS.rigNum = rigNum;
  LAST_CONFLICTS.conflicts = conflicts;
  setStep(3);
  const entry = getRig(rigStore, rigNum);
  renderConflictsDOM(rigNum, conflicts, entry ? entry.rows : [],
    strategy => resolveAllConflicts(rigNum, strategy));
  document.getElementById('resultTitle').textContent = `Rig ${rigNum} — Resolve Conflicts`;
  document.getElementById('resultWarnings').innerHTML = '';
}
```

---

## What remains in `main.js`

`main.js` owns exactly three kinds of code:

| Category | Examples |
|---|---|
| **App-level state** | `rigStore`, `billingMonth`, `billingYear`, `fileQueue`, `batchMode`, `LAST_CONFLICTS`, `reviewQueue`, `currentRawData`, … |
| **DOM orchestration** | `handleFiles`, `processNextFile`, `autoProcessCurrentFile`, `buildMappingUI`, `autoMap`, `acceptData`, `advanceToNext`, `setStep`, `buildRigList`, `updateStats`, `setupDrop` |
| **Thin view wrappers** | `renderReviewQueue`, `renderBatchBanner`, `renderBatchDone`, `showConflicts`, `updateFleetOverview`, `renderExecutiveSummary`, `showResult` |

Functions that **could not** be cleanly extracted (all require direct DOM access to multiple live elements that are also mutated by adjacent code):
- `buildMappingUI` / `autoMap` / `updateGroupCounts` / `updateMapStatus` — mapping grid is driven by `currentRawData`, `currentHeaderRow`, and writes back into 20+ live `<select>` elements
- `setStep` — single function managing three step panels + CSS classes; too small to justify a module
- `attemptAutoAccept` / `acceptData` / `advanceToNext` — coordinate DOM navigation, batch state, and store mutations inseparably

---

## Test coverage

Every pure module has a matching test file:

| Test file | Tests | Covers |
|---|---|---|
| `tests/utils.test.js` | 15 | safeNum, safeStr, fmtNum, clamp |
| `tests/dates.test.js` | 18 | getDaysInMonth, getMonthName, toDateStr, parseDate |
| `tests/mapping.test.js` | ~30 | autoMapHeaders, detectUnnamedTextColumns |
| `tests/headerNorm.test.js` | 23 | normalizeHeaderRow, applyAboveRowHints |
| `tests/detection.test.js` | ~20 | findHeaderRow, isFooterRow, classifyRows, detectMeta |
| `tests/merge.test.js` | ~25 | rowTotal, mergeRowsIntoRig, joinText |
| `tests/extract.test.js` | ~30 | extractRows, full pipeline |
| `tests/qc.test.js` | ~25 | buildQCModel, computeExtractionConfidence |
| `tests/rigStore.test.js` | ~20 | ensureRig, getRig, appendRowIfNew, … |
| `tests/batch.test.js` | ~20 | createBatch, state transitions |
| `tests/storage.test.js` | ~15 | saveToStorage, loadFromStorage |
| `tests/ocr.test.js` | 6 | createOcrRunner |
| `tests/parseExcel.test.js` | ~12 | parseExcelBuffer |
| `tests/autoProcess.test.js` | 21 | extractFromSheet, mergeExtractionSilently |
| `tests/export.test.js` | 17 | buildAllRowsData, buildExceptionReportSheets |
| `tests/consolidatedLoader.test.js` | 13 | parseConsolidatedRows |
| `tests/fileFilter.test.js` | 17 | shouldSkipFile, detectRigFromFilename |
| `tests/conflictResolver.test.js` | 9 | chooseConflictRow |
| `tests/mappingUI.test.js` | 14 | buildColOptionsHTML, buildMappingItemHTML |
| `tests/batchBanner.test.js` | 19 | buildBatchBannerHTML, buildBatchDoneHTML |
| `tests/rigCard.test.js` | 8 | buildRigCardHTML |
| `tests/reviewQueue.test.js` | ~15 | buildReviewCardHTML |
| `tests/conflicts.test.js` | ~12 | buildConflictRowHTML, buildConflictsHTML |
| `tests/fleetOverview.test.js` | ~15 | buildTimelineHTML |
| `tests/result.test.js` | ~20 | buildResultHTML |
| `tests/preview.test.js` | ~10 | buildPreviewTableHTML |
| `tests/summary.test.js` | ~20 | buildSummaryHTML |

**Total: 465 tests, 29 files (as of 2026-04-25).**

Run with: `npm test`

---

## Dependency rules

```
main.js
  ↓ imports from
views/*, pipeline/*, state/*
  ↓ imports from
src/*.js  (utils, dates, mapping, detection, merge, extract, qc, constants, review)
```

- `views/` modules must **not** import from `pipeline/` or `state/`
- `pipeline/` modules must **not** import from `views/`
- `state/` modules must **not** import from `views/` or `pipeline/`
- Everything may import from `src/*.js` (utilities)
- `main.js` is the only module allowed to close over app state and wire DOM events

---

## Adding a new module

1. Identify a cohesive cluster of functions in `main.js`
2. Create `src/{views,pipeline,state}/newModule.js` with pure builders + DOM renderers
3. Add a `tests/newModule.test.js` covering all pure exports
4. Replace the original functions in `main.js` with thin wrappers
5. Import the new module in `main.js`
6. Run `npm test` — all existing tests must still pass
