import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/index.js';
import { allRules } from '../src/rules/index.js';
import { makeProject, cleanup, findingsFor } from './helpers.js';

const scan = (root, options = {}) => run(root, { includeUserScope: false, ...options });

function expectRule(files, ruleId, options = {}) {
  const root = makeProject(files);
  try {
    const hits = findingsFor(scan(root, options), ruleId);
    assert.ok(hits.length > 0, `expected ${ruleId} to fire`);
    return hits;
  } finally {
    cleanup(root);
  }
}

test('flags globally disabled hooks', () => {
  expectRule({ '.claude/settings.json': { disableAllHooks: true } }, 'security/hooks-globally-disabled');
});

test('flags a hook that runs a destructive command', () => {
  expectRule({
    '.claude/settings.json': { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'git reset --hard origin/main' }] }] } },
  }, 'security/hook-dangerous-command');
});

test('flags a hook resolved through PATH rather than an absolute path', () => {
  expectRule({
    '.claude/settings.json': { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'format.sh --write' }] }] } },
  }, 'security/hook-unpinned-path');
});

test('flags an apiKeyHelper that embeds the key instead of looking it up', () => {
  expectRule({
    '.claude/settings.json': { apiKeyHelper: 'echo sk-ant-api03-QcJ8nT2vLkRm4XpZwYbHdFgS9uEaN7iOtPqW1xCvBnMlKjHgFdSaQ' },
  }, 'security/apikeyhelper-inline-secret');
});

test('suggests locking bypass mode for a project that already writes deny rules', () => {
  expectRule({
    '.claude/settings.json': { permissions: { deny: ['Read(./.env*)'] } },
  }, 'security/bypass-mode-not-locked');
});

test('flags an unrecognised permissions sub-key with a suggestion', () => {
  const hits = expectRule({ '.claude/settings.json': { permissions: { alow: ['Bash(ls)'] } } }, 'correctness/unknown-permission-key');
  assert.match(hits[0].message, /Did you mean "allow"/);
});

test('flags a permission bucket that is not an array', () => {
  expectRule({ '.claude/settings.json': { permissions: { allow: 'Bash(ls)' } } }, 'correctness/permissions-wrong-type');
});

test('flags a non-string permission entry', () => {
  expectRule({ '.claude/settings.json': { permissions: { allow: [42] } } }, 'correctness/permission-non-string');
});

