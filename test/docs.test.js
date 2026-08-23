import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { allRules, CATEGORIES } from '../src/rules/index.js';
import { fileURLToPath } from 'node:url';

const read = (name) => readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8');

test('the README leads on rule quality, not a rule count', () => {
  // A hardcoded total drifts every time a rule lands, and it sells the wrong
  // thing: the differentiator is that a correct project reports nothing, not
  // that the catalogue is large.
  const readme = read('README.md');
  // The count may appear as supporting detail, but must not lead a section or
  // the document - the differentiator is the quality bar, not the total.
  const headings = [...readme.matchAll(/^#{1,3} (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(headings.filter((h) => /\d+ rules/.test(h)), [],
    'no heading should advertise a rule count');
  const whatItChecks = readme.split('## What it checks')[1]?.split('###')[0] ?? '';
  assert.ok(whatItChecks.indexOf('reports nothing') < whatItChecks.indexOf('72'),
    'the quality claim should come before the count');
  assert.match(readme, /reports nothing/, 'the clean-project claim should be stated');
  assert.match(readme, /False positives are treated as more severe/,
    'the false-positive stance is the core quality claim');
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
  const root = fileURLToPath(new URL('../src', import.meta.url));
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
  const root = fileURLToPath(new URL('..', import.meta.url));
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
  const root = fileURLToPath(new URL('..', import.meta.url));
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

test('every tracked path is checkout-safe on Windows', async () => {
  // Regression: a stray file named "socket:[590904]" was committed, and every
  // windows-latest job then failed at actions/checkout with "invalid path"
  // before a single test ran. Windows forbids : * ? " < > | in filenames, plus
  // trailing dots and spaces, and reserves a handful of device names.
  const { execFileSync } = await import('node:child_process');
  const root = fileURLToPath(new URL('..', import.meta.url));
  const tracked = execFileSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8' })
    .split('\n').filter(Boolean);

  const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i;
  const offenders = [];
  for (const path of tracked) {
    for (const segment of path.split('/')) {
      if (/[:*?"<>|]/.test(segment)) offenders.push(`${path}: illegal character`);
      else if (/[. ]$/.test(segment)) offenders.push(`${path}: trailing dot or space`);
      else if (RESERVED.test(segment)) offenders.push(`${path}: reserved device name`);
    }
  }
  assert.deepEqual(offenders, [], offenders.join('; '));
});

test('no test derives a filesystem path from URL.pathname', async () => {
  // Reading the pathname of a file: URL has broken windows-latest three times:
  // there it yields "/D:/a/repo", which is not a valid path for fs or git -C.
  // Always convert with fileURLToPath. Guarded here so it fails in a second
  // locally rather than after three Windows jobs die.
  const { readdirSync } = await import('node:fs');
  const dir = fileURLToPath(new URL('.', import.meta.url));
  const offenders = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const text = readFileSync(join(dir, file), 'utf8');
    // Assembled from fragments so this guard does not match its own source.
    const banned = new RegExp('new URL\\([^)]*\\)\\.' + 'path' + 'name');
    if (banned.test(text)) offenders.push(file);
  }
  assert.deepEqual(offenders, [], `use fileURLToPath instead: ${offenders.join(', ')}`);
});

test('README HTML attributes contain no unescaped angle brackets', async () => {
  // GitHub's markdown parser ends a raw HTML tag at the first '>' even inside a
  // quoted attribute value, then autolinks the leftovers. alt="node >=20" was
  // rendered as a broken <img> followed by the literal badge URL. npm's renderer
  // is more lenient, so the README looked fine there and wrong on GitHub.
  const readme = read('README.md');
  const offenders = [];
  for (const match of readme.matchAll(/<[a-zA-Z]+[^>]*?="([^"]*)"/g)) {
    if (/[<>]/.test(match[1])) offenders.push(match[0].slice(0, 60));
  }
  assert.deepEqual(offenders, [], `escape as &lt; / &gt;: ${offenders.join(' | ')}`);
});
