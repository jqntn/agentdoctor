import { SEVERITY_ORDER } from '../engine.js';

/**
 * Control Sequence Introducer, built from a char code so this source file
 * stays pure ASCII and survives copy-paste through any pipeline.
 */
const CSI = String.fromCharCode(27) + '[';

/** ANSI helpers that no-op when colour is unwanted. */
export function makeStyle(enabled) {
  const wrap = (open, close) => (text) => (enabled ? `${CSI}${open}m${text}${CSI}${close}m` : String(text));
  return {
    bold: wrap(1, 22),
    dim: wrap(2, 22),
    red: wrap(31, 39),
    yellow: wrap(33, 39),
    blue: wrap(34, 39),
    cyan: wrap(36, 39),
    green: wrap(32, 39),
    magenta: wrap(35, 39),
    underline: wrap(4, 24),
  };
}

export function shouldUseColor(stream = process.stdout, env = process.env) {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '0') return true;
  if (env.CI && !env.GITHUB_ACTIONS) return false;
  return Boolean(stream.isTTY);
}

const SEVERITY_LABEL = {
  error: (s) => s.red('error'),
  warning: (s) => s.yellow('warn '),
  info: (s) => s.blue('info '),
};

/**
 * Renders a human-readable report.
 *
 * @param {{ findings: any[], workspace: any, ran: string[], suppressed: number,
 *           elapsedMs: number, color?: boolean }} input
 * @returns {string}
 */
export function renderTerminal(input) {
  const s = makeStyle(input.color !== false);
  const { findings, workspace } = input;
  const out = [];

  const counts = { error: 0, warning: 0, info: 0 };
  for (const finding of findings) counts[finding.severity] = (counts[finding.severity] ?? 0) + 1;

  const fileWord = workspace.files.length === 1 ? 'config file' : 'config files';
  out.push('');
  out.push(`${s.bold('agentdoctor')} ${s.dim(`scanned ${workspace.files.length} ${fileWord} in ${workspace.root}`)}`);
  out.push('');

  if (findings.length === 0) {
    out.push(`  ${s.green('OK')}  No problems found.`);
    out.push('');
    out.push(summaryLine(s, counts, input));
    return out.join('\n');
  }

  // Group by file so the reader fixes one file at a time.
  const byFile = new Map();
  for (const finding of findings) {
    if (!byFile.has(finding.display)) byFile.set(finding.display, []);
    byFile.get(finding.display).push(finding);
  }

  const indent = ' '.repeat(17);
  for (const [display, group] of byFile) {
    out.push(s.underline(s.bold(display)));
    group.sort((a, b) => (SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]) || (a.line - b.line));
    for (const finding of group) {
      const raw = `${finding.line}${finding.column ? `:${finding.column}` : ''}`;
      const location = s.dim(raw) + ' '.repeat(Math.max(1, 8 - raw.length));
      const label = (SEVERITY_LABEL[finding.severity] ?? SEVERITY_LABEL.info)(s);
      out.push(`  ${location}${label}  ${finding.message}`);
      if (finding.snippet) out.push(`${indent}${s.dim('|')} ${s.cyan(finding.snippet)}`);
      if (finding.help) {
        for (const line of wrapText(finding.help, 76)) out.push(`${indent}${s.dim(line)}`);
      }
      out.push(`${indent}${s.dim(s.magenta(finding.ruleId))}`);
      out.push('');
    }
  }

  out.push(summaryLine(s, counts, input));
  return out.join('\n');
}

/** Soft-wraps help text so long guidance stays readable in a narrow terminal. */
function wrapText(text, width) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let current = '';
  for (const word of words) {
    if (current === '') {
      current = word;
    } else if (current.length + 1 + word.length > width) {
      lines.push(current);
      current = word;
    } else {
      current += ` ${word}`;
    }
  }
  if (current) lines.push(current);
  return lines.map((line, index) => (index === 0 ? `-> ${line}` : `   ${line}`));
}

function summaryLine(s, counts, input) {
  const lines = [];
  const parts = [];
  if (counts.error) parts.push(s.red(`${counts.error} error${counts.error === 1 ? '' : 's'}`));
  if (counts.warning) parts.push(s.yellow(`${counts.warning} warning${counts.warning === 1 ? '' : 's'}`));
  if (counts.info) parts.push(s.blue(`${counts.info} info`));
  const summary = parts.length ? parts.join(', ') : s.green('clean');
  lines.push(`${s.bold('Summary')}  ${summary}  ${s.dim(`- ${input.ran.length} rules in ${input.elapsedMs}ms`)}`);

  if (input.suppressed > 0) {
    const word = input.suppressed === 1 ? 'finding' : 'findings';
    lines.push(s.dim(`         ${input.suppressed} ${word} suppressed by baseline or inline comment`));
  }
  const skipped = input.workspace.skipped ?? [];
  if (skipped.length > 0) {
    lines.push(s.dim(`         ${skipped.length} file(s) skipped - credential files are never read`));
  }
  return lines.join('\n');
}