test('flags a matcher on an event that has no tool', () => {
  expectRule({
    '.claude/settings.json': { hooks: { SessionStart: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo x' }] }] } },
  }, 'correctness/hook-matcher-ignored');
});

test('flags an MCP server listed as both enabled and disabled', () => {
  expectRule({
    '.claude/settings.json': { enabledMcpjsonServers: ['a'], disabledMcpjsonServers: ['a'] },
  }, 'correctness/mcp-server-toggled-both-ways');
});

test('flags a skill with no frontmatter at all', () => {
  expectRule({ '.claude/skills/s/SKILL.md': 'body only, no frontmatter block present here' }, 'correctness/skill-missing-field');
});

test('flags two skills sharing a name', () => {
  const fm = (name) => `---\nname: ${name}\ndescription: Use this skill when the user asks for something specific and repeatable.\n---\nA body long enough to count as genuine instructions for the model to follow.`;
  expectRule({ '.claude/skills/a/SKILL.md': fm('dup'), '.claude/skills/b/SKILL.md': fm('dup') }, 'correctness/duplicate-skill-name');
});

test('flags the combined always-on context budget', () => {
  // Three files that are individually unremarkable but collectively expensive.
  const chunk = 'Project guidance line that repeats to inflate the memory files here. '.repeat(250);
  const hits = expectRule({
    'CLAUDE.md': chunk,
    'packages/a/CLAUDE.md': chunk,
    'packages/b/CLAUDE.md': chunk,
  }, 'cost/total-memory-budget');
  assert.match(hits[0].message, /3 memory files/);
});

test('flags a large number of configured MCP servers', () => {
  const servers = {};
  for (let i = 0; i < 10; i += 1) servers[`s${i}`] = { command: 'node', args: [`s${i}.js@1.0.0`] };
  expectRule({ '.mcp.json': { mcpServers: servers } }, 'cost/many-mcp-servers');
});

test('suggests a transcript retention period for user settings', () => {
  // The rule is scoped to user settings, so home must be distinct from the project.
  const project = makeProject({ 'README.md': 'x' });
  const home = makeProject({ '.claude/settings.json': { model: 'sonnet' } });
  try {
    const hits = findingsFor(run(project, { includeUserScope: true, home }), 'cost/no-cleanup-period');
    assert.ok(hits.length > 0, 'expected cost/no-cleanup-period to fire');
  } finally {
    cleanup(project);
    cleanup(home);
  }
});

test('flags duplicate keybindings', () => {
  expectRule({
    '.claude/keybindings.json': { bindings: [{ key: 'ctrl+s', action: 'a' }, { key: 'Ctrl+S', action: 'b' }] },
  }, 'hygiene/keybindings-duplicate');
});

test('notes a repo with no project memory file', () => {
  expectRule({ '.git/HEAD': 'ref: refs/heads/main', 'README.md': 'x' }, 'hygiene/no-project-memory');
});

// --- rules previously covered only incidentally by the fixtures ------------

test('flags a malformed statusLine', () => {
  expectRule({ '.claude/settings.json': { statusLine: { type: 'shell' } } }, 'correctness/statusline-malformed');
  expectRule({ '.claude/settings.json': { statusLine: 'oops' } }, 'correctness/statusline-malformed');
});

test('flags an invalid permission mode', () => {
  expectRule({ '.claude/settings.json': { permissions: { defaultMode: 'bypassPermisions' } } }, 'security/invalid-permission-mode');
  expectRule({ '.claude/settings.json': { permissions: { defaultMode: 42 } } }, 'security/invalid-permission-mode');
});

test('flags unrestricted WebFetch as an egress channel', () => {
  expectRule({ '.claude/settings.json': { permissions: { allow: ['WebFetch(*)'] } } }, 'security/unrestricted-egress');
  const root = makeProject({ '.claude/settings.json': { permissions: { allow: ['WebFetch(domain:docs.example.com)'] } } });
  try {
    assert.equal(findingsFor(scan(root), 'security/unrestricted-egress').length, 0);
  } finally {
    cleanup(root);
  }
});

test('notes when nothing denies access to secrets', () => {
  expectRule({ '.claude/settings.json': { permissions: { allow: ['Bash(ls)'] } } }, 'security/missing-secret-denies');
  const root = makeProject({ '.claude/settings.json': { permissions: { deny: ['Read(./.env*)'] } } });
  try {
    assert.equal(findingsFor(scan(root), 'security/missing-secret-denies').length, 0);
  } finally {
    cleanup(root);
  }
});

test('flags auto-enabling every project MCP server', () => {
  expectRule({ '.claude/settings.json': { enableAllProjectMcpServers: true } }, 'security/mcp-auto-enable-all');
});

test('flags broad allow rules paired with an empty deny list', () => {
  expectRule({ '.claude/settings.json': { permissions: { allow: ['Write(**)', 'WebFetch(*)'] } } }, 'security/deny-bucket-empty-with-broad-allow');
});

test('flags a thin subagent description', () => {
  expectRule({
    '.claude/agents/a.md': '---\nname: a\ndescription: Reviews code.\n---\nA body long enough to count as genuine instructions for this agent to follow.',
  }, 'cost/vague-agent-description');
});

test('flags a skill or agent with an empty body', () => {
  expectRule({
    '.claude/skills/s/SKILL.md': '---\nname: s\ndescription: Use this skill when the user asks for a specific repeatable task.\n---\n',
  }, 'hygiene/skill-body-empty');
  expectRule({
    '.claude/agents/a.md': '---\nname: a\ndescription: Use this agent when auditing a release candidate before shipping.\n---\n',
  }, 'hygiene/agent-body-empty');
});

test('notes when local settings shadow a project setting', () => {
  expectRule({
    '.claude/settings.json': { model: 'sonnet' },
    '.claude/settings.local.json': { model: 'opus' },
  }, 'hygiene/settings-scope-conflict');
});

test('policy forbids a listed allow rule and a listed permission mode', () => {
  const root = makeProject({
    'agentdoctor.policy.json': { forbiddenAllow: ['Bash(**)'], forbiddenPermissionModes: ['bypassPermissions'] },
    '.claude/settings.json': { permissions: { allow: ['Bash(rm -rf /)'], defaultMode: 'bypassPermissions' } },
  });
  try {
    const result = scan(root);
    assert.ok(findingsFor(result, 'policy/forbidden-allow').length > 0);
    assert.ok(findingsFor(result, 'policy/forbidden-permission-mode').length > 0);
  } finally {
    cleanup(root);
  }
});

test('every shipped rule is exercised by the test suite', async () => {
  // Guards against a rule being added with no test: each rule id must appear in
  // at least one test file, which is what keeps the catalogue honest.
  const { readdirSync, readFileSync } = await import('node:fs');
  const dir = new URL('.', import.meta.url).pathname;
  const corpus = readdirSync(dir)
    .filter((name) => name.endsWith('.test.js'))
    .map((name) => readFileSync(new URL(name, import.meta.url).pathname, 'utf8'))
    .join('\n');
  const untested = allRules.filter((rule) => !corpus.includes(rule.id)).map((rule) => rule.id);
  assert.deepEqual(untested, [], `rules with no test: ${untested.join(', ')}`);
});

