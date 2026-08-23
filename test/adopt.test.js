import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { computeGrade } from '../src/grade.js';
import { makeProject, cleanup } from './helpers.js';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../bin/agentdoctor.js', import.meta.url));
const MESSY = fileURLToPath(new URL('./fixtures/messy', import.meta.url));
const CLEAN = fileURLToPath(new URL('./fixtures/clean', import.meta.url));

function cli(args) {
  try {
    return { code: 0, stdout: execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } }) };
  } catch (error) {
    return { code: error.status, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

const finding = (severity) => ({ severity });

test('the grade formula matches its documentation', () => {
  assert.equal(computeGrade([]), 'A+');
  assert.equal(computeGrade([finding('info')]), 'A');
  assert.equal(computeGrade([finding('warning')]), 'B');
  assert.equal(computeGrade([finding('warning'), finding('warning')]), 'B');
  assert.equal(computeGrade([finding('warning'), finding('warning'), finding('warning')]), 'C');
  assert.equal(computeGrade([finding('error')]), 'D');
  assert.equal(computeGrade([finding('error'), finding('error'), finding('error')]), 'F');
  // Errors dominate warnings regardless of counts.
  assert.equal(computeGrade([finding('error'), ...Array(10).fill(finding('warning'))]), 'D');
});

test('the terminal summary and JSON report state the grade', () => {
  const term = cli([CLEAN, '--no-user']);
  assert.match(term.stdout, /Grade A\+/);
  const json = JSON.parse(cli([MESSY, '--no-user', '--json']).stdout);
  assert.equal(json.grade, 'F');
  const cleanJson = JSON.parse(cli([CLEAN, '--no-user', '--json']).stdout);
  assert.equal(cleanJson.grade, 'A+');
});

test('--share prints a paste-ready card with no leakable content', () => {
  const result = cli([MESSY, '--no-user', '--share']);
  assert.equal(result.code, 0, '--share is for sharing, not gating - it must exit 0 even with findings');
  assert.match(result.stdout, /agentdoctor grade: F/);
  assert.match(result.stdout, /npx @jqntn\/agentdoctor/);
  // Only rule ids and counts: no file paths, messages, or snippets may leak.
  assert.doesNotMatch(result.stdout, /settings\.json|CLAUDE\.md|\.mcp\.json/);
  assert.doesNotMatch(result.stdout, /sk-ant|ghp_/);
  assert.match(result.stdout, /- `[a-z]+\/[a-z-]+`/);
});

test('--badge prints valid markdown with a grade-colored shield', () => {
  const clean = cli([CLEAN, '--no-user', '--badge']);
  assert.match(clean.stdout, /\[!\[agentdoctor: A\+\]\(https:\/\/img\.shields\.io\/badge\/agentdoctor-A%2B-34D399\)\]/);
  const messy = cli([MESSY, '--no-user', '--badge']);
  assert.match(messy.stdout, /agentdoctor-F-F87171/);
  assert.equal(messy.code, 0);
});

test('--init-ci writes a working workflow once and refuses to overwrite', () => {
  const root = makeProject({ 'README.md': 'x' });
  try {
    const first = cli(['--init-ci', root]);
    assert.equal(first.code, 0);
    const workflow = readFileSync(join(root, '.github/workflows/agentdoctor.yml'), 'utf8');
    assert.match(workflow, /npx @jqntn\/agentdoctor --no-user --sarif/);
    assert.match(workflow, /upload-sarif/);
    assert.match(workflow, /npx @jqntn\/agentdoctor --no-user --quiet/);
    assert.match(workflow, /write-baseline/, 'the baseline escape hatch must be documented in the file itself');
    assert.equal(cli(['--init-ci', root]).code, 2, 'must not overwrite an existing workflow');
  } finally {
    cleanup(root);
  }
});

test('--init-skill installs the full skill once and refuses to overwrite', () => {
  const root = makeProject({ 'README.md': 'x' });
  try {
    assert.equal(cli(['--init-skill', root]).code, 0);
    const skill = readFileSync(join(root, '.claude/skills/config-audit/SKILL.md'), 'utf8');
    assert.match(skill, /^---\nname: config-audit\n/);
    assert.match(skill, /Never delete or weaken/);
    assert.ok(existsSync(join(root, '.claude/skills/config-audit/references/fix-recipes.md')),
      'the fix recipes must ship with the skill');
    assert.equal(cli(['--init-skill', root]).code, 2);
  } finally {
    cleanup(root);
  }
});

test('the installed skill is byte-identical to the packaged one, so the two cannot drift', () => {
  const root = makeProject({ 'README.md': 'x' });
  try {
    cli(['--init-skill', root]);
    for (const file of ['SKILL.md', 'references/fix-recipes.md']) {
      const written = readFileSync(join(root, '.claude/skills/config-audit', file), 'utf8');
      const packaged = readFileSync(fileURLToPath(new URL(`../plugin/skills/config-audit/${file}`, import.meta.url)), 'utf8');
      assert.equal(written, packaged, `${file} drifted`);
    }
  } finally {
    cleanup(root);
  }
});

test('--init-agents creates, appends, and refuses to duplicate', () => {
  // Fresh project: creates the file.
  const fresh = makeProject({ 'README.md': 'x' });
  try {
    assert.equal(cli(['--init-agents', fresh]).code, 0);
    const created = readFileSync(join(fresh, 'AGENTS.md'), 'utf8');
    assert.match(created, /<!-- agentdoctor:start -->/);
    assert.match(created, /npx @jqntn\/agentdoctor \. --no-user --json/);
    assert.match(created, /Never delete or\s+weaken/);
    assert.equal(cli(['--init-agents', fresh]).code, 2, 'must not duplicate the section');
  } finally {
    cleanup(fresh);
  }

  // Existing AGENTS.md: appends without touching prior content.
  const existing = makeProject({ 'AGENTS.md': '# My project\n\nUse pnpm, not npm.\n' });
  try {
    assert.equal(cli(['--init-agents', existing]).code, 0);
    const appended = readFileSync(join(existing, 'AGENTS.md'), 'utf8');
    assert.match(appended, /Use pnpm, not npm\./);
    assert.ok(appended.indexOf('Use pnpm') < appended.indexOf('agentdoctor:start'),
      'existing content must stay first');
    assert.match(appended, /<!-- agentdoctor:end -->/);
  } finally {
    cleanup(existing);
  }
});

test('the AGENTS.md section stays small enough to live in always-on context', () => {
  // The section rides along in every session for AGENTS.md-reading tools, so
  // it must never grow into the memory bloat our own cost rules flag.
  const root = makeProject({ 'README.md': 'x' });
  try {
    cli(['--init-agents', root]);
    const content = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    assert.ok(content.length < 1500, `AGENTS.md section is ${content.length} chars; keep it lean`);
  } finally {
    cleanup(root);
  }
});

test('a project adopted via --init-ci and --init-skill still grades A+ itself', () => {
  // The files the tool writes must never trigger its own rules.
  const root = makeProject({ 'README.md': 'x' });
  try {
    cli(['--init-ci', root]);
    cli(['--init-skill', root]);
    cli(['--init-agents', root]);
    const json = JSON.parse(cli([root, '--no-user', '--json']).stdout);
    assert.deepEqual(json.findings, [], `self-inflicted findings: ${json.findings.map((f) => f.ruleId).join(', ')}`);
  } finally {
    cleanup(root);
  }
});
