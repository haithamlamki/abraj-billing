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
import { AUTO_ACCEPT_THRESHOLD, evaluateIssues } from './review.js';
import {
  saveToStorage, loadFromStorage, clearStorage as clearStorageNow,
  buildJsonExportPayload, parseJsonImport,
} from './state/storage.js';
import { createOcrRunner } from './pipeline/ocr.js';
import { parsePdfBuffer } from './pipeline/parsePdf.js';
import { parseExcelBuffer } from './pipeline/parseExcel.js';
import {
  ensureRig, getRig, setRigMeta, setRigMetaFallback, addFileToRig,
  replaceRowByDate, appendRowIfNew, sortRowsByDate, restoreRig,
  clearRigs, aggregateStats, hasData, updateRigMetaFields,
} from './state/rigStore.js';
import {
  createBatch, startBatch, addToBatch, recordSuccess, recordReview,
  pauseBatch as pauseBatchState, resumeBatch as resumeBatchState,
  finishBatch, resetBatch as resetBatchState, isRunning,
  batchProgress,
} from './state/batch.js';

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
const SUMMARY_CHARTS = {};

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
function ensureBatchBanner() {
  let el = document.getElementById('batchBanner');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'batchBanner';
  el.style.cssText = 'display:none;margin:0 0 8px;padding:10px 14px;background:linear-gradient(90deg,rgba(6,182,212,.12),rgba(16,185,129,.08));border:1px solid var(--cyan);border-radius:8px;font-size:.8rem;color:var(--text)';
  const mainPanel = document.getElementById('mainPanel');
  if (mainPanel) mainPanel.insertBefore(el, mainPanel.firstChild);
  return el;
}

function renderBatchBanner() {
  const el = ensureBatchBanner();
  if (!batchMode.active) {
    el.style.display = 'none';
    return;
  }
  el.style.display = '';
  const { total, processed, autoAccepted, needsReview, paused } = batchMode;
  const { pct, remaining, etaSec } = batchProgress(batchMode);
  const etaTxt = remaining === 0 ? '' : ` · ~${etaSec < 60 ? etaSec + 's' : Math.round(etaSec / 60) + 'm'} left`;
  const action = paused ? '<button class="btn btn-sm" id="batchResume">Resume</button>' : '<button class="btn btn-sm" id="batchPause">Pause</button>';
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <strong style="color:var(--cyan);font-size:.85rem">Batch ${paused ? 'paused' : 'processing'}</strong>
      <span>${processed} / ${total} files</span>
      <span style="color:var(--green)">${autoAccepted} auto-accepted</span>
      <span style="color:${needsReview ? 'var(--orange)' : 'var(--text3)'}">${needsReview} need review</span>
      <span style="color:var(--text3)">${etaTxt}</span>
      <div style="margin-left:auto">${action}</div>
    </div>
    <div style="margin-top:6px;height:5px;background:var(--bg3);border-radius:3px;overflow:hidden">
      <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--cyan),var(--green));transition:width .2s"></div>
    </div>
  `;
  const pauseBtn = el.querySelector('#batchPause');
  const resumeBtn = el.querySelector('#batchResume');
  if (pauseBtn) pauseBtn.addEventListener('click', pauseBatch);
  if (resumeBtn) resumeBtn.addEventListener('click', resumeBatch);
}

function renderBatchDone() {
  const el = ensureBatchBanner();
  el.style.display = '';
  const { total, autoAccepted, needsReview, reviews } = batchMode;
  const reviewList = reviews.length
    ? `<ul style="margin:6px 0 0 16px;padding:0;font-size:.74rem;color:var(--text2)">${reviews.map(r => `<li>${r.file} — Rig ${r.rig ?? '?'}: ${r.reason}</li>`).join('')}</ul>`
    : '';
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <strong style="color:var(--green);font-size:.85rem">Batch done</strong>
      <span>${total} files · ${autoAccepted} auto-accepted · ${needsReview} need manual review</span>
      <div style="margin-left:auto"><button class="btn btn-sm" id="batchDismiss">Dismiss</button></div>
    </div>
    ${reviewList}
  `;
  const btn = el.querySelector('#batchDismiss');
  if (btn) btn.addEventListener('click', () => { resetBatch(); });
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

