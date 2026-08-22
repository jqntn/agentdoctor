#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { run, VERSION, allRules, CATEGORIES } from '../src/index.js';
import { fingerprint } from '../src/engine.js';
import { renderTerminal, shouldUseColor } from '../src/report/terminal.js';
import { renderJson } from '../src/report/json.js';
import { renderSarif } from '../src/report/sarif.js';
import { initCi, initSkill, shareCard, badgeMarkdown } from '../src/adopt.js';

const HELP = `agentdoctor ${VERSION} - lint your AI coding-agent configuration

Usage
  agentdoctor [path]                 Audit a project (defaults to the current directory)
  agentdoctor --explain <rule-id>    Show what a rule checks and why
  agentdoctor --list-rules           List every rule

Output
  --json                   Machine-readable findings on stdout
  --sarif                  SARIF 2.1.0, for GitHub code scanning and other CI
  --quiet                  Print nothing; rely on the exit code
  --no-color               Disable ANSI colour (also honours NO_COLOR)

Scope
  --no-user                Skip user-level config in ~/.claude
  --only <cat,...>         Run only these categories (${CATEGORIES.join(', ')})
  --disable <id,...>       Skip specific rules or whole categories
  --min-severity <level>   error | warning | info (default: info)

CI
  --max-warnings <n>       Fail if more than n warnings are found
  --baseline <file>        Ignore findings recorded in this file
  --write-baseline <file>  Record current findings as the accepted baseline

Team policy
  --policy <file>          Team policy file (default: agentdoctor.policy.json)
  --init-policy            Write a starter agentdoctor.policy.json

Adopt & share
  --init-ci                Write a ready-made GitHub Actions workflow (SARIF + gate)
  --init-skill             Write a Claude Code skill that audits and fixes config
  --badge                  Print a README badge showing this project's current grade
  --share                  Print a paste-ready score card (rule ids and counts only,
                           never messages or paths - safe to share from private repos)

Exit codes
  0  no errors
  1  at least one error (or warnings over --max-warnings)
  2  bad usage

Suppress a rule for one file by adding a comment:  agentdoctor-disable <rule-id>
`;

function parseArgs(argv) {
  const flags = {
    positional: [],
    json: false, sarif: false, quiet: false, color: null,
    noUser: false, only: [], disable: [], minSeverity: 'info',
    maxWarnings: null, baseline: null, writeBaseline: null,
    policy: null, explain: null, listRules: false,
    initPolicy: false, initCi: false, initSkill: false,
    share: false, badge: false, help: false, version: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new UsageError(`${arg} requires a value`);
      }
      i += 1;
      return value;
    };
    switch (arg) {
      case '--json': flags.json = true; break;
      case '--sarif': flags.sarif = true; break;
      case '--quiet': case '-q': flags.quiet = true; break;
      case '--no-color': flags.color = false; break;
      case '--color': flags.color = true; break;
      case '--no-user': flags.noUser = true; break;
      case '--only': flags.only.push(...next().split(',').map((s) => s.trim()).filter(Boolean)); break;
      case '--disable': flags.disable.push(...next().split(',').map((s) => s.trim()).filter(Boolean)); break;
      case '--min-severity': flags.minSeverity = next(); break;
      case '--max-warnings': flags.maxWarnings = Number(next()); break;
      case '--baseline': flags.baseline = next(); break;
      case '--write-baseline': flags.writeBaseline = next(); break;
      case '--policy': flags.policy = next(); break;
      case '--explain': flags.explain = next(); break;
      case '--list-rules': flags.listRules = true; break;
      case '--init-policy': flags.initPolicy = true; break;
      case '--init-ci': flags.initCi = true; break;
      case '--init-skill': flags.initSkill = true; break;
      case '--share': flags.share = true; break;
      case '--badge': flags.badge = true; break;
      case '--help': case '-h': flags.help = true; break;
      case '--version': case '-v': flags.version = true; break;
      default:
        if (arg.startsWith('-')) throw new UsageError(`Unknown option "${arg}"`);
        flags.positional.push(arg);
    }
  }
  return flags;
}

class UsageError extends Error {}

/**
 * Piping into `head`, `less` or a closed pager is ordinary usage. Without this,
 * the closed pipe surfaces as an unhandled EPIPE and a Node stack trace.
 */
function ignoreBrokenPipe() {
  for (const stream of [process.stdout, process.stderr]) {
    stream.on('error', (error) => {
      if (error.code === 'EPIPE') process.exit(0);
      throw error;
    });
  }
}

const STARTER_POLICY = {
  $comment: 'agentdoctor team policy. Commit this next to your repo root.',
  $wildcards: 'A single * is literal. Use ** to mean "anything here".',
  requiredDeny: ['Read(./.env*)', 'Read(**/.ssh/**)', 'Read(**/*.pem)', 'Read(**/.aws/credentials)'],
  forbiddenAllow: ['Bash(*)', 'Bash(:*)', 'Bash()', 'WebFetch(*)', 'Bash(**sudo**)', 'Bash(**rm -rf**)'],
  forbiddenPermissionModes: ['bypassPermissions'],
  allowedMcpServers: [],
  requiredHooks: [],
  maxMemoryTokens: 6000,
};

