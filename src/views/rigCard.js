// Rig card view helpers — pure HTML builder, no DOM, fully testable.
//
// Export:
//   buildRigCardHTML(rig, cust, color, dayCount, days, tlHtml) → innerHTML string
//
// The DOM construction (creating the .rig-item div, wiring click/keydown
// handlers, calling selectRig) stays in main.js::buildRigList().

/**
 * Build the inner HTML for one rig card in the fleet sidebar.
 * Pure — no DOM access.
 *
 * @param {number} rig       — rig number
 * @param {string} cust      — customer abbreviation (e.g. "ARA")
 * @param {string} color     — customer accent colour (hex)
 * @param {number} dayCount  — submitted day count for this rig
 * @param {number} days      — total days in the billing month
 * @param {string} tlHtml    — timeline HTML from buildTimelineHTML().html
 * @returns {string}
 */
export function buildRigCardHTML(rig, cust, color, dayCount, days, tlHtml) {
  return `
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:1px">
      <span class="r-num">${rig}</span>
      <span class="r-cust" style="background:${color}22;color:${color}">${cust}</span>
      <span class="r-days" style="margin-left:auto">${dayCount}/${days}</span>
    </div>
    ${tlHtml}`;
}
