export const AUTO_ACCEPT_THRESHOLD = 90;

/**
 * Classify an extraction attempt: returns a list of human-readable issue strings.
 * Empty array means the extraction is clean and can be merged silently.
 */
export function evaluateIssues({ rig, headerRow, rows, confidence, duplicates = 0, overHoursCount = 0 }) {
  const issues = [];
  if (!rig) issues.push('rig not detected');
  if (headerRow < 0) issues.push('header row not detected');
  if (!rows || rows.length === 0) issues.push('no valid daily rows extracted');
  if (overHoursCount > 0) issues.push(`${overHoursCount} row(s) over 24 hours`);
  if (duplicates > 0) issues.push(`${duplicates} duplicate date(s)`);
  if (confidence && confidence.score < AUTO_ACCEPT_THRESHOLD) {
    issues.push(`low confidence (${confidence.score}%)`);
  }
  return issues;
}
