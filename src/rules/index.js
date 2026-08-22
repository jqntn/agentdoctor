import { securityRules } from './security.js';
import { correctnessRules } from './correctness.js';
import { costRules } from './cost.js';
import { hygieneRules } from './hygiene.js';
import { policyRules } from './policy.js';

/** Every rule agentdoctor ships. All of them are free. */
export const allRules = [
  ...correctnessRules,
  ...securityRules,
  ...costRules,
  ...hygieneRules,
  ...policyRules,
];

export const CATEGORIES = ['correctness', 'security', 'cost', 'hygiene', 'policy'];

export { securityRules, correctnessRules, costRules, hygieneRules, policyRules };
