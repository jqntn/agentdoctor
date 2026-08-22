import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/index.js';
import { matchesPattern, loadPolicy } from '../src/rules/policy.js';
import { makeProject, cleanup, findingsFor } from './helpers.js';

const scan = (root, options = {}) => run(root, { includeUserScope: false, ...options });

test('a single asterisk is literal, so "Bash(*)" does not match every Bash rule', () => {
  assert.equal(matchesPattern('Bash(*)', 'Bash(*)'), true);
  assert.equal(matchesPattern('Bash(*)', 'Bash(npm test:*)'), false,
    'a policy forbidding the wildcard rule must not forbid scoped rules');
  assert.equal(matchesPattern('Bash(*)', 'Bash(ls)'), false);
});

test('a double asterisk is the wildcard', () => {
  assert.equal(matchesPattern('Bash(**)', 'Bash(npm test:*)'), true);
  assert.equal(matchesPattern('Bash(**sudo**)', 'Bash(sudo apt install x)'), true);
  assert.equal(matchesPattern('Bash(**sudo**)', 'Bash(npm test)'), false);
  assert.equal(matchesPattern('Bash(**)', 'Read(x)'), false);
});

test('pattern matching does not throw on non-strings', () => {
  for (const value of [null, undefined, 42, {}, []]) {
    assert.equal(matchesPattern('Bash(*)', value), false);
    assert.equal(matchesPattern(value, 'Bash(*)'), false);
  }
});

test('regex metacharacters in a pattern are treated literally', () => {
  assert.equal(matchesPattern('Bash(a.c)', 'Bash(abc)'), false);
  assert.equal(matchesPattern('Bash(a.c)', 'Bash(a.c)'), true);
  assert.equal(matchesPattern('Bash(a+b)', 'Bash(aab)'), false);
});

test('loadPolicy finds a policy at the repo root', () => {
  const root = makeProject({ 'agentdoctor.policy.json': { requiredDeny: ['Read(./.env*)'] } });
  try {
    const { policy, path } = loadPolicy(root);
    assert.deepEqual(policy.requiredDeny, ['Read(./.env*)']);
    assert.match(path, /agentdoctor\.policy\.json$/);
  } finally {
    cleanup(root);
  }
});

test('a broken policy file is reported rather than silently ignored', () => {
  const root = makeProject({
    'agentdoctor.policy.json': '{ "requiredDeny": ',
    '.claude/settings.json': { model: 'sonnet' },
  });
  try {
    const hits = findingsFor(scan(root), 'policy/file-invalid');
    assert.equal(hits.length, 1);
    assert.match(hits[0].message, /No policy rules were enforced/);
  } finally {
    cleanup(root);
  }
});

test('requiredDeny passes when the rule is present', () => {
  const root = makeProject({
    'agentdoctor.policy.json': { requiredDeny: ['Read(./.env*)'] },
    '.claude/settings.json': { permissions: { deny: ['Read(./.env*)'] } },
  });
  try {
    assert.equal(findingsFor(scan(root), 'policy/missing-required-deny').length, 0);
  } finally {
    cleanup(root);
  }
});

test('allowedMcpServers accepts approved servers and rejects the rest', () => {
  const root = makeProject({
    'agentdoctor.policy.json': { allowedMcpServers: ['approved', 'team-**'] },
    '.mcp.json': { mcpServers: { approved: { command: 'node' }, 'team-linear': { command: 'node' }, rogue: { command: 'node' } } },
  });
  try {
    const hits = findingsFor(scan(root), 'policy/unapproved-mcp-server');
    assert.equal(hits.length, 1);
    assert.match(hits[0].message, /"rogue"/);
  } finally {
    cleanup(root);
  }
});

test('maxMemoryTokens is enforced against project memory only', () => {
  const big = 'Guidance line that repeats to inflate the memory file for this test. '.repeat(200);
  const root = makeProject({
    'agentdoctor.policy.json': { maxMemoryTokens: 500 },
    'CLAUDE.md': big,
  });
  try {
    const hits = findingsFor(scan(root), 'policy/memory-budget-exceeded');
    assert.equal(hits.length, 1);
    assert.match(hits[0].message, /over the policy budget/);
  } finally {
    cleanup(root);
  }
});

test('requiredHooks flags a missing guardrail', () => {
  const root = makeProject({
    'agentdoctor.policy.json': { requiredHooks: ['PreToolUse'] },
    '.claude/settings.json': { model: 'sonnet' },
  });
  try {
    assert.equal(findingsFor(scan(root), 'policy/required-hook-missing').length, 1);
  } finally {
    cleanup(root);
  }
});

test('permission drift only flags unrestricted local additions', () => {
  const root = makeProject({
    '.claude/settings.json': { permissions: { allow: ['Bash(npm test:*)'] } },
    '.claude/settings.local.json': { permissions: { allow: ['Bash(npm test:*)', 'Bash(make build)', 'Write(**)'] } },
  });
  try {
    const hits = findingsFor(scan(root), 'policy/permission-drift');
    assert.equal(hits.length, 1, 'a narrow local addition is fine; an unrestricted one is not');
    assert.match(hits[0].message, /Write\(\*\*\)/);
  } finally {
    cleanup(root);
  }
});

test('policy rules do nothing when no policy file exists', () => {
  // The policy category activates on the presence of agentdoctor.policy.json,
  // so solo users who never write one never see these rules fire.
  const root = makeProject({ '.claude/settings.json': { permissions: { allow: ['Bash(*)'] } } });
  try {
    const result = scan(root);
    assert.equal(result.findings.filter((f) => f.category === 'policy').length, 0);
    assert.ok(findingsFor(result, 'security/unrestricted-bash').length > 0, 'other rules still run');
  } finally {
    cleanup(root);
  }
});
