import {
  RIGS, RIG_CUST, CUST_COLORS, CUSTOMERS, MONTHS, HR_KEYS,
  TARGET_COLS, MAP_GROUPS,
} from './constants.js';
import { safeNum, safeStr, fmtNum, escapeHtml } from './utils.js';
import { toDateStr, parseDate, getDaysInMonth, getMonthName } from './dates.js';
import { autoMapHeaders, detectUnnamedTextColumns } from './mapping.js';
import { findHeaderRow, isFooterRow, classifyRows, detectMeta } from './detection.js';
import { joinText, rowTotal, mergeRowsIntoRig } from './merge.js';
import { extractRows } from './extract.js';
import {
  getRigMeta, getDayMap, buildQCModel, generateExecutiveSummary,
  computeExtractionConfidence, normalizeExtractedData,
} from './qc.js';
import { AUTO_ACCEPT_THRESHOLD } from './review.js';
import {
  saveToStorage, loadFromStorage, clearStorage as clearStorageNow,
  buildJsonExportPayload, parseJsonImport,
} from './state/storage.js';
import { createOcrRunner } from './pipeline/ocr.js';
import { parsePdfBuffer } from './pipeline/parsePdf.js';
import { parseExcelBuffer } from './pipeline/parseExcel.js';
import {
  extractFromSheet as extractFromSheetPipeline,
  mergeExtractionSilently as mergeExtractionSilentlyPipeline,
} from './pipeline/autoProcess.js';
import {
  buildAllRowsData, buildExceptionReportSheets, EXPORT_COL_WIDTHS,
} from './pipeline/export.js';
import {
  ensureRig, getRig, setRigMeta, addFileToRig,
  replaceRowByDate, appendRowIfNew, sortRowsByDate, restoreRig,
  clearRigs, aggregateStats, hasData, updateRigMetaFields,
} from './state/rigStore.js';
import {
  createBatch, startBatch, addToBatch, recordSuccess, recordReview,
  pauseBatch as pauseBatchState, resumeBatch as resumeBatchState,
  finishBatch, resetBatch as resetBatchState, isRunning,
} from './state/batch.js';
import {
  ensureReviewQueueContainer, buildReviewCardHTML, renderReviewQueue as renderReviewQueueDOM,
} from './views/reviewQueue.js';
import { renderConflicts as renderConflictsDOM } from './views/conflicts.js';
import {
  buildTimelineHTML, renderFleetOverview as renderFleetOverviewDOM,
} from './views/fleetOverview.js';
import { renderResult as renderResultDOM } from './views/result.js';
import { renderPreviewTable as renderPreviewTableDOM } from './views/preview.js';
import { buildColOptionsHTML, buildMappingItemHTML } from './views/mappingUI.js';
import {
  ensureBatchBanner,
  renderBatchBanner as renderBatchBannerDOM,
  renderBatchDone as renderBatchDoneDOM,
} from './views/batchBanner.js';
import { renderSummary as renderSummaryDOM } from './views/summary.js';

/* global XLSX, pdfjsLib, Chart */

// ============================================
// PDF.js worker — disable only when running from file:// (workers can't load
// cross-origin scripts from a file URL). Over HTTP/HTTPS, let pdf.js spin up
// its own worker so PDF parsing doesn't block the main thread.
// ============================================
if (typeof pdfjsLib !== 'undefined' && typeof location !== 'undefined' && location.protocol === 'file:') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = '';
  pdfjsLib.disableWorker = true;
}

// ============================================
// STATE
// ============================================
const rigStore = {};

let currentRawData = null;
let currentRawSheets = null;
let currentSheetName = null;
let currentHeaderRow = -1;
let currentMapping = {};
let currentFileName = '';
let currentRigNum = null;
let currentExtractedRows = null;
let fileQueue = [];
let pendingSheets = [];

let billingMonth = new Date().getMonth() + 1;
let billingYear = new Date().getFullYear();

const LAST_CONFLICTS = { rigNum: null, conflicts: [] };

// Batch mode: drop many files, auto-accept high-confidence extractions end-to-end.
// State + transitions live in src/state/batch.js; this module owns the single
// instance and re-renders the banner whenever a transition fires.
const batchMode = createBatch();

function resetBatch() {
  resetBatchState(batchMode);
  renderBatchBanner();
}

// ============================================
// UI HELPERS
// ============================================
function log(msg, cls = '') {
  const el = document.getElementById('logEl');
  if (!el) return;
  el.innerHTML += `<div class="log-line ${cls}">${msg}</div>`;
  el.scrollTop = el.scrollHeight;
}

function updateMonthYearUI() {
  const sel = document.getElementById('monthSelect');
  const yr = document.getElementById('yearInput');
  if (sel) sel.value = billingMonth;
  if (yr) yr.value = billingYear;
}

function populateCustomerOptions() {
  const sel = document.getElementById('metaCust');
  if (!sel) return;
  sel.innerHTML = CUSTOMERS.map(c => `<option value="${c}">${c}</option>`).join('');
}

function onMonthYearChange() {
  billingMonth = parseInt(document.getElementById('monthSelect').value);
  billingYear = parseInt(document.getElementById('yearInput').value) || 2026;
  log(`Billing period changed to ${getMonthName(billingMonth)} ${billingYear}`, 'info');
  buildRigList();
  updateStats();
}

// ============================================
// BATCH BANNER
// ============================================
function renderBatchBanner() {
  renderBatchBannerDOM(batchMode, { onPause: pauseBatch, onResume: resumeBatch });
}

function renderBatchDone() {
  renderBatchDoneDOM(batchMode, { onDismiss: resetBatch });
}

function pauseBatch() {
  pauseBatchState(batchMode);
  log('Batch paused. Current file will finish, then wait.', 'info');
  renderBatchBanner();
}

function resumeBatch() {
  resumeBatchState(batchMode);
  log('Batch resumed.', 'info');
  renderBatchBanner();
  if (fileQueue.length > 0) {
    processNextFile().catch(e => log('Batch error: ' + e.message, 'err'));
  }
}

// ============================================
// FILE HANDLING
// ============================================
async function handleFiles(files) {
  if (!files || files.length === 0) return;
  const wasIdle = fileQueue.length === 0 && isAppIdle();
  for (const file of files) fileQueue.push(file);
  log(`${files.length} file(s) queued. Total in queue: ${fileQueue.length}`, 'info');

  // Activate batch mode when >1 file is dropped, or when additional files land during an active batch.
  const shouldBatch = files.length > 1 || isRunning(batchMode);
  if (shouldBatch) {
    if (!batchMode.active) startBatch(batchMode, files.length);
    else addToBatch(batchMode, files.length);
    renderBatchBanner();
  }

  // Only kick processing if nothing is currently in-flight. Otherwise the
  // in-flight file's advanceToNext() will drain the queue when it finishes.
  if (wasIdle) {
    await processNextFile();
  } else {
    log(`  queued; will process after current file finishes`, 'info');
  }
}

function isAppIdle() {
  return document.querySelector('.step.active')?.id === 'step1';
}

