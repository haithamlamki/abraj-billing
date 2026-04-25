// File routing helpers — pure, no DOM, fully testable.
//
// Exports:
//   shouldSkipFile(fileName)       → { skip: boolean, reason: string }
//   detectRigFromFilename(fileName) → number | null
//
// Used by processNextFile in main.js to decide whether to process a
// dropped file and which rig number to seed from its name.

/**
 * Return whether a file should be silently skipped during batch processing.
 *
 * Skipped categories (do not contain daily billing rows):
 *  – Rig-move reports  ("BST 384 Move Feb Rig110.pdf")
 *  – DocuSign sign-off documents
 *  – Ticket-only files ("Rig204 ticket.pdf") — KEEP combined "Billing & Ticket" files
 *
 * @param {string} fileName
 * @returns {{ skip: boolean, reason: string }}
 */
export function shouldSkipFile(fileName) {
  if (/\bmove\b/i.test(fileName))   return { skip: true, reason: 'rig-move report' };
  if (/docusign/i.test(fileName))   return { skip: true, reason: 'docusign file' };
  if (/\bticket\b/i.test(fileName) && !/billing/i.test(fileName))
                                     return { skip: true, reason: 'ticket-only file' };
  return { skip: false, reason: '' };
}

/**
 * Extract a 3-digit rig number from a filename.
 *
 * Tries two patterns in order:
 *  1. Leading digits   → "204_March_2026.xlsx"
 *  2. Rig keyword      → "Rig104 Feb.pdf", "RIG 110 billing.xlsx"
 *
 * @param {string} fileName
 * @returns {number|null}
 */
export function detectRigFromFilename(fileName) {
  const m = fileName.match(/^(\d{3})/) || fileName.match(/rig[\s_-]*(\d{3})/i);
  return m ? parseInt(m[1]) : null;
}
