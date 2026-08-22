import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

/**
 * Builds a throwaway project from a { relativePath: contents } map and returns
 * its root. Contents may be a string or an object (serialised as JSON).
 */
export function makeProject(files) {
  const root = mkdtempSync(join(tmpdir(), 'agentdoctor-test-'));
  for (const [relative, contents] of Object.entries(files)) {
    const target = join(root, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, typeof contents === 'string' ? contents : `${JSON.stringify(contents, null, 2)}\n`);
  }
  return root;
}

export function cleanup(root) {
  rmSync(root, { recursive: true, force: true });
}

/** Settings-only project, the most common shape in these tests. */
export function withSettings(settings, extra = {}) {
  return makeProject({ '.claude/settings.json': settings, ...extra });
}

/**
 * POSIX file modes and /bin/sh do not exist on Windows, so the handful of
 * tests that depend on them are skipped there rather than asserted loosely.
 */
export const isWindows = process.platform === 'win32';
export const posixOnly = isWindows ? { skip: 'POSIX-only behaviour' } : {};

/** Rule ids present in a run result. */
export const firedRules = (result) => new Set(result.findings.map((f) => f.ruleId));

/** All findings for one rule. */
export const findingsFor = (result, ruleId) => result.findings.filter((f) => f.ruleId === ruleId);