async function processNextFile() {
  if (fileQueue.length === 0) {
    if (batchMode.active) {
      log(`Batch done: ${batchMode.autoAccepted} auto-accepted, ${batchMode.needsReview} need review`, batchMode.needsReview ? 'info' : 'ok');
      finishBatch(batchMode);
      renderBatchDone();
      setStep(1);
    } else {
      log('All files processed.', 'ok');
    }
    return;
  }
  if (batchMode.active && batchMode.paused) {
    renderBatchBanner();
    return;
  }
  const file = fileQueue.shift();
  currentFileName = file.name;
  const ext = file.name.split('.').pop().toLowerCase();

  // Filenames like "BST 384 Move Feb Rig110.pdf" are rig-move reports, not
  // daily billing rows. Skip them silently rather than emit a "0 rows" review
  // card. Same for Docusign and pure ticket files. Keep combined files like
  // "RIG204 Feb Billing & Ticket.pdf" — those have real billing rows.
  const fname = file.name;
  const isMove = /\bmove\b/i.test(fname);
  const isDocusign = /docusign/i.test(fname);
  const isTicketOnly = /\bticket\b/i.test(fname) && !/billing/i.test(fname);
  if (isMove || isDocusign || isTicketOnly) {
    log(`  Skipping non-billing file: ${fname}`, 'info');
    if (batchMode.active) {
      recordSuccess(batchMode); // count as "handled" so the batch progresses
      renderBatchBanner();
    }
    await processNextFile();
    return;
  }

  const buf = await file.arrayBuffer();

  // Try leading 3 digits first (e.g. "204_March_2026.xlsx"), then "Rig104" /
  // "RIG 104" anywhere in the name (real-world Abraj billing files).
  const rigMatch = file.name.match(/^(\d{3})/) || file.name.match(/rig[\s_-]*(\d{3})/i);
  currentRigNum = rigMatch ? parseInt(rigMatch[1]) : null;

  log(`Processing: ${file.name} (${fileQueue.length} remaining in queue)`, 'info');

  if (ext === 'xlsx' || ext === 'xls') {
    parseExcel(buf);
  } else if (ext === 'pdf') {
    await parsePDF(buf);
  } else {
    log(`Unsupported: ${file.name}`, 'err');
    if (batchMode.active) {
      recordReview(batchMode, file.name, currentRigNum, 'unsupported extension');
      renderBatchBanner();
    }
    await processNextFile();
  }
}

function getQueueStatus() {
  const parts = [];
  if (pendingSheets.length > 0) parts.push(`${pendingSheets.length} more sheet${pendingSheets.length > 1 ? 's' : ''}`);
  if (fileQueue.length > 0) parts.push(`${fileQueue.length} more file${fileQueue.length > 1 ? 's' : ''}`);
  return parts.length > 0 ? ` (${parts.join(' + ')})` : '';
}

function parseExcel(buf) {
  log(`Loading: ${currentFileName}`, 'info');
  const { sheets, billingSheetNames } = parseExcelBuffer(buf, { XLSX, log });
  currentRawSheets = sheets;

  const sheetSel = document.getElementById('sheetSelect');
  sheetSel.innerHTML = '';
  for (const sn of billingSheetNames) {
    const opt = document.createElement('option');
    opt.value = sn;
    opt.textContent = sn;
    sheetSel.appendChild(opt);
  }

  if (billingSheetNames.length === 0) {
    log(`No billing sheets found in ${currentFileName}`, 'err');
    // Push a minimal review card so the user sees the issue inline.
    reviewQueue.push({
      id: reviewIdSeq++,
      fileName: currentFileName,
      sheetName: '',
      rig: currentRigNum,
      meta: { customer: '', well: '', contract: '', po: '' },
      rows: [],
      map: {},
      headerRow: -1,
      confidence: { score: 0, status: 'Manual Review Required', issues: [] },
      issues: ['no billing sheets detected in file'],
      raw: [],
      formatted: [],
    });
    renderReviewQueue();

    if (batchMode.active) {
      recordReview(batchMode, currentFileName, currentRigNum, 'no billing sheets detected');
      renderBatchBanner();
      processNextFile().catch(e => log('Batch error: ' + e.message, 'err'));
    }
    return;
  }

  log(`Found ${billingSheetNames.length} billing sheet(s): ${billingSheetNames.join(', ')}`, 'info');
  pendingSheets = []; // autoProcessCurrentFile iterates all sheets itself
  currentSheetName = billingSheetNames[0];
  autoProcessCurrentFile().catch(e => log('Auto-process error: ' + e.message, 'err'));
}

// OCR for scanned PDFs — single runner, lazy Tesseract worker.
const ocrRunner = createOcrRunner(log);
const { ocrPageToItems } = ocrRunner;

async function parsePDF(buf) {
  log(`Loading PDF: ${currentFileName}`, 'info');
  try {
    const { rows, columns } = await parsePdfBuffer(buf, { pdfjsLib, ocrPageToItems, log });

    if (rows.length === 0) {
      log(columns.length === 0 ? 'No text in PDF' : 'No rows extracted from PDF', 'err');
      return;
    }

    log(`PDF parsed: ${rows.length} rows, ${columns.length} columns detected`, 'info');
    if (columns.length > 0) {
      log(`PDF columns: ${columns.map(c => c.text).join(' | ')}`, 'info');
    }

    currentRawSheets = { 'PDF': { formatted: rows, raw: rows } };
    currentSheetName = 'PDF';
    const sheetSelect = document.getElementById('sheetSelect');
    if (sheetSelect) sheetSelect.innerHTML = '<option>PDF</option>';
    autoProcessCurrentFile().catch(e => log('Auto-process error: ' + e.message, 'err'));
  } catch (e) {
    log(`PDF error: ${e.message}`, 'err');
    if (batchMode.active) {
      recordReview(batchMode, currentFileName, currentRigNum, 'PDF parse error');
      renderBatchBanner();
    }
    finishBatchOrContinue().catch(err => log('Batch error: ' + err.message, 'err'));
  }
}

// ============================================
// PREVIEW + MAPPING UI
// ============================================
function showPreview() {
  document.getElementById('logBox').style.display = 'block';
  const hasMore = fileQueue.length > 0 || pendingSheets.length > 0;
  document.getElementById('skipBtn').style.display = hasMore ? '' : 'none';
  document.getElementById('extractAllBtn').style.display = pendingSheets.length > 0 ? '' : 'none';
  setStep(2);

  const sheet = currentRawSheets[currentSheetName];
  currentRawData = sheet.raw;
  const formatted = sheet.formatted;

  document.getElementById('previewFileName').textContent = currentFileName + getQueueStatus();
  document.getElementById('previewSheetInfo').textContent = `Sheet: ${currentSheetName} | ${currentRawData.length} rows`;

  currentHeaderRow = findHeaderRow(formatted.length ? formatted : currentRawData);
  if (currentHeaderRow < 0) currentHeaderRow = findHeaderRow(currentRawData);

  const hintEl = document.getElementById('detectedHeaderRowNum');
  const hintBox = document.getElementById('headerRowHint');
  if (currentHeaderRow >= 0) {
    const hRow = (formatted.length ? formatted : currentRawData)[currentHeaderRow] || [];
    log(`  Header row ${currentHeaderRow + 1}: ${hRow.map(v => safeStr(v).replace(/\n/g, ' ').substring(0, 20)).filter(Boolean).join(' | ')}`, 'info');
    if (hintEl) hintEl.textContent = currentHeaderRow + 1;
    if (hintBox) hintBox.className = 'step-hint';
  } else {
    log('  WARNING: Could not auto-detect header row. Click a row in the preview to set it manually.', 'err');
    if (hintEl) hintEl.textContent = 'not detected';
    if (hintBox) { hintBox.className = 'step-hint'; hintBox.style.borderLeftColor = 'var(--orange)'; }
  }

  const meta = detectMeta(formatted.length ? formatted : currentRawData, currentHeaderRow >= 0 ? currentHeaderRow : 10);
  if (currentRigNum) document.getElementById('metaRig').value = currentRigNum;
  else if (meta.rig) document.getElementById('metaRig').value = meta.rig;
  document.getElementById('metaCust').value = meta.cust || RIG_CUST[currentRigNum] || 'PDO';
  document.getElementById('metaWell').value = meta.well || '';
  document.getElementById('metaContract').value = meta.contract || '';
  document.getElementById('metaPO').value = meta.po || '';
  document.getElementById('metaHeaderRow').value = currentHeaderRow >= 0 ? currentHeaderRow + 1 : '';

  renderPreviewTable();
  buildMappingUI();
  if (currentHeaderRow >= 0) autoMap();

  // Batch mode: try to auto-accept without leaving the UI paused at Step 2/3.
  if (batchMode.active && !batchMode.paused) {
    // Defer so the DOM renders (mapping selects populated) before we read from it in applyMapping().
    setTimeout(() => { attemptAutoAccept().catch(e => log('Auto-accept error: ' + e.message, 'err')); }, 0);
  }
}

