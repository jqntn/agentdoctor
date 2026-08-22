# AGENTS.md — working on this repository

agentdoctor is a zero-dependency Node CLI that lints AI coding-agent configuration. This file
is the contract for agents (and humans) contributing to it.

## Commands

```sh
npm test                     # full suite, node --test, no framework — must be green
node bin/agentdoctor.js .    # self-audit — must exit 0 with zero findings
node tools/gen-docs.mjs      # regenerate docs/rules.md from the rule catalogue
node tools/build-site.mjs    # regenerate the site/ directory from docs/ + assets/
```

No build step, no transpiler, no lockfile churn: the source is what runs. ES modules, Node 20+.

## Map

```
bin/agentdoctor.js       CLI only: flag parsing, exit codes, EPIPE handling
src/discover.js          config discovery; the ONLY place that opens files
src/parse.js             position-tracking JSON + frontmatter parsers
src/engine.js            rule runner, suppression, baselines, fingerprints
src/constants.js         known keys/events/tools + dangerous-pattern catalogues
src/rules/{correctness,security,cost,hygiene,policy}.js
src/report/{terminal,json,sarif}.js
src/links.js             every outbound URL — nothing else may contain one
test/fixtures/clean/     a correct project: MUST produce zero findings
test/fixtures/messy/     a broken project: broad rule coverage
docs/*.md                source of truth for the site; rules.md is GENERATED
skills/config-audit/     the canonical standalone skill; --init-skill copies it verbatim
.claude-plugin/          plugin + marketplace manifests (repo installs as a Claude Code plugin)
commands/audit.md        the /agentdoctor:audit slash command
```

## Invariants (all test-enforced — breaking one fails `npm test`)

1. **Zero dependencies.** `dependencies` and `devDependencies` stay `{}`. Do not add any, in
   any PR, for any reason.
2. **Zero findings on `test/fixtures/clean`.** If your rule fires there, fix the rule.
3. **Every rule has a test.** A rule id that appears in no `test/*.test.js` fails the suite.
4. **Rule id prefix equals its category.** `security/foo` lives in `security.js`.
5. **Credential files are never opened.** Anything widening what `discover.js` reads needs a
   test proving contents cannot leak into output.
6. **No URLs outside `src/links.js`.**
7. **Fingerprints never use line numbers.** Baselines must survive unrelated edits — anchor
   findings via `snippet` (best), `configPath`, or message hash.
8. **README rule counts match the catalogue.** Update the README numbers when adding rules;
   `test/docs.test.js` checks them.

## Adding a rule

1. Add the rule object to the right `src/rules/*.js` (shape documented in CONTRIBUTING.md).
   Write `message` = what is wrong here specifically; `help` = what to do instead and why.
2. Add a firing test AND a non-firing test (legitimate config it must stay quiet on).
3. `node tools/gen-docs.mjs` to regenerate `docs/rules.md`.
4. Bump the count in README.md (`**N rules**` and the category heading).
5. `npm test` and `node bin/agentdoctor.js .` both green.

## Style

- Match the existing code: plain ES modules, JSDoc types, no classes where an object works.
- Comments explain *why*, and are written for the next maintainer, not the diff reviewer.
- Findings must never echo an unredacted secret — see `redact()` in `src/rules/security.js`.
- Prefer editing `src/constants.js` catalogues over adding rule logic.

## Releasing

`npm test` → `node bin/agentdoctor.js .` → update CHANGELOG.md → bump `version` in
package.json, `VERSION` in `src/index.js`, AND `.claude-plugin/plugin.json` (tests assert all
three match) → `npm publish`.