function extractFromSheet({ sheetName, rawData, formatted, fileName, filenameRigHint }) {
  const useData = formatted && formatted.length ? formatted : rawData;
  const headerRow = findHeaderRow(useData);
  const meta = detectMeta(useData, headerRow >= 0 ? headerRow : 10);
  const rig = filenameRigHint || (meta.rig ? parseInt(meta.rig) : null);

  let rows = [];
  let map = {};

  if (headerRow >= 0) {
    // Reuse the autoMap logic: prefer formatted text but fall back to raw text/data.
    const fmtRow = useData[headerRow] || [];
    const rawRow = rawData[headerRow] || [];
    const hRow = [];
    const maxLen = Math.max(fmtRow.length, rawRow.length);
    for (let i = 0; i < maxLen; i++) {
      const fv = safeStr(fmtRow[i]).replace(/\n/g, ' ');
      const rv = safeStr(rawRow[i]).replace(/\n/g, ' ');
      if (/^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/.test(fv) && rv && !/^\d/.test(rv)) hRow.push(rv);
      else if (!fv && rv) hRow.push(rv);
      else hRow.push(fv || rv);
    }
    map = autoMapHeaders(hRow);
    detectUnnamedTextColumns(map, useData, headerRow);

    // Handle "stacked" headers where row above has the column label (e.g., Total / Hours).
    if (headerRow > 0) {
      const prevRow = (useData[headerRow - 1] || []).map(v => safeStr(v));
      for (let c = 0; c < prevRow.length; c++) {
        if (prevRow[c] && hRow[c]) {
          const combined = (prevRow[c] + ' ' + hRow[c]).toLowerCase();
          if (/(total\s*h|total\s*hrs)/.test(combined) && map.total_hrs === undefined) map.total_hrs = c;
          if (/operation/i.test(combined) && map.operation === undefined) map.operation = c;
        }
      }
    }

    // Structured log for inventory tooling — captures the headers seen and the
    // resolved mapping for every silent extraction.
    log(`Silent map [${fileName}]: headers=[${hRow.join(' | ')}] map=${JSON.stringify(map)}`, 'info');

    const extract = extractRows({
      rawData,
      formatted,
      headerRow,
      map,
      billingYear,
      billingMonth,
    });
    rows = extract.rows;
  }

  const confidence = computeExtractionConfidence({
    rigNum: rig,
    headerRow,
    map,
    rows,
    daysInMonth: getDaysInMonth(billingYear, billingMonth),
  });

  // Detect duplicates + over-hours on the extracted rows (independent of mergeRowsIntoRig).
  const seenDates = new Set();
  let duplicates = 0;
  let overHoursCount = 0;
  for (const r of rows) {
    if (seenDates.has(r.date)) duplicates++;
    seenDates.add(r.date);
    if (r.total_hrs > 24.5) overHoursCount++;
  }

  const issues = evaluateIssues({ rig, headerRow, rows, confidence, duplicates, overHoursCount });

  return {
    sheetName, fileName, rig,
    meta: {
      customer: meta.cust || (rig ? RIG_CUST[rig] : '') || '',
      well: meta.well || '',
      contract: meta.contract || '',
      po: meta.po || '',
    },
    headerRow, map, rows, confidence, duplicates, overHoursCount, issues,
    raw: rawData, formatted,
  };
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
  if (!extraction.rig) return { ok: false, conflicts: [] };
  setRigMetaFallback(rigStore, extraction.rig, extraction.meta, { customer: 'PDO' });

  const sourceLabel = /\.pdf$/i.test(fileName) ? 'PDF (approved)' : 'Excel';
  const result = mergeRowsIntoRig(rigStore, extraction.rig, extraction.rows, sourceLabel, fileName);
  Object.assign(rigStore, result.store);

  return { ok: true, ...result };
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
// REVIEW QUEUE UI
// ============================================
function ensureReviewQueueContainer() {
  let el = document.getElementById('reviewQueue');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'reviewQueue';
  el.style.cssText = 'display:none;margin:0 0 8px;';
  const mainPanel = document.getElementById('mainPanel');
  if (!mainPanel) return el;
  // Insert after #batchBanner if present, else at top.
  const banner = document.getElementById('batchBanner');
  if (banner && banner.nextSibling) mainPanel.insertBefore(el, banner.nextSibling);
  else mainPanel.insertBefore(el, mainPanel.firstChild);
  return el;
}

function renderReviewQueue() {
  const el = ensureReviewQueueContainer();
  if (reviewQueue.length === 0) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  el.style.display = '';
  el.innerHTML = reviewQueue.map(c => `
    <div class="card" style="padding:12px 14px;margin-bottom:6px;border-color:var(--orange)">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
        <strong style="color:var(--orange);font-size:.85rem">${escapeHtml(c.fileName)}</strong>
        <span style="color:var(--text3);font-size:.72rem">${c.sheetName ? '[' + escapeHtml(c.sheetName) + ']' : ''}</span>
        <span style="color:var(--text2);font-size:.72rem">Rig ${c.rig ?? '?'} · ${escapeHtml(c.meta.customer) || '—'} · ${c.confidence ? c.confidence.score + '%' : ''}</span>
        <span style="margin-left:auto;color:var(--text3);font-size:.68rem">${c.rows.length} rows extracted</span>
      </div>
      <div style="font-size:.74rem;color:var(--text2);margin-bottom:8px">
        <strong style="color:var(--red)">Issues:</strong>
        <ul style="margin:2px 0 0 18px;padding:0">
          ${c.issues.map(i => `<li>${escapeHtml(i)}</li>`).join('')}
        </ul>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${c.rig && c.rows.length ? `<button class="btn btn-sm" data-review-action="edit" data-review-id="${c.id}">Edit mapping</button>` : ''}
        ${c.rig && c.rows.length ? `<button class="btn btn-green btn-sm" data-review-action="accept" data-review-id="${c.id}">Accept anyway</button>` : ''}
        <button class="btn btn-red btn-sm" data-review-action="skip" data-review-id="${c.id}">Skip</button>
      </div>
    </div>
  `).join('');

  el.querySelectorAll('[data-review-action]').forEach(btn => {
    const id = parseInt(btn.dataset.reviewId);
    const action = btn.dataset.reviewAction;
    btn.addEventListener('click', () => handleReviewAction(action, id));
  });
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
  const data = currentRawSheets[currentSheetName].formatted;
  const rawData = currentRawSheets[currentSheetName].raw;
  const useData = data && data.length ? data : rawData;
  const maxRows = Math.min(useData.length, 60);

  const sections = classifyRows(useData, currentHeaderRow);

  let maxCols = 0;
  for (let r = 0; r < maxRows; r++) {
    if (useData[r]) maxCols = Math.max(maxCols, useData[r].length);
  }
  maxCols = Math.min(maxCols, 20);

  let html = '<table class="preview-table"><thead><tr><th class="row-num">#</th><th style="width:60px">Section</th>';
  for (let c = 0; c < maxCols; c++) html += `<th>Col ${c + 1}</th>`;
  html += '</tr></thead><tbody>';

  for (let r = 0; r < maxRows; r++) {
    const row = useData[r] || [];
    const isHeader = r === currentHeaderRow;

    let sectionLabel = '';
    let rowStyle = '';
    if (currentHeaderRow >= 0) {
      if (r < currentHeaderRow) {
        sectionLabel = '<span style="color:var(--blue);font-size:.55rem">HEADER</span>';
        rowStyle = 'background:rgba(59,130,246,.06)';
      } else if (r === currentHeaderRow) {
        sectionLabel = '<span style="color:var(--cyan);font-size:.55rem;font-weight:700">TABLE HDR</span>';
        rowStyle = 'background:rgba(6,182,212,.15)';
      } else if (r <= sections.dataEnd) {
        sectionLabel = '<span style="color:var(--green);font-size:.55rem">DATA</span>';
      } else {
        sectionLabel = '<span style="color:var(--text3);font-size:.55rem">FOOTER</span>';
        rowStyle = 'background:rgba(100,116,139,.08);opacity:.6';
      }
    }

    html += `<tr class="${isHeader ? 'header-row' : ''}" data-row="${r}" style="cursor:pointer;${rowStyle}">`;
    html += `<td class="row-num">${r + 1}</td>`;
    html += `<td style="text-align:center">${sectionLabel}</td>`;
    for (let c = 0; c < maxCols; c++) {
      const v = c < row.length ? safeStr(row[c]).replace(/\n/g, ' ') : '';
      const display = v.length > 40 ? v.substring(0, 40) + '...' : v;
      html += `<td title="${v.replace(/"/g, '&quot;')}">${display}</td>`;
    }
    html += '</tr>';
  }
  if (useData.length > 60) {
    html += `<tr><td colspan="${maxCols + 2}" style="text-align:center;color:var(--text3)">... ${useData.length - 60} more rows</td></tr>`;
  }
  html += '</tbody></table>';

  const scroll = document.getElementById('previewScroll');
  scroll.innerHTML = html;
  scroll.querySelectorAll('tr[data-row]').forEach(tr => {
    tr.addEventListener('click', () => clickRow(parseInt(tr.dataset.row)));
  });
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
      div.innerHTML = `<label>${tc.label}</label>
        <select id="sel-${tc.key}" data-map-key="${tc.key}">
          <option value="-1">-- not mapped --</option>
          ${colOptions}
        </select>`;
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
  const hRow = useData[currentHeaderRow] || [];
  const rawRow = currentRawData[currentHeaderRow] || [];
  let opts = '';
  const maxCols = Math.min(Math.max(hRow.length, rawRow.length), 20);
  for (let c = 0; c < maxCols; c++) {
    let name = safeStr(hRow[c]).replace(/\n/g, ' ') || safeStr(rawRow[c]).replace(/\n/g, ' ') || `(Col ${c + 1})`;
    const display = name.length > 30 ? name.substring(0, 30) + '...' : name;
    opts += `<option value="${c}">Col ${c + 1}: ${display}</option>`;
  }
  if (useData.length > currentHeaderRow + 1) {
    const dataRow = useData[currentHeaderRow + 1] || [];
    for (let c = maxCols; c < Math.min(dataRow.length, 25); c++) {
      opts += `<option value="${c}">Col ${c + 1}: (no header)</option>`;
    }
  }
  return opts;
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
// RESULT VIEW
// ============================================
function showResult(rigNum, cust, well, contract, po, rows) {
  setStep(3);
  const daysInMonth = getDaysInMonth(billingYear, billingMonth);
  const monthName = getMonthName(billingMonth);

  const complete = rows.filter(r => r.total_hrs >= 23.5).length;
  const partial = rows.filter(r => r.total_hrs > 0 && r.total_hrs < 23.5).length;
  const missing = daysInMonth - rows.length;
  const pct = daysInMonth ? Math.round((complete / daysInMonth) * 100) : 0;
  const pctCls = pct >= 95 ? 'ok' : pct >= 70 ? 'warn' : 'bad';

  document.getElementById('resultSummary').innerHTML = `
    <div class="sum-item"><span class="sum-label">Rig</span><span class="sum-val" style="color:var(--cyan)">${rigNum}</span></div>
    <div class="sum-item"><span class="sum-label">Customer</span><span class="sum-val">${escapeHtml(cust) || '—'}</span></div>
    <div class="sum-item" style="flex:1;min-width:120px"><span class="sum-label">Well</span><span class="sum-val" style="font-size:.85rem">${escapeHtml(well) || '—'}</span></div>
    <div class="sum-item"><span class="sum-label">Days</span><span class="sum-val ${pctCls}">${rows.length} / ${daysInMonth}</span></div>
    <div class="sum-item"><span class="sum-label">Complete</span><span class="sum-val ${pctCls}">${pct}%</span></div>
    ${partial > 0 ? `<div class="sum-item"><span class="sum-label">Partial</span><span class="sum-val warn">${partial}</span></div>` : ''}
    ${missing > 0 ? `<div class="sum-item"><span class="sum-label">Missing</span><span class="sum-val bad">${missing}</span></div>` : ''}
  `;
  document.getElementById('resultTimelineTitle').textContent = `${monthName} ${billingYear} — ${complete} full, ${partial} partial, ${missing} missing`;
  document.getElementById('resultTitle').textContent = `${rows.length} rows loaded${getQueueStatus()}`;

  // Mini timeline
  const dayMap = {};
  for (const row of rows) {
    const d = parseDate(row.date);
    if (d) dayMap[d.getDate()] = { total: row.total_hrs || 0, operating: row.operating || 0 };
  }
  let tlHtml = '<div style="display:flex;gap:2px;align-items:end;height:40px">';
  for (let d = 1; d <= daysInMonth; d++) {
    const rec = dayMap[d];
    if (!rec) {
      tlHtml += `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:1px">
        <div style="width:100%;height:28px;background:var(--red);opacity:.25;border-radius:2px" title="${monthName} ${d}: no data"></div>
        <span style="font-size:.5rem;color:var(--red)">${d}</span></div>`;
    } else {
      const frac = Math.min(rec.total / 24, 1);
      const bg = frac >= 0.98 ? 'var(--green)' : 'var(--orange)';
      const h = Math.max(4, Math.round(frac * 28));
      tlHtml += `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:1px" title="${monthName} ${d}: ${rec.total}h${frac < 0.98 ? ` (${(24 - rec.total).toFixed(1)}h gap)` : ''}">
        <div style="width:100%;height:${28 - h}px"></div>
        <div style="width:100%;height:${h}px;background:${bg};border-radius:2px" data-scroll-day="${d}"></div>
        <span style="font-size:.5rem;color:var(--text3)">${d}</span></div>`;
    }
  }
  tlHtml += '</div>';
  const tlEl = document.getElementById('resultTimeline');
  tlEl.innerHTML = tlHtml;
  tlEl.querySelectorAll('[data-scroll-day]').forEach(el => {
    el.addEventListener('click', () => scrollToDay(parseInt(el.dataset.scrollDay)));
  });

  // Data table
  let html = '<table class="result-table">';
  html += '<thead><tr class="grp-hdr"><th colspan="3"></th>';
  html += '<th class="grp-hrs" colspan="9">Hour categories</th>';
  html += '<th class="grp-hrs" colspan="1">Total</th>';
  html += '<th class="grp-obm" colspan="5">OBM (Oil-Based Mud)</th>';
  html += '<th class="grp-ops" colspan="3">Description</th>';
  html += '</tr><tr>';
  html += '<th class="cat-meta">&nbsp;</th><th class="cat-meta">#</th><th class="cat-meta">Date</th>';
  html += '<th class="cat-hrs">Operating</th><th class="cat-hrs">Reduced</th><th class="cat-hrs">Breakdown</th><th class="cat-hrs">Special</th>';
  html += '<th class="cat-hrs">Force&nbsp;Maj</th><th class="cat-hrs">Zero&nbsp;Rate</th><th class="cat-hrs">Standby</th><th class="cat-hrs">Repair</th><th class="cat-hrs">Rig&nbsp;Move</th>';
  html += '<th class="cat-hrs" title="Auto-calculated: sum of all hour categories">Total *</th>';
  html += '<th class="cat-obm">Oper</th><th class="cat-obm">Red</th><th class="cat-obm">BD</th><th class="cat-obm">Spe</th><th class="cat-obm">Zero</th>';
  html += '<th class="cat-ops">Operation</th><th class="cat-ops">Repair&nbsp;Hrs</th><th class="cat-ops">Remarks</th>';
  html += '</tr></thead><tbody>';

  let totOp = 0, totRed = 0, totBD = 0, totTotal = 0;
  const obmKeys = ['obm_oper', 'obm_red', 'obm_bd', 'obm_spe', 'obm_zero'];
  const hrColors = { operating: '#10b981', reduced: '#f59e0b', breakdown: '#ef4444' };

  rows.forEach((row, i) => {
    const total = row.total_hrs || 0;
    let statusCls = 'bad', statusChar = '×';
    if (total >= 23.5) { statusCls = 'ok'; statusChar = '✓'; }
    else if (total > 0) { statusCls = 'warn'; statusChar = '!'; }
    totOp += row.operating; totRed += row.reduced; totBD += row.breakdown; totTotal += total;

    const d = parseDate(row.date);
    const dayAttr = d ? `data-day="${d.getDate()}"` : '';

    html += `<tr ${dayAttr} class="${statusCls === 'bad' && total > 0 ? 'invalid' : ''}" data-idx="${i}">`;
    html += `<td class="row-status ${statusCls}" title="${statusCls === 'ok' ? '24h OK' : statusCls === 'warn' ? 'Partial day (' + total + 'h)' : 'Missing hours'}">${statusChar}</td>`;
    html += `<td>${i + 1}</td>`;
    html += `<td contenteditable="true" class="editable" data-key="date" style="white-space:nowrap">${row.date}</td>`;

    for (const k of HR_KEYS) {
      const c = hrColors[k] || '';
      const v = row[k] || 0;
      html += `<td contenteditable="true" class="editable" data-key="${k}" data-row-idx="${i}" ${c ? `style="color:${c}"` : ''}>${v}</td>`;
    }

    const gap = 24 - total;
    const totalColor = total >= 23.5 ? '#06b6d4' : total > 0 ? '#ef4444' : '#64748b';
    const gapText = gap > 0.5 ? ` (${gap.toFixed(1)}h gap)` : '';
    html += `<td style="color:${totalColor};font-weight:700" title="Calculated: sum of all hour columns${gapText}" data-idx="${i}" data-key="total_hrs">${total}${gap > 0.5 ? ' !' : ''}</td>`;

    for (const k of obmKeys) {
      const v = row[k] || 0;
      html += `<td contenteditable="true" class="editable" data-key="${k}" data-row-idx="${i}">${v}</td>`;
    }

    html += `<td contenteditable="true" class="editable text-cell" data-key="operation" data-row-idx="${i}" style="min-width:280px;max-width:420px;white-space:normal;line-height:1.3" title="${escapeHtml(row.operation)}">${escapeHtml(row.operation)}</td>`;
    html += `<td contenteditable="true" class="editable" data-key="total_hrs_repair" data-row-idx="${i}">${row.total_hrs_repair || 0}</td>`;
    html += `<td contenteditable="true" class="editable text-cell" data-key="remarks" data-row-idx="${i}">${escapeHtml(row.remarks)}</td>`;
    html += '</tr>';
  });

  html += `<tfoot><tr><td></td><td>Total</td><td>${rows.length} days</td>`;
  html += `<td style="color:#10b981">${totOp.toFixed(1)}</td><td style="color:#f59e0b">${totRed.toFixed(1)}</td><td style="color:#ef4444">${totBD.toFixed(1)}</td>`;
  html += `<td colspan="6"></td><td style="color:#06b6d4">${totTotal.toFixed(0)}</td><td colspan="8"></td></tr></tfoot>`;
  html += '</table>';

  const scroll = document.getElementById('resultScroll');
  scroll.innerHTML = html;
  scroll.querySelectorAll('[contenteditable="true"][data-row-idx]').forEach(td => {
    const idx = parseInt(td.dataset.rowIdx);
    const key = td.dataset.key;
    const isHour = HR_KEYS.includes(key);
    td.addEventListener('blur', () => {
      editCell(td, idx, key);
      if (isHour) recalcTotal(idx);
    });
  });

  // Warnings
  const warnEl = document.getElementById('resultWarnings');
  warnEl.innerHTML = '';
  const warnings = [];
  if (rows.length < daysInMonth) warnings.push({ type: 'warn', msg: `Only ${rows.length} of ${daysInMonth} days loaded — ${daysInMonth - rows.length} day(s) may be in another file.` });
  if (rows.length > daysInMonth) warnings.push({ type: 'bad', msg: `${rows.length} rows but month only has ${daysInMonth} days — possible duplicates.` });
  const badTotals = rows.filter(r => r.total_hrs > 0 && Math.abs(r.total_hrs - 24) > 0.5);
  if (badTotals.length) warnings.push({ type: 'warn', msg: `${badTotals.length} day(s) not totaling 24h. Highlighted in the table.` });
  if (warnings.length) {
    warnEl.innerHTML = '<div class="card" style="padding:10px 14px;margin-top:8px">' +
      warnings.map(w => `<div class="hint ${w.type === 'bad' ? 'warn' : w.type}" style="font-size:.78rem;margin-bottom:2px">&#9888; ${w.msg}</div>`).join('') +
      '</div>';
  }

  // Confidence strip
  const conf = computeExtractionConfidence({
    rigNum, headerRow: currentHeaderRow, map: currentMapping, rows: rows || [],
    daysInMonth,
  });
  const confColor = conf.score >= 90 ? 'var(--green)' : conf.score >= 70 ? 'var(--orange)' : 'var(--red)';
  const confStrip = `<div class="card" style="padding:10px 14px;margin-top:8px;border-color:${confColor}"><div class="hint" style="font-size:.78rem;color:${confColor};font-weight:800">Extraction Confidence: ${conf.score}% — ${conf.status}</div><div class="hint" style="font-size:.72rem;color:var(--text2);margin-top:3px">${conf.issues.length ? conf.issues.join(' · ') : 'Rig, header, mapping, dates, and daily rows look acceptable.'}</div></div>`;
  warnEl.insertAdjacentHTML('afterbegin', confStrip);

  document.getElementById('acceptAllBtn').style.display = pendingSheets.length > 0 ? '' : 'none';
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
  let html = `<div style="padding:16px">
    <div style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:8px;padding:14px;margin-bottom:16px">
      <strong style="color:var(--red);font-size:.95rem">Hours Conflict Detected — ${conflicts.length} day(s)</strong>
      <div style="color:var(--text2);font-size:.82rem;margin-top:4px">Choose how to resolve same-rig/same-date differences. Recommended default: use PDF if it is the signed final billing document.</div>
    </div>
    <table class="result-table" style="min-width:auto"><thead><tr><th>Date</th><th>Existing Source</th><th>Existing Hrs</th><th>New Source</th><th>New Hrs</th><th>Diff</th><th>Current Merged</th><th>Recommended</th></tr></thead><tbody>`;
  for (const c of conflicts) {
    const diff = (safeNum(c.newTotal) - safeNum(c.existingTotal)).toFixed(1);
    const merged = getRig(rigStore, rigNum)?.rows.find(r => r.date === c.date);
    const mergedTotal = merged ? rowTotal(merged) : 0;
    const rec = (String(c.newSource || '').includes('PDF') || String(c.existingSource || '').includes('PDF')) ? 'Use PDF' : 'Manual Review';
    html += `<tr class="conf-row"><td style="white-space:nowrap">${c.date}</td><td>${c.existingSource || ''}</td><td class="num">${fmtNum(c.existingTotal, 1)}h</td><td>${c.newSource || ''}</td><td class="num">${fmtNum(c.newTotal, 1)}h</td><td class="num" style="color:var(--red)">${diff > 0 ? '+' : ''}${diff}h</td><td class="num" style="font-weight:700;color:var(--cyan)">${fmtNum(mergedTotal, 1)}h</td><td>${rec}</td></tr>`;
  }
  html += `</tbody></table><div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
    <button class="btn btn-sm" data-conflict-action="manual">Manual Edit</button>
    <button class="btn btn-sm" data-conflict-action="excel">Use Excel</button>
    <button class="btn btn-sm btn-green" data-conflict-action="pdf">Use PDF</button>
    <button class="btn btn-primary btn-sm" data-conflict-action="merge">Keep Current Merge</button>
  </div></div>`;

  const scroll = document.getElementById('resultScroll');
  scroll.innerHTML = html;
  scroll.querySelectorAll('[data-conflict-action]').forEach(btn => {
    btn.addEventListener('click', () => resolveAllConflicts(rigNum, btn.dataset.conflictAction));
  });
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
// RIG LIST + TIMELINE
// ============================================
function buildTimeline(store) {
  const { map } = getDayMap(store || { rows: [] }, billingYear, billingMonth);
  let html = '<div class="timeline-31">';
  let missingHrs = 0, missingDays = 0, incompleteDays = 0, overDays = 0;
  const monthName = getMonthName(billingMonth);
  const days = getDaysInMonth(billingYear, billingMonth);
  for (let d = 1; d <= days; d++) {
    const rows = map[d] || [];
    const total = rows.reduce((s, r) => s + rowTotal(r), 0);
    const operating = rows.reduce((s, r) => s + safeNum(r.operating), 0);
    if (total >= 23.5 && total <= 24.5) {
      html += `<div class="day-cell full" title="${monthName} ${d}: ${total.toFixed(1)}h total, ${operating.toFixed(1)}h oper"></div>`;
    } else if (total > 24.5) {
      html += `<div class="day-cell partial-day" style="background:var(--purple)" title="${monthName} ${d}: ${total.toFixed(1)}h total — OVER 24h, review duplicate/mapping"></div>`;
      overDays++;
    } else if (total > 0) {
      const gap = 24 - total;
      html += `<div class="day-cell partial-day" title="${monthName} ${d}: ${total.toFixed(1)}h total — ${gap.toFixed(1)}h missing"></div>`;
      missingHrs += gap;
      incompleteDays++;
    } else {
      html += `<div class="day-cell missing" title="${monthName} ${d}: NO DATA — 24 hrs missing"></div>`;
      missingHrs += 24;
      missingDays++;
    }
  }
  html += '</div>';
  return { html, missingDays, incompleteDays, overDays, missingHrs };
}

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
    const tl = buildTimeline(store);
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
  const panel = document.getElementById('fleetOverview');
  if (!panel) return;
  panel.style.display = '';
  const grid = document.getElementById('fleetGrid');
  grid.innerHTML = '';
  const qc = buildQCModel(rigStore, billingYear, billingMonth, RIGS);

  for (const r of qc.rigSummaries) {
    let bg = 'rgba(239,68,68,.15)', color = 'var(--red)';
    if (r.status === 'Complete') { bg = 'rgba(16,185,129,.2)'; color = 'var(--green)'; }
    else if (r.submittedDays > 0) { bg = 'rgba(245,158,11,.15)'; color = 'var(--orange)'; }
    const cell = document.createElement('div');
    cell.style.cssText = `background:${bg};border-radius:3px;padding:2px 4px;text-align:center;cursor:pointer;flex:1;min-width:0`;
    cell.setAttribute('role', 'button');
    cell.setAttribute('tabindex', '0');
    cell.setAttribute('aria-label', `Rig ${r.rig} — ${r.status}, ${r.submittedDays} of ${qc.daysInMonth} days`);
    cell.innerHTML = `<div style="font-family:'JetBrains Mono',monospace;font-weight:700;font-size:.65rem;color:${color}">${r.rig}</div><div style="font-size:.45rem;color:var(--text3)">${r.submittedDays}/${qc.daysInMonth}</div>`;
    cell.title = `Rig ${r.rig}: ${r.status}; ${r.missingDays} missing, ${r.partialDays} partial, ${r.missingHrs.toFixed(1)} missing hrs`;
    cell.addEventListener('click', () => selectRig(r.rig));
    cell.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectRig(r.rig); }
    });
    grid.appendChild(cell);
  }
  const summary = document.getElementById('fleetSummary');
  if (summary) summary.textContent = `${qc.fullRigs}/${RIGS.length} complete · ${qc.reviewRigs} need review · ${qc.missingHrs.toFixed(0)}h missing`;
  const miss = document.getElementById('fleetMissing');
  if (miss) {
    miss.style.display = 'block';
    miss.innerHTML = qc.reviewRigs
      ? qc.rigSummaries.filter(r => r.status !== 'Complete').slice(0, 10)
        .map(r => `<span style="color:var(--orange)">Rig ${r.rig}: ${r.missingDays} missing + ${r.partialDays} partial + ${r.overDays} over (${r.missingHrs.toFixed(0)}h)</span>`)
        .join(' · ')
      : '<span style="color:var(--green)">All rigs complete for the full month.</span>';
  }
}