/**
 * Batch-mode: try to extract + save the current file silently.
 * Returns true if auto-accepted, false if bailed out to manual review.
 */
async function attemptAutoAccept() {
  const bailToReview = (reason) => {
    recordReview(batchMode, currentFileName, currentRigNum, reason);
    renderBatchBanner();
    log(`  ⚠ ${currentFileName}: ${reason} — leaving for manual review`, 'err');
    // Deactivate batch *for this file*: user must click Save & continue. When they do,
    // advanceToNext() → processNextFile() will continue the queue under batchMode.active.
  };

  if (currentHeaderRow < 0) {
    bailToReview('header row not auto-detected');
    return false;
  }
  if (!currentRigNum) {
    bailToReview('rig not resolved from filename or file header');
    return false;
  }

  // Build mapping from the DOM (autoMap already populated it).
  const map = {};
  for (const tc of TARGET_COLS) {
    const sel = document.getElementById(`sel-${tc.key}`);
    if (!sel) continue;
    const v = parseInt(sel.value);
    if (v >= 0) map[tc.key] = v;
  }
  const totalSel = document.getElementById('sel-total_hrs');
  if (totalSel) {
    const v = parseInt(totalSel.value);
    if (v >= 0) map.total_hrs = v;
  }
  currentMapping = map;

  // Extract rows using the pure helper.
  const sheet = currentRawSheets[currentSheetName];
  const { rows } = extractRows({
    rawData: sheet.raw,
    formatted: sheet.formatted,
    headerRow: currentHeaderRow,
    map,
    billingYear,
    billingMonth,
  });

  const daysInMonth = getDaysInMonth(billingYear, billingMonth);
  const confidence = computeExtractionConfidence({
    rigNum: currentRigNum,
    headerRow: currentHeaderRow,
    map,
    rows,
    daysInMonth,
  });

  if (confidence.score < AUTO_ACCEPT_THRESHOLD) {
    // Render the normal Step 3 view so the user can inspect + accept.
    currentExtractedRows = rows;
    const cust = document.getElementById('metaCust').value;
    const well = document.getElementById('metaWell').value;
    const contract = document.getElementById('metaContract').value;
    const po = document.getElementById('metaPO').value;
    showResult(currentRigNum, cust, well, contract, po, rows);
    bailToReview(`confidence ${confidence.score}% (${confidence.issues.join(', ')})`);
    return false;
  }

  // Merge into the rig store.
  const cust = document.getElementById('metaCust').value;
  const well = document.getElementById('metaWell').value;
  const contract = document.getElementById('metaContract').value;
  const po = document.getElementById('metaPO').value;
  const isPDF = /\.pdf$/i.test(currentFileName);
  const sourceLabel = isPDF ? 'PDF (approved)' : 'Excel';

  setRigMeta(rigStore, currentRigNum, { customer: cust, well, contract, po });

  const result = mergeRowsIntoRig(rigStore, currentRigNum, rows, sourceLabel, currentFileName);
  Object.assign(rigStore, result.store);

  if (result.conflicts.length > 0) {
    // Conflicts surface for manual resolution; do not auto-accept.
    currentExtractedRows = rows;
    showResult(currentRigNum, cust, well, contract, po, rows);
    showConflicts(currentRigNum, result.conflicts);
    bailToReview(`${result.conflicts.length} hours conflict(s)`);
    return false;
  }

  // Clean success.
  recordSuccess(batchMode);
  renderBatchBanner();
  log(`  ✓ ${currentFileName}: Rig ${currentRigNum} auto-accepted (+${result.newDays} new / ${result.mergedDays} merged, confidence ${confidence.score}%)`, 'ok');

  updateRigList();
  updateStats();
  autoSave();

  // Drain any pending sheets from this file, then advance.
  if (pendingSheets.length > 0) {
    const nextSheet = pendingSheets.shift();
    currentSheetName = nextSheet;
    document.getElementById('sheetSelect').value = nextSheet;
    showPreview();
    return true;
  }

  // Advance to next file in queue.
  await finishBatchOrContinue();
  return true;
}

async function finishBatchOrContinue() {
  if (batchMode.paused) {
    renderBatchBanner();
    return;
  }
  if (fileQueue.length > 0) {
    await processNextFile();
    return;
  }
  // Queue drained.
  if (batchMode.active) {
    log(`Batch done: ${batchMode.autoAccepted} auto-accepted, ${batchMode.needsReview} need review`, batchMode.needsReview ? 'info' : 'ok');
    finishBatch(batchMode);
    renderBatchDone();
    setStep(1);
  }
}

// ============================================
// AUTO-PROCESS PIPELINE (Drop → Done)
// ============================================
// Every dropped file runs through this. Clean files merge silently. Files with
// real issues surface a ReviewCard in #reviewQueue.

const reviewQueue = [];
let reviewIdSeq = 1;

function extractFromSheet(params) {
  return extractFromSheetPipeline(params, { year: billingYear, month: billingMonth, log });
}

function pushReviewCard(extraction, fileName, extraIssues = []) {
  const card = {
    id: reviewIdSeq++,
    fileName,
    sheetName: extraction.sheetName,
    rig: extraction.rig,
    meta: extraction.meta,
    rows: extraction.rows,
    map: extraction.map,
    headerRow: extraction.headerRow,
    confidence: extraction.confidence,
    issues: [...extraction.issues, ...extraIssues],
    raw: extraction.raw,
    formatted: extraction.formatted,
  };
  reviewQueue.push(card);
  renderReviewQueue();
  return card;
}

function mergeExtractionSilently(extraction, fileName) {
  const result = mergeExtractionSilentlyPipeline(extraction, fileName, rigStore);
  if (result.ok) Object.assign(rigStore, result.store);
  return result;
}

/**
 * Run every billing sheet in `currentRawSheets` through the pipeline.
 * Called from parseExcel/parsePDF after the raw/formatted data is populated.
 */
