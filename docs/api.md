# Programmatic API

agentdoctor is an ES module with no dependencies, so embedding it is one import.

```js
import { run } from 'agentdoctor';

const result = run('/path/to/repo', { includeUserScope: false });

for (const finding of result.findings) {
  console.log(finding.severity, finding.ruleId, `${finding.display}:${finding.line}`);
}
process.exitCode = result.findings.some((f) => f.severity === 'error') ? 1 : 0;
```

## `run(root, options?)`

The one-call entry point: discovers config, loads any team policy, runs every rule.

| Option | Type | Default | Effect |
|---|---|---|---|
| `includeUserScope` | boolean | `true` | Also scan `~/.claude` |
| `home` | string | `os.homedir()` | Override the home directory (useful in tests) |
| `policyPath` | string | auto-detect | Explicit policy file path |
| `only` | string[] | all | Restrict to categories or rule ids |
| `disabled` | string[] | none | Skip rules or categories |
| `minSeverity` | `'error'\|'warning'\|'info'` | `'info'` | Severity floor |
| `baseline` | `Set<string>` | empty | Fingerprints to suppress |

Returns `{ findings, ran, suppressed, workspace, elapsedMs, version }`.

### Finding shape

```ts
{
  ruleId: string;        // e.g. "security/unrestricted-bash"
  severity: 'error' | 'warning' | 'info';
  category: 'correctness' | 'security' | 'cost' | 'hygiene' | 'policy';
  message: string;       // what is wrong, specific to this occurrence
  help?: string;         // what to do instead, from the rule
  file: string;          // absolute path
  display: string;       // repo-relative (or ~/) path for humans
  line: number;          // 1-based
  column?: number;
  configPath?: string;   // e.g. "permissions.allow[0]"
  snippet?: string;      // offending value, secrets redacted
}
```

Findings are pre-sorted by severity, then file, then line.

## Lower-level building blocks

All exported from the package root:

- `discover(root, { includeUserScope, home })` — collects and parses every config file, with
  per-value source positions. Never opens credential files.
- `lint(workspace, { rules, disabled, minSeverity, baseline })` — runs rules over a discovered
  workspace. Pass your own `rules` array to run a custom subset or add your own rules.
- `fingerprint(finding)` — the stable identity used by baselines. Anchored to the offending
  value, then config path, then message hash — never line numbers.
- `allRules`, `CATEGORIES` — the catalogue.
- `loadPolicy(root, explicitPath?)` — reads `agentdoctor.policy.json`.
- `helpers` — utilities handed to rules: `parsePermission`, `estimateTokens`, position lookup.

## Writing a custom rule

A rule is a plain object; `lint` accepts any array of them.

```js
import { discover, lint, allRules, helpers } from 'agentdoctor';

const noOpusInProjects = {
  id: 'org/no-opus-model',
  category: 'policy',
  severity: 'warning',
  title: 'Project pins an Opus-tier model',
  help: 'Our org standard is sonnet for project config; sessions can override per run.',
  check({ files, report, helpers }) {
    for (const file of files) {
      if (file.kind !== 'settings' || file.data?.model !== 'opus') continue;
      const position = helpers.at(file, 'model');
      report({ file, line: position.line, column: position.column,
               configPath: 'model', message: 'model is pinned to opus.' });
    }
  },
};

const workspace = discover(process.cwd(), { includeUserScope: false });
const result = lint(workspace, { rules: [...allRules, noOpusInProjects] });
```

The `check` function receives `{ workspace, files, report, helpers }`. Throwing inside a rule
does not crash the run — it surfaces as an `internal/rule-crashed` warning finding.

## Stability

The exported API surface is small on purpose: `run`, `discover`, `lint`, `fingerprint`,
`allRules`, `CATEGORIES`, `loadPolicy`, `helpers`, `VERSION`. Anything not exported from the
package root is internal and may change without notice.