// ============================================
// EXPORT
// ============================================
function exportAll() {
  const allRows = [];
  for (const rig of RIGS) {
    const s = rigStore[rig];
    if (!s || !s.rows.length) continue;
    for (const r of s.rows) {
      allRows.push({
        Rig: rig, Customer: s.meta.customer, Well: s.meta.well,
        'Contract No': s.meta.contract, 'P.O': s.meta.po,
        Date: r.date, Operating: r.operating, Reduced: r.reduced, Breakdown: r.breakdown,
        Special: r.special, 'Force Maj': r.force_maj, 'Zero Rate': r.zero_rate,
        Standby: r.standby, Repair: r.repair, 'Rig Move': r.rig_move,
        'Total Hrs': r.total_hrs,
        'OBM Oper': r.obm_oper, 'OBM Red': r.obm_red, 'OBM BD': r.obm_bd,
        'OBM Spe': r.obm_spe, 'OBM Zero': r.obm_zero,
        Operation: r.operation, 'Total Hours Repair': r.total_hrs_repair, Remarks: r.remarks,
      });
    }
  }
  if (!allRows.length) { alert('No data to export'); return; }
  const ws = XLSX.utils.json_to_sheet(allRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'All Rigs');
  ws['!cols'] = [
    { wch: 6 }, { wch: 8 }, { wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 12 },
    { wch: 9 }, { wch: 9 }, { wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 9 },
    { wch: 9 }, { wch: 8 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 8 },
    { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 50 }, { wch: 12 }, { wch: 25 },
  ];
  XLSX.writeFile(wb, `CONSOLIDATED_BILLING_${getMonthName(billingMonth).toUpperCase()}_${billingYear}.xlsx`);
  log(`Exported ${allRows.length} rows`, 'ok');
}

