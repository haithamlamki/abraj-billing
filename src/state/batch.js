// Batch-mode state machine.
//
// The batch state is a single mutable object plus a small set of pure
// transition functions. Every transition is total — given the current state
// and inputs, the resulting state is fully determined and free of side
// effects. main.js owns the single batchMode instance and re-renders the
// banner whenever a transition fires; the rendering itself stays in main.js
// because it touches the DOM.
//
// Lifecycle:
//   create → startBatch(N)  ┐
//                           │  recordSuccess() / recordReview()  (per file)
//                           │  addToBatch(M)  (when more files arrive mid-run)
//                           │  pauseBatch() / resumeBatch()      (user)
//   …                       │
//   finishBatch()           ┘  (queue drained)
//   resetBatch()              (clear UI)

/** Build a fresh batch state. */
export function createBatch() {
  return {
    active: false,
    total: 0,
    processed: 0,
    autoAccepted: 0,
    needsReview: 0,
    paused: false,
    reviews: [],   // [{ file, rig, reason }]
    startedAt: 0,
  };
}

/** Begin a new batch run. Resets per-run counters and stamps startedAt. */
export function startBatch(state, fileCount) {
  state.active = true;
  state.startedAt = Date.now();
  state.processed = 0;
  state.autoAccepted = 0;
  state.needsReview = 0;
  state.reviews = [];
  state.total = fileCount;
  state.paused = false;
  return state;
}

/** Add more files to an in-flight batch (drag-and-drop while running). */
export function addToBatch(state, fileCount) {
  state.total += fileCount;
  return state;
}

/** Record a clean auto-accepted file. */
export function recordSuccess(state) {
  state.processed++;
  state.autoAccepted++;
  return state;
}

/** Record a file that landed in the manual-review queue. */
export function recordReview(state, file, rig, reason) {
  state.processed++;
  state.needsReview++;
  state.reviews.push({ file, rig, reason });
  return state;
}

export function pauseBatch(state) { state.paused = true; return state; }
export function resumeBatch(state) { state.paused = false; return state; }

/** Mark the batch as no longer active (queue drained). Keeps counters for
 *  the "Batch done" summary banner. */
export function finishBatch(state) { state.active = false; return state; }

/** Hard reset — for the Dismiss button on the done banner. */
export function resetBatch(state) {
  state.active = false;
  state.total = 0;
  state.processed = 0;
  state.autoAccepted = 0;
  state.needsReview = 0;
  state.paused = false;
  state.reviews = [];
  state.startedAt = 0;
  return state;
}

/** True when the batch is running and not currently paused. */
export function isRunning(state) {
  return state.active && !state.paused;
}

/** True when there is anything to display in the banner. */
export function hasPendingWork(state) {
  return state.active || state.processed > 0;
}

/**
 * Compute display-only fields used by the banner (pure, no DOM).
 *
 * @returns {{ pct: number, perFileMs: number, remaining: number, etaSec: number }}
 */
export function batchProgress(state, now = Date.now()) {
  const pct = state.total ? Math.round((state.processed / state.total) * 100) : 0;
  const elapsed = state.startedAt ? now - state.startedAt : 0;
  const perFileMs = state.processed > 0 ? elapsed / state.processed : 0;
  const remaining = state.total - state.processed;
  const etaSec = remaining > 0 && perFileMs > 0
    ? Math.max(1, Math.round(remaining * perFileMs / 1000))
    : 0;
  return { pct, perFileMs, remaining, etaSec };
}