async function autoProcessCurrentFile() {
  const sheets = currentRawSheets || {};
  const sheetNames = Object.keys(sheets);
  if (sheetNames.length === 0) {
    log(`  ${currentFileName}: no billing sheets`, 'err');
    if (batchMode.active) {
      recordReview(batchMode, currentFileName, currentRigNum, 'no billing sheets');
      renderBatchBanner();
    }
    await finishBatchOrContinue();
    return;
  }

  const filenameRigHint = currentRigNum;
  let fileHadIssue = false;
  let fileAutoAccepted = 0;

  for (const sheetName of sheetNames) {
    const { raw, formatted } = sheets[sheetName];
    const extraction = extractFromSheet({
      sheetName,
      rawData: raw,
      formatted,
      fileName: currentFileName,
      filenameRigHint,
    });

    if (extraction.issues.length === 0) {
      // Attempt silent merge.
      const merge = mergeExtractionSilently(extraction, currentFileName);
      if (merge.conflicts && merge.conflicts.length > 0) {
        pushReviewCard(extraction, currentFileName, [`${merge.conflicts.length} hours conflict(s)`]);
        fileHadIssue = true;
        log(`  ⚠ ${currentFileName} [${sheetName}]: ${merge.conflicts.length} conflict(s) — review needed`, 'err');
      } else {
        fileAutoAccepted++;
        log(`  ✓ ${currentFileName} [${sheetName}]: Rig ${extraction.rig} auto-accepted (+${merge.newDays} new / ${merge.mergedDays} merged, ${extraction.confidence.score}%)`, 'ok');
      }
    } else {
      pushReviewCard(extraction, currentFileName);
      fileHadIssue = true;
      log(`  ⚠ ${currentFileName} [${sheetName}]: ${extraction.issues.join(', ')} — review card added`, 'err');
    }
  }

  // Add the file to each affected rig's files[] list + persist + refresh UI.
  for (const rig of RIGS) {
    const store = rigStore[rig];
    if (!store) continue;
    if (store.rows.length && !store.files.includes(currentFileName)) store.files.push(currentFileName);
  }
  updateRigList();
  updateStats();
  autoSave();

  // Update batch counters.
  if (batchMode.active) {
    if (fileHadIssue) recordReview(batchMode, currentFileName, currentRigNum, 'sheet-level issue');
    else recordSuccess(batchMode);
    renderBatchBanner();
  }

  await finishBatchOrContinue();
}

// ============================================
// REVIEW QUEUE UI  (rendering delegated to src/views/reviewQueue.js)
// ============================================
function renderReviewQueue() {
  renderReviewQueueDOM(reviewQueue, handleReviewAction);
}

function handleReviewAction(action, id) {
  const idx = reviewQueue.findIndex(c => c.id === id);
  if (idx < 0) return;
  const card = reviewQueue[idx];

  if (action === 'skip') {
    reviewQueue.splice(idx, 1);
    renderReviewQueue();
    log(`Skipped ${card.fileName}`, 'info');
    return;
  }

  if (action === 'accept') {
    if (!card.rig || !card.rows.length) return;
    const merge = mergeExtractionSilently(card, card.fileName);
    if (merge.conflicts && merge.conflicts.length > 0) {
      log(`⚠ ${card.fileName}: merge produced ${merge.conflicts.length} conflict(s); review in conflicts panel`, 'err');
      showConflicts(card.rig, merge.conflicts);
    } else {
      log(`✓ ${card.fileName}: accepted (+${merge.newDays} new / ${merge.mergedDays} merged)`, 'ok');
    }
    reviewQueue.splice(idx, 1);
    renderReviewQueue();
    updateRigList();
    updateStats();
    autoSave();
    return;
  }

  if (action === 'edit') {
    openMappingOverride(card, idx);
    return;
  }
}

// "Edit mapping" reuses the existing Step-2/3 UI as a full-screen override.
// We rehydrate the module globals from the card and then invoke showPreview().
// When the user accepts via Save & continue, acceptData() merges; we then remove
// the card from the queue.
function openMappingOverride(card, idx) {
  currentRawSheets = { [card.sheetName]: { raw: card.raw, formatted: card.formatted } };
  currentSheetName = card.sheetName;
  currentRawData = card.raw;
  currentFileName = card.fileName;
  currentRigNum = card.rig;
  currentHeaderRow = card.headerRow;
  currentMapping = { ...card.map };
  currentExtractedRows = card.rows;
  // Mark this card for removal once the override flow accepts.
  window.__pendingReviewRemoval = card.id;
  showPreview();
}

function renderPreviewTable() {
  const sheet = currentRawSheets[currentSheetName];
  renderPreviewTableDOM(sheet.formatted, sheet.raw, currentHeaderRow, clickRow);
}

function clickRow(rowIdx) {
  currentHeaderRow = rowIdx;
  document.getElementById('metaHeaderRow').value = rowIdx + 1;
  const hintEl = document.getElementById('detectedHeaderRowNum');
  if (hintEl) hintEl.textContent = rowIdx + 1;
  renderPreviewTable();
  buildMappingUI();
  autoMap();
  log(`Header row set to ${rowIdx + 1} (clicked)`, 'info');
}

function switchSheet() {
  currentSheetName = document.getElementById('sheetSelect').value;
  showPreview();
}

function setHeaderRow() {
  const v = parseInt(document.getElementById('metaHeaderRow').value);
  if (v >= 1) {
    currentHeaderRow = v - 1;
    renderPreviewTable();
    buildMappingUI();
    autoMap();
    log(`Header row set to ${v} (manual)`, 'info');
  }
}

function cancelPreview() {
  fileQueue = [];
  setStep(1);
  document.getElementById('panelPreview').style.display = 'none';
  document.getElementById('panelDrop').style.display = '';
}

function skipFile() {
  log(`Skipped ${currentFileName} / ${currentSheetName}`, 'info');
  if (pendingSheets.length > 0) {
    const nextSheet = pendingSheets.shift();
    currentSheetName = nextSheet;
    document.getElementById('sheetSelect').value = nextSheet;
    showPreview();
  } else if (fileQueue.length > 0) {
    processNextFile();
  } else {
    setStep(1);
  }
}

