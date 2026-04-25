// Conflict resolution helper — pure, no DOM, fully testable.
//
// Export:
//   chooseConflictRow(conflict, strategy) → { row, source } | null
//
// Used by replaceRigRowFromConflict in main.js.

/**
 * Given a conflict object and a resolution strategy, return the row to keep.
 *
 * @param {{ newSource, newRow, existingSource, existing }} conflict
 * @param {'pdf'|'excel'|'manual'|'merge'} strategy
 * @returns {{ row: Object, source: string } | null}
 *   null  → strategy is 'manual' / 'merge', or the requested source is not
 *           present in this conflict (caller should handle gracefully).
 */
export function chooseConflictRow(conflict, strategy) {
  if (strategy === 'pdf') {
    if (String(conflict.newSource      || '').includes('PDF')) return { row: conflict.newRow,   source: 'PDF' };
    if (String(conflict.existingSource || '').includes('PDF')) return { row: conflict.existing, source: 'PDF' };
  }
  if (strategy === 'excel') {
    if (String(conflict.newSource      || '').includes('Excel')) return { row: conflict.newRow,   source: 'Excel' };
    if (String(conflict.existingSource || '').includes('Excel')) return { row: conflict.existing, source: 'Excel' };
  }
  return null; // manual / merge / source not found
}