function exportExceptionReport() {
  const qc = buildQCModel(rigStore, billingYear, billingMonth, RIGS);
  if (typeof XLSX === 'undefined') { alert('XLSX library not loaded'); return; }
  const exRows = qc.exceptions.map(e => ({
    Rig: e.rig, Customer: e.customer, Date: e.date,
    'Submitted Hrs': Number(e.submitted.toFixed(2)),
    'Missing Hrs': Number(e.missing.toFixed(2)),
    Issue: e.issue, 'Action Required': e.action, Severity: e.severity,
  }));
  const rigRows = qc.rigSummaries.map(r => ({
    Rig: r.rig, Customer: r.customer, Well: r.well,
    'Submitted Days': r.submittedDays, 'Expected Days': r.expectedDays,
    'Complete Days': r.completeDays, 'Missing Days': r.missingDays,
    'Partial Days': r.partialDays, 'Over 24h Days': r.overDays,
    'Submitted Hrs': Number(r.total.toFixed(2)),
    'Missing Hrs': Number(r.missingHrs.toFixed(2)),
    'Completion %': Number(r.completion.toFixed(2)), Status: r.status,
  }));
  const dailyRows = qc.daily.map(d => ({
    Day: d.day, 'Expected Hrs': d.expected,
    'Submitted Hrs': Number(d.submitted.toFixed(2)),
    'Missing Hrs': Number(d.missing_hrs.toFixed(2)),
    'Complete Rigs': d.completeRigs, 'Issue Rigs': d.issueRigs,
  }));
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

function setKpi(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function destroyChart(id) {
  if (SUMMARY_CHARTS[id]) {
    SUMMARY_CHARTS[id].destroy();
    delete SUMMARY_CHARTS[id];
  }
}

function makeChart(id, config) {
  const canvas = document.getElementById(id);
  if (!canvas || typeof Chart === 'undefined') return;
  destroyChart(id);
  SUMMARY_CHARTS[id] = new Chart(canvas, config);
}

function renderExecutiveSummary() {
  const empty = document.getElementById('summaryEmpty');
  const content = document.getElementById('summaryContent');
  if (!empty || !content) return;
  const model = generateExecutiveSummary(rigStore, billingYear, billingMonth, RIGS);
  const hasData = model.records.length > 0;
  empty.style.display = hasData ? 'none' : 'block';
  content.style.display = hasData ? 'block' : 'none';
  const sub = document.getElementById('summarySubtitle');
  if (sub) sub.textContent = `${getMonthName(billingMonth)} ${billingYear} billing extraction QC — full-month rule for all ${RIGS.length} rigs`;
  if (!hasData) return;

  const t = model.totals;
  const util = model.expectedHours ? ((t.operating / model.expectedHours) * 100) : 0;
  setKpi('kpiActiveRigs', RIGS.length);
  setKpi('kpiCustomers', `${model.customers.length} customers`);
  setKpi('kpiSubmittedDays', fmtNum(model.records.length));
  setKpi('kpiExpectedDays', `${fmtNum(RIGS.length * model.daysInMonth)} expected rig-days`);
  setKpi('kpiOperating', fmtNum(t.operating));
  setKpi('kpiUtil', `${util.toFixed(1)}% of expected fleet hours`);
  setKpi('kpiReduced', fmtNum(t.reduced));
  setKpi('kpiReducedPct', `${t.total_hrs ? (t.reduced / t.total_hrs * 100).toFixed(1) : 0}% of submitted`);
  setKpi('kpiMissingHrs', fmtNum(model.qc.missingHrs));
  const missingDays = model.qc.rigSummaries.reduce((s, r) => s + r.missingDays, 0);
  const partialDays = model.qc.rigSummaries.reduce((s, r) => s + r.partialDays, 0);
  const overDays = model.qc.rigSummaries.reduce((s, r) => s + r.overDays, 0);
  setKpi('kpiMissingDays', `${missingDays} missing / ${partialDays} partial / ${overDays} over`);
  setKpi('kpiTotalBilled', fmtNum(t.total_hrs));
  setKpi('kpiQCCompletion', `${model.qc.completion.toFixed(1)}%`);
  setKpi('kpiQCCompletionNote', `${fmtNum(model.qc.submittedHours)} / ${fmtNum(model.qc.expectedHours)} hrs submitted`);
  setKpi('kpiFullRigs', `${model.qc.fullRigs}/${RIGS.length}`);
  setKpi('kpiReviewRigs', model.qc.reviewRigs);
  setKpi('kpiCriticalExceptions', model.qc.criticalExceptions);

  renderSummaryTables(model);
  renderSummaryHeatmap(model);
  renderSummaryCharts(model);
}

function renderSummaryTables(model) {
  const rigBody = document.getElementById('summaryRigTable');
  if (rigBody) {
    rigBody.innerHTML = model.rigRows.map(r => {
      const cls = r.status === 'Complete' ? 'qc-ok' : (r.status === 'Partial' ? 'qc-warn' : 'qc-bad');
      return `<tr><td><strong>${r.rig}</strong></td><td>${escapeHtml(r.customer)}</td><td>${r.days}/${model.daysInMonth}</td><td class="num">${fmtNum(r.total, 1)}</td><td class="num" style="color:${r.missingHrs > 0 ? 'var(--red)' : 'var(--green)'}">${fmtNum(r.missingHrs, 1)}</td><td><span class="qc-badge ${cls}">${escapeHtml(r.status)}</span></td></tr>`;
    }).join('');
  }
  const custBody = document.getElementById('summaryCustomerTable');
  if (custBody) {
    custBody.innerHTML = model.customerRows.map(c =>
      `<tr><td><strong>${escapeHtml(c.customer)}</strong></td><td class="num">${c.rigs}</td><td class="num">${fmtNum(c.operating, 1)}</td><td class="num">${fmtNum(c.total, 1)}</td><td class="num" style="color:${c.missingHrs > 0 ? 'var(--red)' : 'var(--green)'}">${fmtNum(c.missingHrs, 1)}</td></tr>`
    ).join('');
  }
  const exBody = document.getElementById('summaryExceptionTable');
  if (exBody) {
    const ex = model.qc.exceptions.slice(0, 1200);
    exBody.innerHTML = ex.map(e =>
      `<tr class="${e.severity === 'critical' ? 'bad-row' : 'conf-row'}"><td>${e.rig}</td><td>${escapeHtml(e.customer)}</td><td>${escapeHtml(e.date)}</td><td class="num">${fmtNum(e.submitted, 1)}</td><td class="num">${fmtNum(e.missing, 1)}</td><td><span class="qc-badge ${e.severity === 'critical' ? 'qc-bad' : 'qc-warn'}">${escapeHtml(e.issue)}</span></td><td>${escapeHtml(e.action)}</td></tr>`
    ).join('') + (model.qc.exceptions.length > 1200
      ? `<tr><td colspan="7" style="text-align:center;color:var(--text3)">Showing first 1,200 of ${model.qc.exceptions.length} exceptions</td></tr>`
      : '');
  }
  const recBody = document.getElementById('summaryRecordsTable');
  if (recBody) {
    const rows = model.records.slice(0, 1000);
    recBody.innerHTML = rows.map(r => {
      let cls = 'qc-bad', label = 'Missing';
      if (r.total_hrs > 24.5) { cls = 'qc-bad'; label = 'Over 24h'; }
      else if (r.qc_status === 'Complete') { cls = 'qc-ok'; label = 'Complete'; }
      else if (r.qc_status === 'Partial') { cls = 'qc-warn'; label = `Partial -${fmtNum(r.missing_hrs, 1)}h`; }
      return `<tr><td>${r.rig}</td><td>${escapeHtml(r.customer)}</td><td>${escapeHtml(r.well)}</td><td>${escapeHtml(r.date)}</td><td class="num">${fmtNum(r.operating, 1)}</td><td class="num">${fmtNum(r.reduced, 1)}</td><td class="num">${fmtNum(r.breakdown, 1)}</td><td class="num">${fmtNum(r.rig_move, 1)}</td><td class="num">${fmtNum(r.total_hrs, 1)}</td><td><span class="qc-badge ${cls}">${label}</span></td></tr>`;
    }).join('') + (model.records.length > 1000
      ? `<tr><td colspan="10" style="text-align:center;color:var(--text3)">Showing first 1,000 of ${model.records.length} records</td></tr>`
      : '');
  }
}

function renderSummaryHeatmap(model) {
  const grid = document.getElementById('summaryHeatmap');
  if (!grid) return;
  grid.style.setProperty('--days', model.daysInMonth);
  let html = '<div class="summary-heat-label" style="font-weight:800">Rig</div>';
  for (let d = 1; d <= model.daysInMonth; d++) html += `<div class="summary-day-head">${d}</div>`;
  for (const rig of RIGS) {
    const store = rigStore[rig] || { rows: [] };
    const { map } = getDayMap(store, billingYear, billingMonth);
    html += `<div class="summary-heat-label"><strong>${rig}</strong></div>`;
    for (let d = 1; d <= model.daysInMonth; d++) {
      const total = (map[d] || []).reduce((s, r) => s + rowTotal(r), 0);
      let cls = 'missing', label = 'Missing 24h', txt = '';
      if (total >= 23.5 && total <= 24.5) { cls = 'full'; label = `${fmtNum(total, 1)}h complete`; txt = Math.round(total); }
      else if (total > 24.5) { cls = 'partial'; label = `${fmtNum(total, 1)}h OVER 24h`; txt = '!'; }
      else if (total > 0) { cls = 'partial'; label = `${fmtNum(total, 1)}h, missing ${fmtNum(24 - total, 1)}h`; txt = Math.round(total); }
      html += `<div class="summary-heat-cell ${cls}" title="Rig ${rig} Day ${d}: ${label}">${txt}</div>`;
    }
  }
  grid.innerHTML = html;
}

function renderSummaryCharts(model) {
  const gridColor = 'rgba(148,163,184,.18)';
  const tickColor = '#94a3b8';
  const chartDefaults = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: tickColor } } },
    scales: {
      x: { ticks: { color: tickColor }, grid: { color: gridColor } },
      y: { ticks: { color: tickColor }, grid: { color: gridColor }, beginAtZero: true },
    },
  };
  makeChart('summaryHoursPie', {
    type: 'doughnut',
    data: {
      labels: ['Operating', 'Reduced', 'Breakdown', 'Rig Move', 'Zero Rate', 'Other'],
      datasets: [{
        data: [
          model.totals.operating, model.totals.reduced, model.totals.breakdown,
          model.totals.rig_move, model.totals.zero_rate,
          model.totals.special + model.totals.force_maj + model.totals.standby + model.totals.repair,
        ],
        backgroundColor: ['#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#64748b', '#06b6d4'],
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { color: tickColor } } },
    },
  });
  makeChart('summaryCustomerBar', {
    type: 'bar',
    data: {
      labels: model.customerRows.map(c => c.customer),
      datasets: [
        { label: 'Operating', data: model.customerRows.map(c => c.operating), backgroundColor: '#10b981' },
        { label: 'Reduced', data: model.customerRows.map(c => c.reduced), backgroundColor: '#f59e0b' },
        { label: 'Breakdown', data: model.customerRows.map(c => c.breakdown), backgroundColor: '#ef4444' },
      ],
    },
    options: {
      ...chartDefaults,
      scales: {
        x: { stacked: true, ticks: { color: tickColor }, grid: { color: gridColor } },
        y: { stacked: true, ticks: { color: tickColor }, grid: { color: gridColor }, beginAtZero: true },
      },
    },
  });
  makeChart('summaryDailyLine', {
    type: 'line',
    data: {
      labels: model.daily.map(d => d.day),
      datasets: [
        { label: 'Submitted Hours', data: model.daily.map(d => d.submitted), borderColor: '#06b6d4', backgroundColor: 'rgba(6,182,212,.15)', tension: .25, fill: true },
        { label: 'Expected Hours', data: model.daily.map(d => d.expected), borderColor: '#64748b', borderDash: [4, 4], tension: 0 },
      ],
    },
    options: chartDefaults,
  });
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