function extractAllSheets() {
  log(`Extracting all sheets: ${currentSheetName} + ${pendingSheets.join(', ')}`, 'info');
  const allSheets = [currentSheetName, ...pendingSheets];
  pendingSheets = [];

  let totalNew = 0;
  let totalMerged = 0;
  const rigNum = parseInt(document.getElementById('metaRig').value) || currentRigNum;
  const cust = document.getElementById('metaCust').value;
  const well = document.getElementById('metaWell').value;
  const contract = document.getElementById('metaContract').value;
  const po = document.getElementById('metaPO').value;

  if (!rigNum) { log('Please enter rig number', 'err'); return; }
  const isPDF = /\.pdf$/i.test(currentFileName);

  for (const sn of allSheets) {
    currentSheetName = sn;
    currentRawData = currentRawSheets[sn].raw;
    const formatted = currentRawSheets[sn].formatted;
    currentHeaderRow = findHeaderRow(formatted.length ? formatted : currentRawData);
    if (currentHeaderRow < 0) {
      log(`  Sheet "${sn}": no header found, skipping`, 'err');
      continue;
    }
    buildMappingUI();
    autoMap();
    applyMapping();
    if (!currentExtractedRows || currentExtractedRows.length === 0) {
      log(`  Sheet "${sn}": no rows extracted, skipping`, 'info');
      continue;
    }
    setRigMeta(rigStore, rigNum, { customer: cust, well: well || sn, contract, po });

    const sourceLabel = isPDF ? 'PDF (approved)' : 'Excel';
    const result = mergeRowsIntoRig(rigStore, rigNum, currentExtractedRows, sourceLabel, null);
    Object.assign(rigStore, result.store);
    totalNew += result.newDays;
    totalMerged += result.mergedDays;
    log(`  Sheet "${sn}": +${result.newDays} new, ${result.mergedDays} merged`, 'ok');
  }

  addFileToRig(rigStore, rigNum, currentFileName);

  updateRigList();
  updateStats();
  autoSave();
  log(`All sheets done: +${totalNew} new, ${totalMerged} merged. Rig ${rigNum} total: ${rigStore[rigNum].rows.length} days.`, 'ok');

  currentExtractedRows = rigStore[rigNum].rows;
  showResult(rigNum, cust, rigStore[rigNum].meta.well, contract, po, rigStore[rigNum].rows);
}

function acceptAllRemaining() {
  acceptData();
  if (pendingSheets.length > 0) extractAllSheets();
}

function toggleGroup(groupId) {
  const el = document.getElementById(groupId);
  if (el) el.classList.toggle('collapsed');
}

function buildMappingUI() {
  const colOptions = getColOptions();
  const byKey = {};
  for (const tc of TARGET_COLS) byKey[tc.key] = tc;
  if (!byKey.total_hrs) byKey.total_hrs = { key: 'total_hrs', label: 'Total Hrs (file)', type: 'num' };

  const grids = { essentials: 'mapGridEssentials', hours: 'mapGridHours', obm: 'mapGridObm', text: 'mapGridText' };
  for (const grp of Object.keys(grids)) {
    const grid = document.getElementById(grids[grp]);
    if (!grid) continue;
    grid.innerHTML = '';
    for (const key of MAP_GROUPS[grp]) {
      const tc = byKey[key];
      if (!tc) continue;
      const div = document.createElement('div');
      div.className = 'map-item';
      div.id = `map-${tc.key}`;
      div.innerHTML = buildMappingItemHTML(tc, colOptions);
      grid.appendChild(div);
    }
  }
  // Wire change listeners (instead of inline onchange)
  document.querySelectorAll('[data-map-key]').forEach(sel => {
    sel.addEventListener('change', () => updateMapStatus(sel.dataset.mapKey));
  });
  updateGroupCounts();
}

function updateGroupCounts() {
  const counts = { essentials: 'cntEssentials', hours: 'cntHours', obm: 'cntObm', text: 'cntText' };
  for (const grp of Object.keys(counts)) {
    const keys = MAP_GROUPS[grp];
    let mapped = 0;
    for (const k of keys) {
      const sel = document.getElementById(`sel-${k}`);
      if (sel && parseInt(sel.value) >= 0) mapped++;
    }
    const el = document.getElementById(counts[grp]);
    if (el) {
      el.textContent = `${mapped} / ${keys.length} mapped`;
      el.className = 'count-mapped' + (mapped === keys.length ? ' all' : '');
    }
  }
  const statusEl = document.getElementById('mapStatus');
  if (statusEl) {
    const dateSel = document.getElementById('sel-date');
    const operSel = document.getElementById('sel-operating');
    const dateMapped = dateSel && parseInt(dateSel.value) >= 0;
    const operMapped = operSel && parseInt(operSel.value) >= 0;
    statusEl.innerHTML = (dateMapped && operMapped)
      ? '<span style="color:var(--green)">Ready to extract</span>'
      : '<span style="color:var(--orange)">Map at least Date and Operating</span>';
  }
}

function getColOptions() {
  if (!currentRawData || currentHeaderRow < 0) return '';
  const data = currentRawSheets[currentSheetName].formatted;
  const useData = data && data.length ? data : currentRawData;
  const hRow    = useData[currentHeaderRow] || [];
  const rawRow  = currentRawData[currentHeaderRow] || [];
  const extraRow = useData.length > currentHeaderRow + 1 ? (useData[currentHeaderRow + 1] || []) : [];
  return buildColOptionsHTML(hRow, rawRow, extraRow);
}

function autoMap() {
  const data = currentRawSheets[currentSheetName].formatted;
  const useData = data && data.length ? data : currentRawData;
  if (currentHeaderRow < 0 || !useData[currentHeaderRow]) return;

  const fmtRow = (data && data.length ? data : currentRawData)[currentHeaderRow] || [];
  const rawRow = currentRawData[currentHeaderRow] || [];
  const hRow = [];
  const maxLen = Math.max(fmtRow.length, rawRow.length);
  for (let i = 0; i < maxLen; i++) {
    const fv = safeStr(fmtRow[i]).replace(/\n/g, ' ');
    const rv = safeStr(rawRow[i]).replace(/\n/g, ' ');
    if (/^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/.test(fv) && rv && !/^\d/.test(rv)) hRow.push(rv);
    else if (!fv && rv) hRow.push(rv);
    else hRow.push(fv || rv);
  }

  const detected = autoMapHeaders(hRow);
  detectUnnamedTextColumns(detected, useData, currentHeaderRow);

  log(`Auto-map headers: [${hRow.join(' | ')}]`, 'info');
  log(`Auto-map result: ${JSON.stringify(detected)}`, 'info');

  if (currentHeaderRow > 0) {
    const prevRow = (useData[currentHeaderRow - 1] || []).map(v => safeStr(v));
    for (let c = 0; c < prevRow.length; c++) {
      if (prevRow[c] && hRow[c]) {
        const combined = (prevRow[c] + ' ' + hRow[c]).toLowerCase();
        if (/(total\s*h|total\s*hrs)/.test(combined) && !detected.total_hrs) {
          detected.total_hrs = c;
          log(`  Combined header: Col ${c + 1} = "${prevRow[c]} ${hRow[c]}" -> total_hrs`, 'info');
        }
        if (/operation/i.test(combined) && !detected.operation) detected.operation = c;
      }
    }
  }

  for (const tc of TARGET_COLS) {
    const sel = document.getElementById(`sel-${tc.key}`);
    if (sel) {
      sel.value = detected[tc.key] !== undefined ? detected[tc.key] : -1;
      updateMapStatus(tc.key);
    }
  }
  const totalSel = document.getElementById('sel-total_hrs');
  if (totalSel) {
    totalSel.value = detected.total_hrs !== undefined ? detected.total_hrs : -1;
    updateMapStatus('total_hrs');
  }

  currentMapping = detected;
}

function updateMapStatus(key) {
  const sel = document.getElementById(`sel-${key}`);
  const div = document.getElementById(`map-${key}`);
  if (!sel || !div) return;
  div.className = 'map-item ' + (parseInt(sel.value) >= 0 ? 'mapped' : 'unmapped');
  updateGroupCounts();
}

