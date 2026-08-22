import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { allRules, CATEGORIES } from '../src/rules/index.js';

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url).pathname, 'utf8');

test('the README rule counts match the catalogue', () => {
  // Marketing copy that drifts from the code is how a tool loses trust on the
  // first run, so the counts are asserted rather than maintained by hand.
  const readme = read('README.md');
  assert.match(readme, new RegExp(`\\*\\*${allRules.length} rules`),
    `README should claim ${allRules.length} rules`);
  for (const category of CATEGORIES) {
    if (category === 'policy') continue;
    const count = allRules.filter((r) => r.category === category).length;
    const heading = category[0].toUpperCase() + category.slice(1);
    assert.match(readme, new RegExp(`### ${heading} \\(${count} rules\\)`),
      `README heading for ${category} should say ${count} rules`);
  }
});

test('the README does not promise a paid tier', () => {
  const readme = read('README.md');
  assert.doesNotMatch(readme, /licence key|license key|Pro tier|AGENTDOCTOR_LICENSE/i,
    'the project is fully free; no paid-tier language should survive');
});

test('docs/rules.md covers every rule', () => {
  const docs = read('docs/rules.md');
  const missing = allRules.filter((rule) => !docs.includes(`\`${rule.id}\``)).map((r) => r.id);
  assert.deepEqual(missing, [], `docs/rules.md is stale, regenerate it. Missing: ${missing.join(', ')}`);
});

test('the package manifest stays consistent with the code', async () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.license, 'MIT');
  assert.deepEqual(pkg.dependencies, {}, 'agentdoctor advertises zero dependencies');
  assert.deepEqual(pkg.devDependencies, {}, 'the test suite must not need dependencies either');
  assert.equal(pkg.bin.agentdoctor, 'bin/agentdoctor.js');
  const { VERSION } = await import('../src/index.js');
  assert.equal(pkg.version, VERSION, 'package.json version and VERSION must agree');
  for (const required of ['bin', 'src', 'README.md', 'LICENSE']) {
    assert.ok(pkg.files.includes(required), `package.files should include ${required}`);
  }
});

test('no source file points at a URL outside links.js', async () => {
  // A published package that links to a domain nobody owns is worse than one
  // that links nowhere, so URLs live in exactly one file.
  const { readdirSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const root = new URL('../src', import.meta.url).pathname;
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) { walk(path); continue; }
      if (!path.endsWith('.js') || path.endsWith('links.js')) continue;
      const text = readFileSync(path, 'utf8');
      for (const match of text.matchAll(/https?:\/\/[^\s'"`)]+/g)) {
        // Schema and documentation references in output payloads are fine.
        if (match[0].includes('sarif-spec') || match[0].includes('docs.anthropic')) continue;
        offenders.push(`${path}: ${match[0]}`);
      }
    }
  };
  walk(root);
  assert.deepEqual(offenders, [], `hardcoded URLs found: ${offenders.join(', ')}`);
});

test('every tracked source file is plain text', async () => {
  // Regression: the site generator once used NUL as a placeholder sentinel,
  // which made grep, git diff and most editors treat the file as binary - so
  // a contributor searching the repo would silently miss it.
  const { execFileSync } = await import('node:child_process');
  const root = new URL('..', import.meta.url).pathname;
  const tracked = execFileSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8' })
    .split('\n').filter(Boolean)
    .filter((f) => /\.(js|mjs|json|md|css|yml|svg|txt|sh)$/.test(f));

  const offenders = [];
  for (const file of tracked) {
    const bytes = readFileSync(join(root, file));
    if (bytes.includes(0)) { offenders.push(`${file}: contains NUL`); continue; }
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      offenders.push(`${file}: not valid UTF-8`);
    }
  }
  assert.deepEqual(offenders, [], offenders.join('; '));
});

test('the whole git history follows Conventional Commits', async () => {
  // The convention is only worth having if it is enforced; CI checks PR
  // commits, and this checks the history that is already here.
  const { execFileSync } = await import('node:child_process');
  const root = new URL('..', import.meta.url).pathname;
  const { validate } = await import('../tools/check-commits.mjs');
  const raw = execFileSync('git', ['-C', root, 'log', '--format=%H%x00%B%x1e'], { encoding: 'utf8' });
  const offenders = [];
  for (const entry of raw.split('\x1e').map((e) => e.trim()).filter(Boolean)) {
    const [sha, message] = entry.split('\x00');
    const problems = validate(message);
    if (problems.length) offenders.push(`${sha.slice(0, 8)}: ${problems.join('; ')}`);
  }
  assert.deepEqual(offenders, [], offenders.join(' | '));
});
