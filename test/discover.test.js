import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { discover } from '../src/discover.js';
import { makeProject, cleanup } from './helpers.js';

test('finds settings, mcp, memory, agent and skill files', () => {
  const root = makeProject({
    '.claude/settings.json': { model: 'sonnet' },
    '.claude/settings.local.json': { model: 'opus' },
    '.mcp.json': { mcpServers: {} },
    'CLAUDE.md': '# hi',
    '.claude/agents/a.md': '---\nname: a\ndescription: d\n---\nbody',
    '.claude/skills/s/SKILL.md': '---\nname: s\ndescription: d\n---\nbody',
    '.claude/commands/c.md': 'do a thing',
  });
  try {
    const result = discover(root, { includeUserScope: false });
    const kinds = result.files.map((f) => f.kind).sort();
    assert.deepEqual(kinds, ['agent', 'command', 'mcp', 'memory', 'settings', 'settings', 'skill']);
    const scopes = new Map(result.files.map((f) => [f.display, f.scope]));
    assert.equal(scopes.get('.claude/settings.json'), 'project');
    assert.equal(scopes.get('.claude/settings.local.json'), 'local');
  } finally {
    cleanup(root);
  }
});

test('never reads credential files, only records that they were skipped', () => {
  const root = makeProject({ '.claude/settings.json': {} });
  try {
    const home = root;
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(join(home, '.claude', '.credentials.json'), '{"secret":"do-not-read"}');
    const result = discover(root, { includeUserScope: true, home });
    const opened = result.files.map((f) => f.path);
    assert.ok(!opened.some((p) => p.endsWith('.credentials.json')), 'credential file must not be parsed');
    assert.ok(result.skipped.some((p) => p.endsWith('.credentials.json')), 'credential file should be reported as skipped');
    // Belt and braces: no file contents anywhere should contain the secret.
    assert.ok(!result.files.some((f) => f.text.includes('do-not-read')));
  } finally {
    cleanup(root);
  }
});

test('records a parse error instead of throwing', () => {
  const root = makeProject({ '.claude/settings.json': '{ "broken": ' });
  try {
    const result = discover(root, { includeUserScope: false });
    const file = result.files.find((f) => f.kind === 'settings');
    assert.ok(file.parseError, 'expected a recorded parse error');
    assert.equal(file.data, undefined);
  } finally {
    cleanup(root);
  }
});

test('walks nested CLAUDE.md files but skips vendor directories', () => {
  const root = makeProject({
    'CLAUDE.md': 'root',
    'packages/api/CLAUDE.md': 'nested',
    'node_modules/pkg/CLAUDE.md': 'should be ignored',
    'dist/CLAUDE.md': 'should be ignored',
  });
  try {
    const result = discover(root, { includeUserScope: false });
    const memories = result.files.filter((f) => f.kind === 'memory').map((f) => f.display).sort();
    assert.deepEqual(memories, ['CLAUDE.md', 'packages/api/CLAUDE.md']);
  } finally {
    cleanup(root);
  }
});

test('detects a git repo and reads .gitignore', () => {
  const root = makeProject({ '.git/HEAD': 'ref: refs/heads/main', '.gitignore': 'node_modules\n' });
  try {
    const result = discover(root, { includeUserScope: false });
    assert.equal(result.isGitRepo, true);
    assert.match(result.gitignore, /node_modules/);
  } finally {
    cleanup(root);
  }
});

test('discovers namespaced agent subdirectories', () => {
  const root = makeProject({ '.claude/agents/team/reviewer.md': '---\nname: reviewer\ndescription: d\n---\nbody' });
  try {
    const result = discover(root, { includeUserScope: false });
    assert.equal(result.files.filter((f) => f.kind === 'agent').length, 1);
  } finally {
    cleanup(root);
  }
});
