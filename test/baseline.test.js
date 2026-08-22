import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../src/index.js';
import { fingerprint } from '../src/engine.js';
import { makeProject, cleanup } from './helpers.js';
import { fileURLToPath } from 'node:url';

const scan = (root, options = {}) => run(root, { includeUserScope: false, ...options });
const baselineOf = (root) => new Set(scan(root).findings.map(fingerprint));

const settings = (allow) => `${JSON.stringify({ permissions: { allow } }, null, 2)}\n`;

test('a baseline survives a rule being inserted above the accepted ones', () => {
  // The failure this guards against: array-index anchors like
  // "permissions.allow[0]" change meaning as soon as anything is inserted,
  // which made every accepted finding reappear at once.
  const accepted = ['Bash(terraform apply)', 'Bash(chmod 777 ./dist)', 'Read(~/.aws/credentials)'];
  const root = makeProject({ '.claude/settings.json': settings(accepted) });
  try {
    const baseline = baselineOf(root);
    assert.ok(baseline.size >= 3);

    for (const position of [0, 1, accepted.length]) {
      const mutated = [...accepted];
      mutated.splice(position, 0, 'Bash(rm -rf $HOME)');
      writeFileSync(join(root, '.claude', 'settings.json'), settings(mutated));

      const findings = scan(root, { baseline }).findings
        .filter((f) => f.ruleId === 'security/destructive-allow');
      assert.equal(findings.length, 1,
        `inserting at ${position} should surface exactly the new rule, got ${findings.map((f) => f.snippet).join(', ')}`);
      assert.match(findings[0].snippet, /rm -rf/);
    }
  } finally {
    cleanup(root);
  }
});

test('a baseline survives unrelated lines being added to the file', () => {
  const root = makeProject({
    '.claude/settings.json': `{\n  "env": { "A": "1" },\n  "permissions": { "allow": ["Bash(terraform apply)"] }\n}\n`,
  });
  try {
    const baseline = baselineOf(root);
    writeFileSync(join(root, '.claude', 'settings.json'),
      `{\n  "env": { "A": "1", "B": "2", "C": "3" },\n  "model": "sonnet",\n  "cleanupPeriodDays": 30,\n  "permissions": { "allow": ["Bash(terraform apply)"] }\n}\n`);
    const remaining = scan(root, { baseline }).findings.filter((f) => f.ruleId === 'security/destructive-allow');
    assert.equal(remaining.length, 0, 'shifting the line must not invalidate the baseline');
  } finally {
    cleanup(root);
  }
});

test('fingerprints never contain a line number', () => {
  const root = fileURLToPath(new URL('./fixtures/messy', import.meta.url));
  for (const finding of scan(root).findings) {
    const anchor = fingerprint(finding).split('::')[2];
    assert.notEqual(anchor, String(finding.line),
      `${finding.ruleId} is anchored to a line number, which makes its baseline entry fragile`);
  }
});

test('fingerprints are stable across repeated runs', () => {
  const root = fileURLToPath(new URL('./fixtures/messy', import.meta.url));
  const first = scan(root).findings.map(fingerprint);
  const second = scan(root).findings.map(fingerprint);
  assert.deepEqual(first, second);
});

test('distinct findings from one rule in one file get distinct fingerprints', () => {
  const root = makeProject({
    '.claude/settings.json': settings(['Bash(terraform apply)', 'Bash(chmod 777 ./x)', 'Bash(npm publish)']),
  });
  try {
    const prints = scan(root).findings
      .filter((f) => f.ruleId === 'security/destructive-allow')
      .map(fingerprint);
    assert.equal(prints.length, 3);
    assert.equal(new Set(prints).size, 3, 'each offending rule needs its own baseline entry');
  } finally {
    cleanup(root);
  }
});

test('removing a fixed finding shrinks the baseline', () => {
  const root = makeProject({ '.claude/settings.json': settings(['Bash(terraform apply)', 'Bash(npm publish)']) });
  try {
    const before = baselineOf(root).size;
    writeFileSync(join(root, '.claude', 'settings.json'), settings(['Bash(npm test:*)']));
    assert.ok(baselineOf(root).size < before, 'fixing a finding should reduce the recorded set');
  } finally {
    cleanup(root);
  }
});