function main() {
  let flags;
  try {
    flags = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n\nRun agentdoctor --help\n`);
    return 2;
  }

  if (flags.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (flags.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (flags.listRules) return listRules(flags);
  if (flags.explain) return explainRule(flags.explain);

  const root = resolve(flags.positional[0] ?? process.cwd());
  if (!existsSync(root)) {
    process.stderr.write(`No such directory: ${root}\n`);
    return 2;
  }

  if (flags.initPolicy) return initPolicy(root);
  if (flags.initCi || flags.initSkill) {
    let failed = false;
    for (const [enabled, init, next] of [
      [flags.initCi, initCi, 'Findings will annotate PRs and errors will fail the build on the next push.'],
      [flags.initSkill, initSkill, 'Claude Code will now offer config audits; try asking it to "audit my agent config".'],
    ]) {
      if (!enabled) continue;
      const outcome = init(root);
      process[outcome.written ? 'stdout' : 'stderr'].write(`${outcome.message}\n`);
      if (outcome.written) process.stdout.write(`${next}\n`);
      else failed = true;
    }
    return failed ? 2 : 0;
  }

  if (!['error', 'warning', 'info'].includes(flags.minSeverity)) {
    process.stderr.write(`--min-severity must be error, warning or info\n`);
    return 2;
  }

  let baseline = new Set();
  if (flags.baseline) {
    if (!existsSync(flags.baseline)) {
      process.stderr.write(`Baseline file not found: ${flags.baseline}\n`);
      return 2;
    }
    try {
      const parsed = JSON.parse(readFileSync(flags.baseline, 'utf8'));
      baseline = new Set(Array.isArray(parsed.fingerprints) ? parsed.fingerprints : []);
    } catch (error) {
      process.stderr.write(`Baseline file is not readable: ${error.message}\n`);
      return 2;
    }
  }

  const result = run(root, {
    includeUserScope: !flags.noUser,
    policyPath: flags.policy,
    disabled: flags.disable,
    minSeverity: flags.minSeverity,
    only: flags.only,
    baseline,
  });

  if (flags.writeBaseline) {
    const payload = {
      version: 1,
      generatedBy: `agentdoctor ${VERSION}`,
      fingerprints: result.findings.map((f) => fingerprint(f)),
    };
    writeFileSync(flags.writeBaseline, `${JSON.stringify(payload, null, 2)}\n`);
    if (!flags.quiet) {
      process.stdout.write(`Wrote ${payload.fingerprints.length} accepted findings to ${flags.writeBaseline}\n`);
    }
    return 0;
  }

  const payload = { ...result, version: VERSION };
  if (flags.share) {
    process.stdout.write(shareCard(result));
    return 0;
  }
  if (flags.badge) {
    process.stdout.write(badgeMarkdown(result));
    return 0;
  }
  if (flags.json) {
    process.stdout.write(`${renderJson(payload)}\n`);
  } else if (flags.sarif) {
    process.stdout.write(`${renderSarif(payload)}\n`);
  } else if (!flags.quiet) {
    const color = flags.color ?? shouldUseColor(process.stdout, process.env);
    process.stdout.write(`${renderTerminal({ ...payload, color })}\n`);
  }

  const errors = result.findings.filter((f) => f.severity === 'error').length;
  const warnings = result.findings.filter((f) => f.severity === 'warning').length;
  if (errors > 0) return 1;
  if (flags.maxWarnings !== null && Number.isFinite(flags.maxWarnings) && warnings > flags.maxWarnings) return 1;
  return 0;
}

function listRules(flags) {
  const wanted = flags.only.length ? new Set(flags.only) : null;
  const rows = allRules
    .filter((rule) => !wanted || wanted.has(rule.category) || wanted.has(rule.id))
    .map((rule) => ({
      id: rule.id,
      severity: rule.severity,
      title: rule.title,
    }));
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
    return 0;
  }
  const width = Math.max(...rows.map((r) => r.id.length));
  for (const row of rows) {
    process.stdout.write(`${row.id.padEnd(width)}  ${row.severity.padEnd(7)}  ${row.title}\n`);
  }
  process.stdout.write(`\n${rows.length} rules\n`);
  return 0;
}

function explainRule(id) {
  const rule = allRules.find((r) => r.id === id);
  if (!rule) {
    const near = allRules.filter((r) => r.id.includes(id) || r.category === id).map((r) => r.id);
    process.stderr.write(`No rule "${id}".${near.length ? `\n\nDid you mean:\n  ${near.join('\n  ')}\n` : '\n'}`);
    return 2;
  }
  process.stdout.write([
    rule.id,
    '',
    `  Title      ${rule.title}`,
    `  Category   ${rule.category}`,
    `  Severity   ${rule.severity}`,
    '',
    '  Why it matters',
    ...wrap(rule.help ?? '', 72).map((line) => `    ${line}`),
    '',
    `  Suppress with a comment in the offending file:`,
    `    agentdoctor-disable ${rule.id}`,
    '',
  ].join('\n'));
  return 0;
}

function initPolicy(root) {
  const target = resolve(root, 'agentdoctor.policy.json');
  if (existsSync(target)) {
    process.stderr.write(`${target} already exists; not overwriting.\n`);
    return 2;
  }
  writeFileSync(target, `${JSON.stringify(STARTER_POLICY, null, 2)}\n`);
  process.stdout.write(`Wrote ${target}\nEdit it, commit it, then run agentdoctor in CI.\n`);
  return 0;
}

function wrap(text, width) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    if (current === '') current = word;
    else if (current.length + 1 + word.length > width) { lines.push(current); current = word; }
    else current += ` ${word}`;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

ignoreBrokenPipe();
process.exitCode = main();
