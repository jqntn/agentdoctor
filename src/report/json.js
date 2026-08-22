import { computeGrade } from '../grade.js';

/** Machine-readable report. Stable shape - treat additions as the only change. */
export function renderJson(input) {
  return JSON.stringify({
    version: 1,
    tool: 'agentdoctor',
    toolVersion: input.version,
    root: input.workspace.root,
    scannedFiles: input.workspace.files.map((f) => ({
      path: f.display, kind: f.kind, scope: f.scope, bytes: f.bytes,
    })),
    skippedFiles: input.workspace.skipped ?? [],
    rulesRun: input.ran,
    suppressed: input.suppressed,
    grade: computeGrade(input.findings),
    summary: {
      error: input.findings.filter((f) => f.severity === 'error').length,
      warning: input.findings.filter((f) => f.severity === 'warning').length,
      info: input.findings.filter((f) => f.severity === 'info').length,
    },
    findings: input.findings.map((f) => ({
      ruleId: f.ruleId,
      severity: f.severity,
      category: f.category,
      message: f.message,
      help: f.help ?? null,
      file: f.display,
      absolutePath: f.file,
      line: f.line,
      column: f.column ?? null,
      configPath: f.configPath ?? null,
      snippet: f.snippet ?? null,
    })),
  }, null, 2);
}
