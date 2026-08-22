/**
 * The health grade: one glanceable letter for a whole config audit.
 *
 * The formula is deliberately simple enough to state in a sentence, because a
 * grade nobody can explain is a grade nobody trusts:
 *
 *   A+  zero findings
 *   A   info only
 *   B   no errors, 1-2 warnings
 *   C   no errors, 3+ warnings
 *   D   1-2 errors
 *   F   3+ errors
 *
 * Grades are computed from the post-filter finding set, so a baseline or
 * suppression that hides a finding also lifts the grade - the grade describes
 * what is actionable today, not history.
 */
export function computeGrade(findings) {
  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warning').length;
  if (errors >= 3) return 'F';
  if (errors >= 1) return 'D';
  if (warnings >= 3) return 'C';
  if (warnings >= 1) return 'B';
  if (findings.length > 0) return 'A';
  return 'A+';
}

/** Badge color per grade, used by --badge and the share card. */
export const GRADE_COLORS = {
  'A+': '34D399', A: '34D399', B: 'A3E635', C: 'FBBF24', D: 'FB923C', F: 'F87171',
};

export function gradeSummary(findings) {
  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warning').length;
  const info = findings.filter((f) => f.severity === 'info').length;
  return { grade: computeGrade(findings), errors, warnings, info };
}
