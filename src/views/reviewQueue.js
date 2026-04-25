// Review Queue view — builds and renders the orange-bordered cards that surface
// files needing manual attention after extraction.
//
// Separation of concerns:
//  • buildReviewCardHTML(card)       — pure HTML string builder, testable without DOM
//  • ensureReviewQueueContainer()    — DOM helper: find-or-create #reviewQueue div
//  • renderReviewQueue(queue, onAction) — reconcile DOM to current queue state
//
// State (the queue array, reviewIdSeq) lives in main.js.
// Action handling (accept/skip/edit) lives in main.js too — those callbacks need
// access to mergeExtractionSilently, showConflicts, updateRigList, etc.

import { escapeHtml } from '../utils.js';

/**
 * Build or locate the #reviewQueue container inside #mainPanel, inserting it
 * after #batchBanner when present.
 * @returns {HTMLElement}
 */
export function ensureReviewQueueContainer() {
  let el = document.getElementById('reviewQueue');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'reviewQueue';
  el.style.cssText = 'display:none;margin:0 0 8px;';
  const mainPanel = document.getElementById('mainPanel');
  if (!mainPanel) return el;
  const banner = document.getElementById('batchBanner');
  if (banner && banner.nextSibling) mainPanel.insertBefore(el, banner.nextSibling);
  else mainPanel.insertBefore(el, mainPanel.firstChild);
  return el;
}

/**
 * Return the HTML string for one review card.
 * Pure function — no DOM access, fully testable.
 *
 * @param {{ id: number, fileName: string, sheetName: string,
 *           rig: number|null, meta: Object, confidence: Object|null,
 *           rows: any[], issues: string[] }} card
 * @returns {string}
 */
export function buildReviewCardHTML(card) {
  const sheetLabel = card.sheetName
    ? `[${escapeHtml(card.sheetName)}]`
    : '';
  const confLabel = card.confidence ? `${card.confidence.score}%` : '';
  const actionBtns = [
    card.rig && card.rows.length
      ? `<button class="btn btn-sm" data-review-action="edit" data-review-id="${card.id}">Edit mapping</button>`
      : '',
    card.rig && card.rows.length
      ? `<button class="btn btn-green btn-sm" data-review-action="accept" data-review-id="${card.id}">Accept anyway</button>`
      : '',
    `<button class="btn btn-red btn-sm" data-review-action="skip" data-review-id="${card.id}">Skip</button>`,
  ].filter(Boolean).join('\n        ');

  return `
    <div class="card" style="padding:12px 14px;margin-bottom:6px;border-color:var(--orange)">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
        <strong style="color:var(--orange);font-size:.85rem">${escapeHtml(card.fileName)}</strong>
        <span style="color:var(--text3);font-size:.72rem">${sheetLabel}</span>
        <span style="color:var(--text2);font-size:.72rem">Rig ${card.rig ?? '?'} · ${escapeHtml(card.meta.customer) || '—'} · ${confLabel}</span>
        <span style="margin-left:auto;color:var(--text3);font-size:.68rem">${card.rows.length} rows extracted</span>
      </div>
      <div style="font-size:.74rem;color:var(--text2);margin-bottom:8px">
        <strong style="color:var(--red)">Issues:</strong>
        <ul style="margin:2px 0 0 18px;padding:0">
          ${card.issues.map(i => `<li>${escapeHtml(i)}</li>`).join('')}
        </ul>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${actionBtns}
      </div>
    </div>`;
}

/**
 * Re-render the entire review queue into the DOM.
 *
 * @param {Object[]} queue   — the live reviewQueue array from main.js
 * @param {Function} onAction — (action: 'accept'|'skip'|'edit', id: number) => void
 */
export function renderReviewQueue(queue, onAction) {
  const el = ensureReviewQueueContainer();
  if (queue.length === 0) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  el.style.display = '';
  el.innerHTML = queue.map(buildReviewCardHTML).join('');

  el.querySelectorAll('[data-review-action]').forEach(btn => {
    const id = parseInt(btn.dataset.reviewId, 10);
    const action = btn.dataset.reviewAction;
    btn.addEventListener('click', () => onAction(action, id));
  });
}
