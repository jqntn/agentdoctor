import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseFrontmatter } from '../src/parse.js';
import { fileURLToPath } from 'node:url';

const read = (path) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');

test('the plugin manifest is valid and version-locked to the package', () => {
  const plugin = JSON.parse(read('plugin/.claude-plugin/plugin.json'));
  const pkg = JSON.parse(read('package.json'));
  assert.equal(plugin.name, 'agentdoctor');
  assert.equal(plugin.version, pkg.version, 'plugin.json version must track package.json');
  assert.equal(plugin.license, 'MIT');
  assert.ok(plugin.description.length > 40);
});

test('the marketplace manifest lists this repo as an installable plugin', () => {
  const marketplace = JSON.parse(read('.claude-plugin/marketplace.json'));
  assert.equal(marketplace.name, 'jqntn', 'marketplace is named for its owner, so installs read agentdoctor@jqntn');
  assert.equal(marketplace.plugins.length, 1);
  assert.equal(marketplace.plugins[0].name, 'agentdoctor');
  assert.equal(marketplace.plugins[0].source, './plugin');
});

test('the standalone skill passes the standards agentdoctor holds others to', () => {
  // The skill must satisfy the same rules the tool enforces on user skills:
  // name matches its directory, and the description is long, trigger-shaped
  // config the router can actually match on.
  const { frontmatter, body } = parseFrontmatter(read('plugin/skills/config-audit/SKILL.md'));
  assert.equal(frontmatter.name, 'config-audit');
  const description = frontmatter.description;
  assert.ok(description.split(/\s+/).length >= 12, 'description too short to trigger');
  assert.match(description, /\b(use whenever|whenever|use when)\b/i, 'description needs trigger phrasing');
  assert.ok(body.trim().length > 500, 'the skill body should be a real workflow, not a stub');
  // The two behaviors that must never regress out of the instructions:
  assert.match(body, /Never delete or weaken/);
  assert.match(body, /--quiet/);
  // Progressive disclosure: heavy detail lives in the referenced recipes file.
  assert.match(body, /references\/fix-recipes\.md/);
  const recipes = read('plugin/skills/config-audit/references/fix-recipes.md');
  assert.match(recipes, /write-baseline/);
  assert.match(recipes, /rotate the credential/i);
});

test('the plugin exposes exactly one entry point, to avoid duplicate skills', async () => {
  // Two near-identical entry points (a model-invoked skill plus a
  // command-only twin) only confuses users about which to reach for.
  const { readdirSync } = await import('node:fs');
  const dir = fileURLToPath(new URL('../plugin/skills', import.meta.url));
  assert.deepEqual(readdirSync(dir), ['config-audit']);
});
