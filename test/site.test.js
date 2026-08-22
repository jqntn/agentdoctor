import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { allRules } from '../src/rules/index.js';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SITE = join(ROOT, 'site');

// Build once for the whole file; the build is pure node and takes <1s.
execFileSync(process.execPath, [join(ROOT, 'tools', 'build-site.mjs')], { encoding: 'utf8' });

test('the site builds with a landing page, all doc pages, and agent surfaces', () => {
  assert.ok(existsSync(join(SITE, 'index.html')));
  assert.ok(existsSync(join(SITE, 'llms.txt')));
  assert.ok(existsSync(join(SITE, 'llms-full.txt')));
  assert.ok(existsSync(join(SITE, '.nojekyll')));
  assert.ok(existsSync(join(SITE, 'schemas', 'policy.schema.json')));
  assert.ok(existsSync(join(SITE, 'schemas', 'report.schema.json')));

  // Every repo doc ships as both HTML and raw markdown.
  const docs = readdirSync(join(ROOT, 'docs')).filter((f) => f.endsWith('.md'));
  for (const doc of docs) {
    const name = doc.replace(/\.md$/, '');
    assert.ok(existsSync(join(SITE, 'docs', `${name}.html`)), `missing HTML for ${doc}`);
    assert.ok(existsSync(join(SITE, 'docs', `${name}.md`)), `missing raw mirror for ${doc}`);
  }
});

test('the landing page states the real rule count', () => {
  const index = readFileSync(join(SITE, 'index.html'), 'utf8');
  assert.match(index, new RegExp(`${allRules.length} rules`));
  assert.match(index, /npx agentdoctor/);
  assert.doesNotMatch(index, /licence key|license key|paid tier/i);
});

test('the rules page renders one section per rule', () => {
  const rules = readFileSync(join(SITE, 'docs', 'rules.html'), 'utf8');
  const sections = rules.match(/<h3 id=/g) ?? [];
  assert.equal(sections.length, allRules.length);
});

test('rendered pages contain no unrendered markdown outside code blocks', () => {
  for (const file of readdirSync(join(SITE, 'docs')).filter((f) => f.endsWith('.html'))) {
    const html = readFileSync(join(SITE, 'docs', file), 'utf8')
      .replace(/<pre>[\s\S]*?<\/pre>/g, '')
      .replace(/<code>[\s\S]*?<\/code>/g, '')
      .replace(/content="[^"]*"/g, '');
    assert.doesNotMatch(html, /\*\*[a-zA-Z]/, `raw ** leaked into ${file}`);
    assert.doesNotMatch(html, /\]\(/, `raw markdown link leaked into ${file}`);
  }
});

test('llms.txt links every doc as raw markdown', () => {
  const llms = readFileSync(join(SITE, 'llms.txt'), 'utf8');
  const docs = readdirSync(join(ROOT, 'docs')).filter((f) => f.endsWith('.md'));
  for (const doc of docs) {
    assert.ok(llms.includes(`/docs/${doc}`), `llms.txt missing ${doc}`);
  }
  assert.match(llms, /llms-full\.txt/);
});
