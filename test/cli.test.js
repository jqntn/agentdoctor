import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { makeProject, cleanup } from './helpers.js';

const CLI = new URL('../bin/agentdoctor.js', import.meta.url).pathname;
const MESSY = new URL('./fixtures/messy', import.meta.url).pathname;
const CLEAN = new URL('./fixtures/clean', import.meta.url).pathname;

/** Runs the CLI and captures stdout plus the exit code. */
function cli(args, options = {}) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1', ...options.env },
    });
    return { code: 0, stdout };
  } catch (error) {
    return { code: error.status, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

test('piping into a command that closes early does not crash', () => {
  // Regression: `agentdoctor --list-rules | head` used to surface EPIPE as an
  // unhandled error with a Node stack trace.
  const output = execSync(`${process.execPath} ${CLI} --list-rules 2>&1 | head -3`, {
    encoding: 'utf8', shell: '/bin/bash',
  });
  assert.doesNotMatch(output, /EPIPE|Unhandled|node:internal/, `stack trace leaked: ${output}`);
  assert.equal(output.trim().split('\n').length, 3);
});

test('a full report also survives a closed pipe', () => {
  const output = execSync(`NO_COLOR=1 ${process.execPath} ${CLI} ${MESSY} --no-user 2>&1 | head -4`, {
    encoding: 'utf8', shell: '/bin/bash',
  });
  assert.doesNotMatch(output, /EPIPE|node:internal/);
});

test('--version and --help exit cleanly', () => {
  assert.match(cli(['--version']).stdout.trim(), /^\d+\.\d+\.\d+$/);
  const help = cli(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /Usage/);
  assert.match(help.stdout, /Exit codes/);
});

test('exits 1 when errors are found and 0 on a clean project', () => {
  assert.equal(cli([MESSY, '--no-user']).code, 1);
  assert.equal(cli([CLEAN, '--no-user']).code, 0);
});

test('--max-warnings turns warnings into a failure', () => {
  assert.equal(cli([CLEAN, '--no-user', '--max-warnings', '0']).code, 0);
  const warnOnly = cli([MESSY, '--no-user', '--min-severity', 'warning', '--disable', 'security,correctness']);
  assert.equal(cli([MESSY, '--no-user', '--only', 'cost', '--max-warnings', '0']).code, 1);
});

test('--json emits a stable, parseable shape', () => {
  const result = cli([MESSY, '--no-user', '--json']);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.tool, 'agentdoctor');
  assert.equal(parsed.version, 1);
  assert.ok(Array.isArray(parsed.findings));
  assert.ok(parsed.findings.length > 0);
  for (const finding of parsed.findings) {
    for (const key of ['ruleId', 'severity', 'category', 'message', 'file', 'line']) {
      assert.ok(key in finding, `finding missing ${key}`);
    }
    assert.ok(['error', 'warning', 'info'].includes(finding.severity));
  }
  assert.equal(parsed.summary.error + parsed.summary.warning + parsed.summary.info, parsed.findings.length);
});

test('--sarif emits valid SARIF 2.1.0 with resolvable rule indices', () => {
  const parsed = JSON.parse(cli([MESSY, '--no-user', '--sarif']).stdout);
  assert.equal(parsed.version, '2.1.0');
  assert.equal(parsed.runs.length, 1);
  const run = parsed.runs[0];
  assert.equal(run.tool.driver.name, 'agentdoctor');
  assert.ok(run.results.length > 0);
  for (const result of run.results) {
    assert.ok(['error', 'warning', 'note'].includes(result.level));
    assert.equal(run.tool.driver.rules[result.ruleIndex].id, result.ruleId,
      'ruleIndex must point at the matching rule definition');
    const uri = result.locations[0].physicalLocation.artifactLocation.uri;
    assert.ok(!uri.startsWith('/'), `SARIF uri should be repo-relative, got ${uri}`);
    assert.ok(result.locations[0].physicalLocation.region.startLine >= 1);
  }
});

test('--quiet prints nothing but keeps the exit code', () => {
  const result = cli([MESSY, '--no-user', '--quiet']);
  assert.equal(result.stdout, '');
  assert.equal(result.code, 1);
});

test('--list-rules and --explain describe the catalogue', () => {
  const list = cli(['--list-rules']);
  assert.equal(list.code, 0);
  assert.match(list.stdout, /security\/unrestricted-bash/);
  assert.match(list.stdout, /\d+ rules/);

  const explain = cli(['--explain', 'security/unrestricted-bash']);
  assert.equal(explain.code, 0);
  assert.match(explain.stdout, /Why it matters/);
  assert.match(explain.stdout, /agentdoctor-disable security\/unrestricted-bash/);

  const missing = cli(['--explain', 'nope/nope']);
  assert.equal(missing.code, 2);
});

test('rejects unknown flags and missing values with exit code 2', () => {
  assert.equal(cli(['--nonsense']).code, 2);
  assert.equal(cli(['--min-severity']).code, 2);
  assert.equal(cli(['--min-severity', 'critical']).code, 2);
  assert.equal(cli(['/nonexistent-path-xyz']).code, 2);
});

test('baseline round-trip suppresses known findings', () => {
  const baseline = join(MESSY, 'baseline.json');
  try {
    const write = cli([MESSY, '--no-user', '--write-baseline', baseline]);
    assert.equal(write.code, 0);
    const recorded = JSON.parse(readFileSync(baseline, 'utf8'));
    assert.ok(recorded.fingerprints.length > 0);

    const after = cli([MESSY, '--no-user', '--baseline', baseline, '--json']);
    const parsed = JSON.parse(after.stdout);
    assert.equal(parsed.findings.length, 0, 'a full baseline should suppress everything');
    assert.equal(parsed.suppressed, recorded.fingerprints.length);
    assert.equal(after.code, 0, 'a fully baselined project should pass CI');
  } finally {
    if (existsSync(baseline)) unlinkSync(baseline);
  }
});

test('--baseline reports a missing file rather than silently ignoring it', () => {
  assert.equal(cli([MESSY, '--baseline', '/nonexistent/baseline.json']).code, 2);
});

test('policy rules run whenever a policy file is present', () => {
  // The messy fixture commits an agentdoctor.policy.json, so the policy
  // category fires with no further setup.
  const result = JSON.parse(cli([MESSY, '--no-user', '--only', 'policy', '--json']).stdout);
  assert.ok(result.findings.length > 0, 'expected policy findings from the committed policy file');
  assert.ok(result.findings.every((f) => f.ruleId.startsWith('policy/')));
});

test('--init-policy writes a starter policy and refuses to overwrite', () => {
  const root = makeProject({ 'README.md': 'x' });
  try {
    const first = cli(['--init-policy', root]);
    assert.equal(first.code, 0);
    const policy = JSON.parse(readFileSync(join(root, 'agentdoctor.policy.json'), 'utf8'));
    assert.ok(Array.isArray(policy.requiredDeny));
    assert.ok(policy.forbiddenAllow.includes('Bash(*)'));
    assert.equal(cli(['--init-policy', root]).code, 2, 'should not overwrite an existing policy');
  } finally {
    cleanup(root);
  }
});

test('the tool never opens a credentials file even when scanning user scope', () => {
  const root = makeProject({
    '.claude/settings.json': { model: 'sonnet' },
    '.claude/.credentials.json': '{"token":"tripwire-value-must-not-appear"}',
  });
  try {
    const result = cli([root, '--json'], { env: { HOME: root } });
    assert.ok(!result.stdout.includes('tripwire-value-must-not-appear'),
      'credential contents must never reach the output');
  } finally {
    cleanup(root);
  }
});
