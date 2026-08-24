import { discover } from './discover.js';
import { lint, fingerprint, helpers } from './engine.js';
import { allRules, CATEGORIES } from './rules/index.js';
import { loadPolicy } from './rules/policy.js';

export const VERSION = '0.1.5';

/**
 * One-call entry point: discover config, load any team policy, run every rule.
 *
 * @param {string} root
 * @param {{ includeUserScope?: boolean, policyPath?: string,
 *           disabled?: string[], minSeverity?: string, baseline?: Set<string>,
 *           only?: string[], home?: string }} [options]
 */
export function run(root, options = {}) {
  const started = process.hrtime.bigint();
  const workspace = discover(root, {
    includeUserScope: options.includeUserScope,
    home: options.home,
  });

  workspace.policy = loadPolicy(root, options.policyPath);

  let rules = allRules;
  if (options.only && options.only.length > 0) {
    const wanted = new Set(options.only);
    rules = rules.filter((rule) => wanted.has(rule.category) || wanted.has(rule.id));
  }

  const result = lint(workspace, {
    rules,
    disabled: options.disabled,
    minSeverity: options.minSeverity,
    baseline: options.baseline,
  });

  const elapsedMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
  return { ...result, workspace, elapsedMs, version: VERSION };
}

export { discover, lint, fingerprint, helpers, allRules, CATEGORIES, loadPolicy };
