// Batch banner view — pure HTML builders + DOM renderer.
//
// Pure (testable):
//   buildBatchBannerHTML(batchState, progress)  → HTML string for in-progress banner
//   buildBatchDoneHTML(batchState)               → HTML string for completed banner
//
// DOM:
//   renderBatchBanner(batchState, { onPause, onResume, batchProgress })
//   renderBatchDone(batchState, { onDismiss })
//   ensureBatchBanner()

import { batchProgress } from '../state/batch.js';

// ── pure HTML builders ────────────────────────────────────────────────────────

/**
 * Build the in-progress batch banner HTML.
 *
 * @param {{ active, total, processed, autoAccepted, needsReview, paused }} batchState
 * @param {{ pct, remaining, etaSec }} progress — result of batchProgress()
 * @returns {string}
 */
export function buildBatchBannerHTML(batchState, progress) {
  const { total, processed, autoAccepted, needsReview, paused } = batchState;
  const { pct, remaining, etaSec } = progress;
  const etaTxt = remaining === 0 ? '' : ` · ~${etaSec < 60 ? etaSec + 's' : Math.round(etaSec / 60) + 'm'} left`;
  const action = paused
    ? '<button class="btn btn-sm" id="batchResume">Resume</button>'
    : '<button class="btn btn-sm" id="batchPause">Pause</button>';
  return `
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
}

/**
 * Build the completed batch banner HTML.
 *
 * @param {{ total, autoAccepted, needsReview, reviews }} batchState
 * @returns {string}
 */
export function buildBatchDoneHTML(batchState) {
  const { total, autoAccepted, needsReview, reviews } = batchState;
  const reviewList = reviews.length
    ? `<ul style="margin:6px 0 0 16px;padding:0;font-size:.74rem;color:var(--text2)">${
        reviews.map(r => `<li>${r.file} — Rig ${r.rig ?? '?'}: ${r.reason}</li>`).join('')
      }</ul>`
    : '';
  return `
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <strong style="color:var(--green);font-size:.85rem">Batch done</strong>
      <span>${total} files · ${autoAccepted} auto-accepted · ${needsReview} need manual review</span>
      <div style="margin-left:auto"><button class="btn btn-sm" id="batchDismiss">Dismiss</button></div>
    </div>
    ${reviewList}
  `;
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

/** Find or create the #batchBanner element. */
export function ensureBatchBanner() {
  let el = document.getElementById('batchBanner');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'batchBanner';
  el.style.cssText = 'display:none;margin:0 0 8px;padding:10px 14px;background:linear-gradient(90deg,rgba(6,182,212,.12),rgba(16,185,129,.08));border:1px solid var(--cyan);border-radius:8px;font-size:.8rem;color:var(--text)';
  const mainPanel = document.getElementById('mainPanel');
  if (mainPanel) mainPanel.insertBefore(el, mainPanel.firstChild);
  return el;
}

/**
 * Render the in-progress banner.
 *
 * @param {{ active, ... }} batchState
 * @param {{ onPause: Function, onResume: Function }} callbacks
 */
export function renderBatchBanner(batchState, { onPause, onResume }) {
  const el = ensureBatchBanner();
  if (!batchState.active) { el.style.display = 'none'; return; }
  el.style.display = '';
  el.innerHTML = buildBatchBannerHTML(batchState, batchProgress(batchState));
  const pauseBtn  = el.querySelector('#batchPause');
  const resumeBtn = el.querySelector('#batchResume');
  if (pauseBtn)  pauseBtn.addEventListener('click',  onPause);
  if (resumeBtn) resumeBtn.addEventListener('click', onResume);
}

/**
 * Render the completed-batch banner.
 *
 * @param {{ total, autoAccepted, needsReview, reviews }} batchState
 * @param {{ onDismiss: Function }} callbacks
 */
export function renderBatchDone(batchState, { onDismiss }) {
  const el = ensureBatchBanner();
  el.style.display = '';
  el.innerHTML = buildBatchDoneHTML(batchState);
  const btn = el.querySelector('#batchDismiss');
  if (btn) btn.addEventListener('click', onDismiss);
}
