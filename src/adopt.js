/**
 * Adoption commands: the one-command paths from "ran it once" to "installed".
 *
 * Each writes exactly one well-known file, refuses to overwrite, and prints
 * what it did plus the next step. They exist because the gap between a
 * drive-by `npx @jqntn/agentdoctor` and a permanent CI check is where most tools
 * lose people (and agents) - these close that gap in a single action that is
 * safe to run unattended.
 */
import { existsSync, writeFileSync, readFileSync, mkdirSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeGrade, GRADE_COLORS } from './grade.js';
import { REPO_URL, BADGE_BASE_URL } from './links.js';

export const CI_WORKFLOW_PATH = '.github/workflows/agentdoctor.yml';

const CI_WORKFLOW = `name: agentdoctor

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read
  security-events: write

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22

      # Findings annotate the PR diff via code scanning.
      - run: npx @jqntn/agentdoctor --no-user --sarif > agentdoctor.sarif
        continue-on-error: true
      - uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: agentdoctor.sarif
        continue-on-error: true

      # The actual gate: exit 1 on errors.
      # Adopting on a repo with existing findings? Commit a baseline first:
      #   npx @jqntn/agentdoctor --no-user --write-baseline .agentdoctor-baseline.json
      # then change the line below to:
      #   npx @jqntn/agentdoctor --no-user --baseline .agentdoctor-baseline.json --quiet
      - run: npx @jqntn/agentdoctor --no-user --quiet
`;

export const SKILL_PATH = '.claude/skills/config-audit';

/**
 * The canonical skill ships inside the package at plugin/skills/config-audit/ -
 * the same files the plugin marketplace serves - so a skill installed either
 * way can never drift from the published one.
 */
const PACKAGED_SKILL = join(dirname(fileURLToPath(import.meta.url)), '..', 'plugin', 'skills', 'config-audit');

/** Writes a file if absent. Returns a { written, path, message } outcome. */
function writeOnce(root, relative, contents) {
  const target = join(root, relative);
  if (existsSync(target)) {
    return { written: false, path: relative, message: `${relative} already exists; not overwriting.` };
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
  return { written: true, path: relative, message: `Wrote ${relative}` };
}

export function initCi(root) {
  return writeOnce(root, CI_WORKFLOW_PATH, CI_WORKFLOW);
}

export const AGENTS_PATH = 'AGENTS.md';
const AGENTS_MARKER_START = '<!-- agentdoctor:start -->';
const AGENTS_MARKER_END = '<!-- agentdoctor:end -->';

/**
 * The section is deliberately short: AGENTS.md rides along in every session's
 * context for the agents that read it, so this must not become the kind of
 * memory bloat agentdoctor's own cost rules exist to flag.
 */
const AGENTS_SECTION = `${AGENTS_MARKER_START}
## Agent configuration hygiene (agentdoctor)

After editing any agent config (.claude/ settings, hooks, permissions, .mcp.json, skills,
subagents, CLAUDE.md/AGENTS.md), audit it:

\`\`\`sh
npx @jqntn/agentdoctor . --no-user --json
\`\`\`

Exit 1 means findings exist (the JSON on stdout is still valid); exit 2 means the run itself
failed. Findings arrive most-severe-first; fix each by editing \`file\` at \`line\` as its
\`help\` field describes (\`configPath\` names the exact key), then verify with
\`npx @jqntn/agentdoctor . --no-user --quiet\` (exit 0 = clean). Suppress an intentional finding with
an \`agentdoctor-disable <rule-id>\` comment in that file and state why. Never delete or
weaken a \`deny\` rule, never widen an \`allow\` rule, never echo unredacted secrets.
${AGENTS_MARKER_END}`;

/**
 * Installs the audit instructions where Codex, Cursor, Gemini CLI, Jules and
 * every other AGENTS.md-reading tool will see them. Creates the file if
 * missing, appends if present, refuses if the marker already exists.
 */
export function initAgents(root) {
  const target = join(root, AGENTS_PATH);
  if (existsSync(target)) {
    const current = readFileSync(target, 'utf8');
    if (current.includes(AGENTS_MARKER_START)) {
      return { written: false, path: AGENTS_PATH, message: `${AGENTS_PATH} already has an agentdoctor section; not duplicating it.` };
    }
    writeFileSync(target, `${current.replace(/\n*$/, '')}\n\n${AGENTS_SECTION}\n`);
    return { written: true, path: AGENTS_PATH, message: `Appended the agentdoctor section to ${AGENTS_PATH}` };
  }
  writeFileSync(target, `# AGENTS.md\n\n${AGENTS_SECTION}\n`);
  return { written: true, path: AGENTS_PATH, message: `Wrote ${AGENTS_PATH} with the agentdoctor section` };
}

export function initSkill(root) {
  const target = join(root, SKILL_PATH);
  if (existsSync(target)) {
    return { written: false, path: SKILL_PATH, message: `${SKILL_PATH} already exists; not overwriting.` };
  }
  cpSync(PACKAGED_SKILL, target, { recursive: true });
  return { written: true, path: SKILL_PATH, message: `Wrote ${SKILL_PATH}/ (SKILL.md + fix recipes)` };
}

/**
 * A paste-ready score card for chat, issues, or a launch thread.
 *
 * Contains only rule ids and counts - never messages, paths, or snippets - so
 * it is safe to share from a private repo without reviewing it first.
 */
export function shareCard(result) {
  const { findings, workspace } = result;
  const grade = computeGrade(findings);
  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warning').length;
  const info = findings.filter((f) => f.severity === 'info').length;
  const files = workspace.files.length;

  const counts = [
    errors && `${errors} error${errors === 1 ? '' : 's'}`,
    warnings && `${warnings} warning${warnings === 1 ? '' : 's'}`,
    info && `${info} info`,
  ].filter(Boolean).join(', ') || 'no findings';

  const topRules = [...new Set(findings.map((f) => f.ruleId))].slice(0, 3);

  const lines = [
    `## agentdoctor grade: ${grade}`,
    '',
    `${files} agent config file${files === 1 ? '' : 's'} scanned - ${counts}.`,
  ];
  if (topRules.length) {
    lines.push('', ...topRules.map((id) => `- \`${id}\``));
  }
  lines.push('', 'Check your own agent config:', '', '```', 'npx @jqntn/agentdoctor', '```', '', REPO_URL);
  return `${lines.join('\n')}\n`;
}

/** Markdown for a README badge that states the current grade. */
export function badgeMarkdown(result) {
  const grade = computeGrade(result.findings);
  const color = GRADE_COLORS[grade] ?? '64748B';
  const img = `${BADGE_BASE_URL}/agentdoctor-${encodeURIComponent(grade)}-${color}`;
  return [
    `[![agentdoctor: ${grade}](${img})](${REPO_URL})`,
    '',
    '<!-- Keep it honest: regenerate after config changes with `npx @jqntn/agentdoctor --badge`,',
    '     or let CI gate on the real thing: `npx @jqntn/agentdoctor --init-ci` -->',
  ].join('\n') + '\n';
}