// ============================================
// APPLY MAPPING → EXTRACT
// ============================================
function applyMapping() {
  const map = {};
  for (const tc of TARGET_COLS) {
    const sel = document.getElementById(`sel-${tc.key}`);
    if (!sel) continue;
    const v = parseInt(sel.value);
    if (v >= 0) map[tc.key] = v;
  }
  const totalSel = document.getElementById('sel-total_hrs');
  if (totalSel) {
    const v = parseInt(totalSel.value);
    if (v >= 0) map.total_hrs = v;
  }
  currentMapping = map;

  const rigNum = parseInt(document.getElementById('metaRig').value) || currentRigNum;
  const cust = document.getElementById('metaCust').value;
  const well = document.getElementById('metaWell').value;
  const contract = document.getElementById('metaContract').value;
  const po = document.getElementById('metaPO').value;

  if (!rigNum) { log('Please enter rig number', 'err'); return; }

  const sheet = currentRawSheets[currentSheetName];
  const { rows, sections } = extractRows({
    rawData: sheet.raw,
    formatted: sheet.formatted,
    headerRow: currentHeaderRow,
    map,
    billingYear,
    billingMonth,
  });

  log(`Sections: data rows ${sections.dataStart + 1} to ${sections.dataEnd + 1}, footer at ${sections.footerStart + 1}`, 'info');

  currentRigNum = rigNum;
  currentExtractedRows = rows;

  log(`Extracted ${rows.length} rows for Rig ${rigNum}`, 'ok');
  showResult(rigNum, cust, well, contract, po, rows);
}

// ============================================
// RESULT VIEW  (rendering delegated to src/views/result.js)
// ============================================
function showResult(rigNum, cust, well, contract, po, rows) {
  setStep(3);
  const daysInMonth = getDaysInMonth(billingYear, billingMonth);
  const conf = computeExtractionConfidence({
    rigNum, headerRow: currentHeaderRow, map: currentMapping,
    rows: rows || [], daysInMonth,
  });
  renderResultDOM(rigNum, cust, well, rows, {
    year: billingYear, month: billingMonth,
    queueStatus: getQueueStatus(),
    conf,
    pendingSheetsCount: pendingSheets.length,
    onEditCell: editCell,
    onRecalcTotal: recalcTotal,
    onScrollToDay: scrollToDay,
  });
}

function scrollToDay(day) {
  const row = document.querySelector(`#resultScroll tr[data-day="${day}"]`);
  if (!row) return;
  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  row.style.transition = 'background .3s';
  const old = row.style.background;
  row.style.background = 'rgba(6,182,212,.25)';
  setTimeout(() => { row.style.background = old; }, 1000);
}

function editCell(td, rowIdx, key) {
  if (!currentExtractedRows || !currentExtractedRows[rowIdx]) return;
  const v = td.textContent.trim();
  if (key === 'operation' || key === 'remarks' || key === 'date') {
    currentExtractedRows[rowIdx][key] = v;
  } else {
    currentExtractedRows[rowIdx][key] = safeNum(v);
    td.textContent = safeNum(v);
  }
}

function recalcTotal(rowIdx) {
  if (!currentExtractedRows || !currentExtractedRows[rowIdx]) return;
  const row = currentExtractedRows[rowIdx];
  const total = HR_KEYS.reduce((s, k) => s + (row[k] || 0), 0);
  row.total_hrs = total;
  const td = document.querySelector(`td[data-idx="${rowIdx}"][data-key="total_hrs"]`);
  if (td) {
    const gap = 24 - total;
    const color = total >= 23.5 ? '#06b6d4' : total > 0 ? '#ef4444' : '#64748b';
    td.style.color = color;
    td.textContent = total + (gap > 0.5 ? ' !!' : '');
    td.title = `Calculated: ${total}h${gap > 0.5 ? ` (${gap.toFixed(1)}h gap)` : ''}`;
  }
}

function goBackToPreview() {
  setStep(2);
}

// ============================================
// ACCEPT / MERGE / CONFLICTS
// ============================================
function acceptData() {
  const rigNum = parseInt(document.getElementById('metaRig').value) || currentRigNum;
  const cust = document.getElementById('metaCust').value;
  const well = document.getElementById('metaWell').value;
  const contract = document.getElementById('metaContract').value;
  const po = document.getElementById('metaPO').value;

  setRigMeta(rigStore, rigNum, { customer: cust, well, contract, po });

  const isPDF = /\.pdf$/i.test(currentFileName);
  const sourceLabel = isPDF ? 'PDF (approved)' : 'Excel';

  const result = mergeRowsIntoRig(rigStore, rigNum, currentExtractedRows, sourceLabel, currentFileName);
  Object.assign(rigStore, result.store);

  updateRigList();
  updateStats();
  autoSave();
  log(`Rig ${rigNum}: +${result.newDays} new days, ${result.mergedDays} merged. Total: ${rigStore[rigNum].rows.length} days.`, 'ok');

  // If this Save came from an "Edit mapping" override of a review card, dismiss that card.
  if (window.__pendingReviewRemoval !== undefined) {
    const id = window.__pendingReviewRemoval;
    const idx = reviewQueue.findIndex(c => c.id === id);
    if (idx >= 0) {
      reviewQueue.splice(idx, 1);
      renderReviewQueue();
    }
    window.__pendingReviewRemoval = undefined;
  }

  if (result.conflicts.length > 0) {
    log(`CONFLICTS DETECTED: ${result.conflicts.length} day(s) have different hours between files`, 'err');
    showConflicts(rigNum, result.conflicts);
    return;
  }

  advanceToNext(rigNum);
}

function advanceToNext(rigNum) {
  if (pendingSheets.length > 0) {
    const nextSheet = pendingSheets.shift();
    log(`Loading next sheet: "${nextSheet}" (${pendingSheets.length} more sheets in file)...`, 'info');
    currentSheetName = nextSheet;
    document.getElementById('sheetSelect').value = nextSheet;
    showPreview();
    return;
  }
  if (fileQueue.length > 0) {
    log(`Moving to next file in queue (${fileQueue.length} remaining)...`, 'info');
    processNextFile();
    return;
  }
  // Queue drained.
  if (batchMode.active) {
    log(`Batch done: ${batchMode.autoAccepted} auto-accepted, ${batchMode.needsReview} need review`, batchMode.needsReview ? 'info' : 'ok');
    finishBatch(batchMode);
    renderBatchDone();
    setStep(1);
    return;
  }
  setStep(1);
  selectRig(rigNum);
}

function replaceRigRowFromConflict(rigNum, c, source) {
  if (!getRig(rigStore, rigNum)) return;
  let chosen = null;
  let chosenSource = 'Manual';
  if (source === 'pdf') {
    if (String(c.newSource || '').includes('PDF')) { chosen = c.newRow; chosenSource = 'PDF'; }
    else if (String(c.existingSource || '').includes('PDF')) { chosen = c.existing; chosenSource = 'PDF'; }
  } else if (source === 'excel') {
    if (String(c.newSource || '').includes('Excel')) { chosen = c.newRow; chosenSource = 'Excel'; }
    else if (String(c.existingSource || '').includes('Excel')) { chosen = c.existing; chosenSource = 'Excel'; }
  }
  if (chosen) {
    const clean = { ...chosen, _source: chosenSource };
    clean.total_hrs = rowTotal(clean);
    replaceRowByDate(rigStore, rigNum, clean);
  }
}

