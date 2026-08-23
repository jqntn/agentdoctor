#!/usr/bin/env node
/** Regenerates docs/rules.md from the rule catalogue. Run before publishing. */
import { writeFileSync } from 'node:fs';
import { allRules, CATEGORIES } from '../src/rules/index.js';

const TITLES = {
  correctness: ['Correctness', 'Config the harness is silently ignoring. These are the findings where you believe something is configured and it is not.'],
  security: ['Security', 'The config surface is an execution surface. These rules find the places where it is wider than intended.'],
  cost: ['Cost', 'Memory files and tool schemas are re-sent on every request, so their size is a recurring charge. These rules quantify it.'],
  hygiene: ['Hygiene', 'Legal, safe config that will still cause avoidable confusion or leak personal settings between machines.'],
  policy: ['Policy', 'Enforcement of a written standard across more than one repository. These rules activate when an agentdoctor.policy.json is committed and are silent otherwise.'],
};

const lines = [
  '# Rule reference',
  '',
  `Every rule, with the reasoning behind it - ${allRules.length} in total. \`agentdoctor --explain <rule-id>\``,
  'prints any of these from the CLI, and `--list-rules` prints the catalogue.',
  '',
];

for (const category of CATEGORIES) {
  const rules = allRules.filter((r) => r.category === category);
  if (rules.length === 0) continue;
  const [title, blurb] = TITLES[category] ?? [category, ''];
  lines.push(`## ${title}`, '', blurb, '');
  for (const rule of rules) {
    lines.push(`### \`${rule.id}\``, '');
    lines.push(`**${rule.title}** &nbsp;&middot;&nbsp; \`${rule.severity}\``, '');
    lines.push(rule.help, '');
  }
}

lines.push('---', '');
lines.push('Suppress any rule for one file with a comment in that file:', '');
lines.push('```', 'agentdoctor-disable <rule-id>', '```', '');

writeFileSync(new URL('../docs/rules.md', import.meta.url), `${lines.join('\n')}`);
console.log(`docs/rules.md written: ${allRules.length} rules`);
