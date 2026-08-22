# Architecture

Four stages, each a plain module with no dependencies: **discover → parse → lint → report**.

```
bin/agentdoctor.js        CLI: flags, exit codes, EPIPE handling
src/
  discover.js             finds config files; never opens credential files
  parse.js                position-tracking JSON + frontmatter parsers
  engine.js               runs rules, suppression, baselines, fingerprints
  rules/
    correctness.js  (26)  config the harness silently ignores
    security.js     (22)  config that widens the execution surface
    cost.js          (8)  always-on context, priced with stated assumptions
    hygiene.js       (8)  config that confuses the next person
    policy.js        (8)  team standards from agentdoctor.policy.json
  report/
    terminal.js  json.js  sarif.js
```

## Discovery

`discover()` walks the project for every file the agent harness reads: settings at three
scopes (project, local, user), `.mcp.json`, memory files at any depth, agents, skills,
commands, hooks, keybindings. Vendor directories (`node_modules`, `dist`, `.venv`, …) are
skipped, walk depth is capped, and files over 4 MB are recorded as skipped rather than read.

Two properties are deliberate and load-bearing:

- **Credential files are never opened.** `.credentials.json`, `.netrc`, private keys are
  excluded by *path* before any `readFile`, and a test asserts a tripwire value planted in a
  credentials file can never reach output. A security tool's own behavior is part of its
  threat model.
- **No network calls, ever.** Not for updates, not for telemetry. The entire run is local
  file reads.

## Position-tracking parsing

Findings are only actionable if they point at a line, so agentdoctor does not use
`JSON.parse`. `src/parse.js` is a hand-written JSON parser that records the `line:column` of
every value, keyed by config path (`permissions.allow[0]`). It is also deliberately tolerant:
trailing commas and comments — common in hand-edited config — parse fine, so one stray comma
yields real findings instead of a single parse error. A genuinely broken file becomes a
`correctness/invalid-json` **error**, because the harness ignores the entire file in that
case, including any permission rules in it.

Agent and skill definitions carry config in YAML frontmatter. The frontmatter parser supports
the documented subset (scalars, inline and dash lists, one nesting level) rather than taking a
YAML dependency.

## The rule engine

A rule is a plain object: `{ id, category, severity, title, help, check() }`. The engine calls
each rule with the workspace and a `report()` callback, then handles everything rules should
not re-implement:

- **Suppression** — inline `agentdoctor-disable` comments, `--disable`, `--only`,
  `--min-severity`, and baselines all apply centrally.
- **Fingerprints** — each finding gets a stable identity anchored to the offending value,
  then config path, then message hash. Never line numbers: a baseline must survive unrelated
  edits ([why](baselines.md)).
- **Crash isolation** — a throwing rule becomes an `internal/rule-crashed` warning; it cannot
  take the run down.
- **Ordering** — findings sort by severity, file, line, so output is deterministic.

## Design principles

1. **False positives are worse than false negatives.** A linter that cries wolf gets
   uninstalled, at which point it catches nothing. The test suite contains a fully
   well-configured fixture project that must produce **zero** findings; any rule that fires on
   it is wrong by definition.
2. **Every finding says why and what to do.** `message` states the specific problem; `help`
   states the fix and the reasoning. `--explain <rule-id>` prints the full rationale.
3. **Silent failure is the enemy.** The highest-value rules are the ones that catch config
   the harness ignores without any error: misspelled hook events, deny rules naming
   nonexistent tools, hooks pointing at missing scripts.
4. **Zero dependencies, permanently.** This tool warns about supply-chain risk in MCP
   servers; its own `npm install` footprint is part of the product. The JSON parser, YAML
   subset, ANSI styling, and SARIF writer are all in-tree.
5. **Estimates state their assumptions.** Cost rules price always-on context using a model
   that accounts for prompt caching, and say so in the message. The token count is the fact;
   the money is a model.

## Testing

`node --test`, no framework. The suite covers every rule (a meta-test fails if a rule id
appears in no test file), parser positions, discovery, baselines (insertion-stability
regression tests), CLI behavior including piping and exit codes, and docs consistency — the
README's rule counts are asserted against the actual catalogue so marketing copy cannot drift
from the code.
