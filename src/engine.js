import { createHash } from 'node:crypto';
import { allRules } from './rules/index.js';
import { ISSUES_URL } from './links.js';

export const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 };

/**
 * @typedef {Object} Finding
 * @property {string} ruleId
 * @property {'error'|'warning'|'info'} severity
 * @property {string} category
 * @property {string} message
 * @property {string} [help]
 * @property {string} file        absolute path
 * @property {string} display     path shown to the user
 * @property {number} line
 * @property {number} [column]
 * @property {string} [configPath]
 * @property {string} [snippet]
 */

/**
 * Runs every enabled rule over a discovered workspace.
 *
 * @param {import('./discover.js').discover extends (...a:any)=>infer R ? R : never} workspace
 * @param {{ rules?: any[], disabled?: Set<string>|string[], minSeverity?: string,
 *           severityOverrides?: Record<string,string>,
 *           baseline?: Set<string> }} [options]
 * @returns {{ findings: Finding[], ran: string[], suppressed: number }}
 */
export function lint(workspace, options = {}) {
  const rules = options.rules ?? allRules;
  const disabled = normalizeSet(options.disabled);
  const severityOverrides = options.severityOverrides ?? {};
  const baseline = options.baseline ?? new Set();

  /** @type {Finding[]} */
  const findings = [];
  const ran = [];
  let suppressed = 0;

  const inlineDisables = collectInlineDisables(workspace);

  for (const rule of rules) {
    if (disabled.has(rule.id) || disabled.has(rule.category)) continue;
    ran.push(rule.id);

    const report = (finding) => {
      const file = finding.file ?? {};
      const severity = severityOverrides[rule.id] ?? finding.severity ?? rule.severity;
      const entry = {
        ruleId: rule.id,
        severity,
        category: rule.category,
        message: finding.message,
        help: finding.help ?? rule.help,
        file: file.path ?? finding.absolutePath ?? workspace.root,
        display: file.display ?? finding.display ?? '.',
        line: finding.line ?? 1,
        column: finding.column,
        configPath: finding.configPath,
        snippet: finding.snippet,
      };

      if (isInlineDisabled(inlineDisables, entry)) {
        suppressed += 1;
        return;
      }
      if (baseline.has(fingerprint(entry))) {
        suppressed += 1;
        return;
      }
      findings.push(entry);
    };

    try {
      rule.check({ workspace, report, files: workspace.files, helpers });
    } catch (error) {
      findings.push({
        ruleId: 'internal/rule-crashed',
        severity: 'warning',
        category: 'internal',
        message: `Rule "${rule.id}" failed to run: ${error.message}`,
        help: `This is a bug in agentdoctor. Please report it with the config that triggered it: ${ISSUES_URL}`,
        file: workspace.root,
        display: '.',
        line: 1,
      });
    }
  }

  const minSeverity = options.minSeverity ?? 'info';
  const cutoff = SEVERITY_ORDER[minSeverity] ?? 2;
  const filtered = findings.filter((f) => (SEVERITY_ORDER[f.severity] ?? 2) <= cutoff);

  filtered.sort((a, b) => {
    const bySeverity = (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3);
    if (bySeverity !== 0) return bySeverity;
    if (a.display !== b.display) return a.display.localeCompare(b.display);
    if (a.line !== b.line) return a.line - b.line;
    return a.ruleId.localeCompare(b.ruleId);
  });

  return { findings: filtered, ran, suppressed };
}

/**
 * Stable identity for a finding, used by baselines and suppression.
 *
 * Anchored to the config path where one exists, and otherwise to a hash of the
 * finding's own content. Line numbers are deliberately not part of the identity:
 * a baseline that breaks because someone inserted a line further up the file is
 * a baseline people stop trusting.
 */
export function fingerprint(finding) {
  return `${finding.ruleId}::${finding.display}::${anchorOf(finding)}`;
}

/**
 * Anchors are chosen most-stable first:
 *
 *  1. the offending value itself, when the rule captured one. Permission rules
 *     live in arrays, so `permissions.allow[0]` changes meaning the moment
 *     anyone inserts a rule above it — the rule text does not.
 *  2. the config path, for structural findings that have no single value
 *     (an empty deny list, a missing required key).
 *  3. the message, for findings about a whole file.
 *
 * Line numbers are never used: an unrelated edit further up the file must not
 * invalidate an accepted baseline.
 */
function anchorOf(finding) {
  if (finding.snippet) return hash(finding.snippet);
  if (finding.configPath) return finding.configPath;
  return hash(finding.message ?? '');
}

const hash = (material) => createHash('sha1').update(String(material)).digest('hex').slice(0, 12);

/** Helpers handed to every rule so rule code stays declarative. */
export const helpers = {
  /** Resolves the source position of a config path within a file. */
  at(file, configPath) {
    const positions = file.positions;
    if (!positions) return { line: 1, column: 1 };
    return positions.get(configPath) ?? positions.get(`${configPath} key`) ?? { line: 1, column: 1 };
  },

  /** Frontmatter key line number, for markdown-backed config. */
  atFrontmatter(file, key) {
    const lines = file.frontmatter?.__lines;
    if (lines && lines[key]) return { line: lines[key], column: 1 };
    return { line: 1, column: 1 };
  },

  byKind(files, ...kinds) {
    const wanted = new Set(kinds);
    return files.filter((f) => wanted.has(f.kind));
  },

  /** Reads a value out of parsed settings by dotted path. */
  get(data, path) {
    return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), data);
  },

  /**
   * Splits a permission rule into tool and argument matcher.
   * "Bash(npm run *)" -> { tool: 'Bash', argument: 'npm run *' }
   */
  parsePermission(rule) {
    if (typeof rule !== 'string') return { tool: null, argument: null, raw: rule };
    const match = /^([A-Za-z_][A-Za-z0-9_-]*)\s*\((.*)\)\s*$/s.exec(rule.trim());
    if (!match) return { tool: rule.trim(), argument: null, raw: rule };
    return { tool: match[1], argument: match[2], raw: rule };
  },

  /**
   * Rough token estimate. Deliberately conservative and dependency-free: the
   * goal is an order-of-magnitude signal about context cost, not exact billing.
   */
  estimateTokens(text) {
    if (!text) return 0;
    const words = text.split(/\s+/).filter(Boolean).length;
    const chars = text.length;
    return Math.round(Math.max(chars / 4, words * 1.3));
  },
};

function normalizeSet(value) {
  if (!value) return new Set();
  return value instanceof Set ? value : new Set(value);
}

/**
 * Supports `agentdoctor-disable <rule-id>` comments in markdown and JSON
 * config, scoped to the whole file.
 */
function collectInlineDisables(workspace) {
  const map = new Map();
  for (const file of workspace.files) {
    const ids = new Set();
    const pattern = /agentdoctor-disable(?:-file)?\s+([A-Za-z0-9/_,\s-]+)/g;
    let match;
    while ((match = pattern.exec(file.text)) !== null) {
      for (const id of match[1].split(/[,\s]+/)) {
        if (id) ids.add(id.trim());
      }
    }
    if (ids.size) map.set(file.path, ids);
  }
  return map;
}

function isInlineDisabled(map, finding) {
  const ids = map.get(finding.file);
  if (!ids) return false;
  return ids.has(finding.ruleId) || ids.has(finding.category) || ids.has('all');
}