function resolveAllConflicts(rigNum, strategy) {
  const conflicts = LAST_CONFLICTS.conflicts || [];
  if (strategy === 'manual') { selectRig(rigNum); return; }
  if (strategy === 'pdf' || strategy === 'excel') {
    for (const c of conflicts) replaceRigRowFromConflict(rigNum, c, strategy);
    sortRowsByDate(rigStore, rigNum);
  }
  autoSave();
  buildRigList();
  updateStats();
  renderExecutiveSummary();
  log(`Conflict resolution applied: ${strategy.toUpperCase()} for Rig ${rigNum}`, 'ok');
  advanceToNext(rigNum);
}

function showConflicts(rigNum, conflicts) {
  LAST_CONFLICTS.rigNum = rigNum;
  LAST_CONFLICTS.conflicts = conflicts;
  setStep(3);
  const entry = getRig(rigStore, rigNum);
  renderConflictsDOM(rigNum, conflicts, entry ? entry.rows : [], strategy => resolveAllConflicts(rigNum, strategy));
  document.getElementById('resultTitle').textContent = `Rig ${rigNum} — Resolve Conflicts`;
  document.getElementById('resultWarnings').innerHTML = '';
}

// ============================================
// STEP MANAGEMENT
// ============================================
function setStep(n) {
  document.getElementById('step1').className = 'step' + (n === 1 ? ' active' : n > 1 ? ' done' : '');
  document.getElementById('step2').className = 'step' + (n === 2 ? ' active' : n > 2 ? ' done' : '');
  document.getElementById('step3').className = 'step' + (n === 3 ? ' active' : '');
  document.getElementById('panelDrop').style.display = n === 1 ? '' : 'none';
  document.getElementById('panelPreview').style.display = n === 2 ? '' : 'none';
  document.getElementById('panelResult').style.display = n === 3 ? '' : 'none';
}

// ============================================
// RIG LIST + TIMELINE  (timeline HTML delegated to src/views/fleetOverview.js)
// ============================================

function buildRigList() {
  const el = document.getElementById('rigList');
  if (!el) return;
  el.innerHTML = '';
  const days = getDaysInMonth(billingYear, billingMonth);
  for (const rig of RIGS) {
    const cust = RIG_CUST[rig];
    const color = CUST_COLORS[cust] || '#666';
    const store = rigStore[rig];
    const dayCount = store ? store.rows.length : 0;
    const hasData = dayCount > 0;
    const tl = buildTimelineHTML(store, billingYear, billingMonth);
    const isComplete = hasData && dayCount === days && tl.missingDays === 0 && tl.incompleteDays === 0;
    const isPartial = hasData && !isComplete;

    const div = document.createElement('div');
    div.className = 'rig-item' + (isComplete ? ' complete' : isPartial ? ' partial has-data' : hasData ? ' has-data' : '');
    div.id = `ri-${rig}`;
    div.setAttribute('role', 'button');
    div.setAttribute('tabindex', '0');
    div.setAttribute('aria-label', `Rig ${rig} (${cust}) — ${dayCount} of ${days} days`);
    div.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:1px">
        <span class="r-num">${rig}</span>
        <span class="r-cust" style="background:${color}22;color:${color}">${cust}</span>
        <span class="r-days" style="margin-left:auto">${dayCount}/${days}</span>
      </div>
      ${tl.html}
    `;
    div.addEventListener('click', () => selectRig(rig));
    div.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectRig(rig); }
    });
    el.appendChild(div);
  }
}

function updateRigList() { buildRigList(); }

function selectRig(rig) {
  document.querySelectorAll('.rig-item').forEach(el => el.classList.remove('active'));
  const el = document.getElementById(`ri-${rig}`);
  if (el) el.classList.add('active');
  currentRigNum = rig;
  document.getElementById('metaRig').value = rig;
  document.getElementById('metaCust').value = RIG_CUST[rig] || 'PDO';

  const entry = getRig(rigStore, rig);
  if (entry && entry.rows.length > 0) {
    currentExtractedRows = entry.rows;
    showResult(rig, entry.meta.customer, entry.meta.well, entry.meta.contract, entry.meta.po, entry.rows);
  } else {
    setStep(1);
  }
}

// ============================================
// STATS + FLEET OVERVIEW
// ============================================
function updateStats() {
  const { rigs, rows, operatingHours } = aggregateStats(rigStore);
  const sRigs = document.getElementById('sRigs');
  const sRows = document.getElementById('sRows');
  const sOper = document.getElementById('sOper');
  if (sRigs) sRigs.textContent = rigs;
  if (sRows) sRows.textContent = rows;
  if (sOper) sOper.textContent = operatingHours.toFixed(0);
  updateFleetOverview();
  scheduleSummaryRefresh();
}

function updateFleetOverview() {
  renderFleetOverviewDOM(rigStore, billingYear, billingMonth, RIGS, selectRig);
}

// ============================================
// EXPORT
// ============================================
function exportAll() {
  const allRows = buildAllRowsData(rigStore, RIGS);
  if (!allRows.length) { alert('No data to export'); return; }
  const ws = XLSX.utils.json_to_sheet(allRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'All Rigs');
  ws['!cols'] = EXPORT_COL_WIDTHS;
  XLSX.writeFile(wb, `CONSOLIDATED_BILLING_${getMonthName(billingMonth).toUpperCase()}_${billingYear}.xlsx`);
  log(`Exported ${allRows.length} rows`, 'ok');
}

function exportExceptionReport() {
  const qc = buildQCModel(rigStore, billingYear, billingMonth, RIGS);
  if (typeof XLSX === 'undefined') { alert('XLSX library not loaded'); return; }
  const { exRows, rigRows, dailyRows } = buildExceptionReportSheets(qc);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rigRows), 'Rig QC Summary');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(exRows), 'QC Exceptions');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dailyRows), 'Daily Fleet QC');
  XLSX.writeFile(wb, `QC_EXCEPTION_REPORT_${getMonthName(billingMonth).toUpperCase()}_${billingYear}.xlsx`);
  log(`Exported QC report: ${exRows.length} exceptions`, 'ok');
}

function exportJSON() {
  const payload = buildJsonExportPayload(rigStore, billingMonth, billingYear);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `BILLING_STATE_${getMonthName(billingMonth).toUpperCase()}_${billingYear}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  log('Exported JSON state', 'ok');
}

function importJSONFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const result = parseJsonImport(reader.result);
      if (result.billingMonth) billingMonth = result.billingMonth;
      if (result.billingYear) billingYear = result.billingYear;
      updateMonthYearUI();
      clearRigs(rigStore);
      Object.assign(rigStore, result.rigs);
      buildRigList();
      updateStats();
      autoSave();
      renderExecutiveSummary();
      log(`Imported JSON state: ${result.count} rigs`, 'ok');
    } catch (e) {
      alert('Invalid JSON file: ' + e.message);
      log('Import JSON failed: ' + e.message, 'err');
    }
  };
  reader.readAsText(file);
}

function clearAll() {
  if (!confirm('Are you sure you want to clear ALL extracted data for all rigs? This cannot be undone.')) return;
  clearRigs(rigStore);
  buildRigList();
  updateStats();
  setStep(1);
  clearStorage();
  log('Cleared all', 'info');
}

// ============================================
// PERSISTENCE — thin wrappers around src/state/storage.js
// ============================================
function autoSaveNow() {
  const count = saveToStorage(rigStore, billingMonth, billingYear);
  if (count > 0) log(`Auto-saved ${count} rigs to browser storage`, 'info');
  else if (count < 0) log('Auto-save failed', 'err');
}

// Debounced wrapper: coalesces bursts of writes from batch processing into a
// single localStorage hit. manualSaveSession() bypasses this and writes immediately.
let autoSaveHandle = null;
function autoSave() {
  if (autoSaveHandle) clearTimeout(autoSaveHandle);
  autoSaveHandle = setTimeout(() => {
    autoSaveHandle = null;
    autoSaveNow();
  }, 300);
}

function autoLoad() {
  const saved = loadFromStorage();
  if (!saved) return false;
  if (saved.billingMonth) billingMonth = saved.billingMonth;
  if (saved.billingYear) billingYear = saved.billingYear;
  updateMonthYearUI();
  let count = 0;
  for (const [rig, data] of Object.entries(saved.rigs)) {
    const rigNum = parseInt(rig);
    if (!RIGS.includes(rigNum)) continue;
    restoreRig(rigStore, rigNum, {
      meta: data.meta || {},
      rows: data.rows || [],
      files: data.files || ['localStorage'],
    });
    count++;
  }
  if (count === 0) return false;
  buildRigList();
  updateStats();
  log(`Restored ${count} rigs from browser storage (saved ${saved.savedAt ? new Date(saved.savedAt).toLocaleString() : 'unknown'})`, 'ok');
  return true;
}

function clearStorage() {
  clearStorageNow();
  log('Browser storage cleared', 'info');
}

function manualSaveSession() {
  if (autoSaveHandle) { clearTimeout(autoSaveHandle); autoSaveHandle = null; }
  autoSaveNow();
  alert('Session saved in this browser.');
}
function manualLoadSession() {
  const ok = autoLoad();
  renderExecutiveSummary();
  alert(ok ? 'Session loaded from browser storage.' : 'No saved session found.');
}

async function loadConsolidated(buf) {
  log('Loading consolidated data...', 'info');
  const wb = XLSX.read(buf, { type: 'array', cellDates: true, raw: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { defval: null });
  let count = 0;
  for (const row of data) {
    const rig = parseInt(row.Rig || row.rig);
    if (!rig || !RIGS.includes(rig)) continue;
    const entry = ensureRig(rigStore, rig);
    if (entry.files.length === 0) entry.files.push('consolidated');
    updateRigMetaFields(rigStore, rig, {
      customer: safeStr(row.Customer || row.customer) || RIG_CUST[rig] || '',
      well: row.Well || row.well,
      contract: row['Contract No'],
      po: row['P.O'],
    });
    const dateStr = toDateStr(row.Date || row.date, billingYear, billingMonth);
    if (!dateStr) continue;
    const expectedSuffix = `-${getMonthName(billingMonth)}-${billingYear}`;
    if (!dateStr.endsWith(expectedSuffix)) continue;
    const inserted = appendRowIfNew(rigStore, rig, {
      date: dateStr,
      operating: safeNum(row.Operating || row.operating),
      reduced: safeNum(row.Reduced || row.reduced),
      breakdown: safeNum(row.Breakdown || row.breakdown),
      special: safeNum(row.Special || row.special),
      force_maj: safeNum(row['Force Maj'] || row.force_maj),
      zero_rate: safeNum(row['Zero Rate'] || row.zero_rate),
      standby: safeNum(row.Standby || row.standby),
      repair: safeNum(row.Repair || row.repair),
      rig_move: safeNum(row['Rig Move'] || row.rig_move),
      total_hrs: safeNum(row['Total Hrs'] || row.total_hrs),
      obm_oper: safeNum(row['OBM Oper'] || row.obm_oper),
      obm_red: safeNum(row['OBM Red'] || row.obm_red),
      obm_bd: safeNum(row['OBM BD'] || row.obm_bd),
      obm_spe: safeNum(row['OBM Spe'] || row.obm_spe),
      obm_zero: safeNum(row['OBM Zero'] || row.obm_zero),
      operation: safeStr(row.Operation || row.operation),
      total_hrs_repair: safeNum(row['Total Hours Repair'] || row.total_hrs_repair),
      remarks: safeStr(row.Remarks || row.remarks),
    });
    if (inserted) count++;
  }
  for (const rig of RIGS) sortRowsByDate(rigStore, rig);
  log(`Loaded ${count} rows from consolidated file`, 'ok');
  buildRigList();
  updateStats();
}

// ============================================
// EXECUTIVE SUMMARY VIEW
// ============================================
function showAppView(view) {
  const extraction = document.getElementById('extractionView');
  const summary = document.getElementById('summaryView');
  const tabExtraction = document.getElementById('tabExtraction');
  const tabSummary = document.getElementById('tabSummary');
  if (view === 'summary') {
    extraction.style.display = 'none';
    summary.style.display = 'block';
    tabExtraction.classList.remove('active');
    tabSummary.classList.add('active');
    renderExecutiveSummary();
  } else {
    extraction.style.display = 'block';
    summary.style.display = 'none';
    tabSummary.classList.remove('active');
    tabExtraction.classList.add('active');
  }
}

// ============================================
// EXECUTIVE SUMMARY  (rendering delegated to src/views/summary.js)
// ============================================
function renderExecutiveSummary() {
  const model = generateExecutiveSummary(rigStore, billingYear, billingMonth, RIGS);
  renderSummaryDOM(
    model, rigStore, billingYear, billingMonth, RIGS,
    typeof Chart !== 'undefined' ? Chart : null,
    getMonthName(billingMonth), RIGS.length,
  );
}

let summaryRefreshHandle = null;
function scheduleSummaryRefresh() {
  if (summaryRefreshHandle) return;
  summaryRefreshHandle = setTimeout(() => {
    summaryRefreshHandle = null;
    renderExecutiveSummary();
  }, 0);
}

// ============================================
// DRAG & DROP
// ============================================
function setupDrop() {
  const zone = document.getElementById('dropZone');
  const input = document.getElementById('fileInput');
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', async e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    await handleFiles(e.dataTransfer.files);
  });
  // Label semantics handle click; add keyboard activation for Space/Enter.
  zone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      input.click();
    }
  });
  input.addEventListener('change', async e => {
    await handleFiles(e.target.files);
    input.value = '';
  });
  document.body.addEventListener('dragover', e => e.preventDefault());
  document.body.addEventListener('drop', e => e.preventDefault());
}

// ============================================
// EXPOSE HANDLERS FOR INLINE ONCLICK
// ============================================
Object.assign(window, {
  onMonthYearChange, showAppView,
  exportExceptionReport, exportJSON, importJSONFile, exportAll,
  switchSheet, toggleGroup, cancelPreview, autoMap, skipFile,
  extractAllSheets, applyMapping, goBackToPreview,
  acceptAllRemaining, acceptData,
  manualSaveSession, manualLoadSession, clearAll,
  // Debug / test introspection — read-only handle to internal state.
  __getRigStore: () => rigStore,
  __getReviewQueue: () => reviewQueue,
});

// ============================================
// INIT
// ============================================
updateMonthYearUI();
populateCustomerOptions();
buildRigList();
setupDrop();
setStep(1);
log('Ready. Drop a file to start.', 'info');

if (!autoLoad()) {
  log('No saved data in browser storage', 'info');
}

renderExecutiveSummary();
