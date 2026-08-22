# Configuration

agentdoctor needs no config file to run. Everything is a CLI flag, an inline comment, or (for
team standards) an `agentdoctor.policy.json`.

## CLI reference

### Output

| Flag | Effect |
|---|---|
| *(default)* | Human-readable report, colored when stdout is a TTY |
| `--json` | Machine-readable findings on stdout ([format](output.md)) |
| `--sarif` | SARIF 2.1.0 for GitHub code scanning and other CI |
| `--quiet`, `-q` | Print nothing; rely on the exit code |
| `--no-color` / `--color` | Force color off/on (also honours `NO_COLOR` and `FORCE_COLOR`) |

### Scope

| Flag | Effect |
|---|---|
| `[path]` | Project root to audit (default: current directory) |
| `--no-user` | Skip `~/.claude`. Recommended in CI, where user scope does not exist |
| `--only <cat,...>` | Run only these categories or rule ids |
| `--disable <id,...>` | Skip specific rules or whole categories |
| `--min-severity <level>` | `error`, `warning`, or `info` (default) |

Categories: `correctness`, `security`, `cost`, `hygiene`, `policy`.

```sh
agentdoctor --only security,correctness
agentdoctor --disable cost/no-cleanup-period,hygiene
agentdoctor --min-severity warning
```

### CI

| Flag | Effect |
|---|---|
| `--max-warnings <n>` | Exit 1 if more than n warnings (errors always exit 1) |
| `--baseline <file>` | Suppress findings recorded in the baseline ([guide](baselines.md)) |
| `--write-baseline <file>` | Record current findings as accepted |

### Team policy

| Flag | Effect |
|---|---|
| `--policy <file>` | Policy file path (default: `agentdoctor.policy.json` at the root) |
| `--init-policy` | Write a starter policy file ([guide](policy.md)) |

### Adopt & share

| Flag | Effect |
|---|---|
| `--init-ci` | Write `.github/workflows/agentdoctor.yml`: SARIF annotations + exit-code gate. Refuses to overwrite. |
| `--init-skill` | Write `.claude/skills/config-audit/SKILL.md`, a Claude Code skill that audits and fixes config. Refuses to overwrite. |
| `--badge` | Print README markdown for a badge showing the current grade |
| `--share` | Print a paste-ready score card: grade, counts, top rule ids. Never includes messages, paths, or snippets, so it is safe to share from private repos. Always exits 0. |

### Introspection

| Flag | Effect |
|---|---|
| `--list-rules` | The full catalogue (add `--json` for machine-readable) |
| `--explain <rule-id>` | What a rule checks, why it matters, how to suppress it |
| `--version`, `--help` | The usual |

## Suppressing a rule for one file

Put a comment anywhere in the offending file:

```
// agentdoctor-disable security/hook-unpinned-path
```

In JSON config, a comment works (agentdoctor's parser tolerates comments) — or use a string
key that contains the directive:

```json
{
  "// agentdoctor-disable security/hook-unpinned-path": "hooks come from vendored bin/",
  "hooks": { }
}
```

Accepted forms:

- `agentdoctor-disable <rule-id>` — one rule
- `agentdoctor-disable <category>` — a whole category
- `agentdoctor-disable all` — everything, for this file
- Multiple ids separated by commas or spaces

Suppressions are file-scoped by design: a suppression you can see next to the code it affects
is one a reviewer can question.

To mark a credential-looking string as a deliberate placeholder:

```
agentdoctor-allow-secret
```

on the same line as the value.

## Precedence

1. `permissions.deny`-style hard skips: credential files are never read, regardless of flags.
2. `--only` narrows the rule set first.
3. `--disable` removes rules or categories from whatever `--only` left.
4. Inline `agentdoctor-disable` comments suppress findings per file.
5. `--baseline` suppresses previously accepted findings.
6. `--min-severity` filters what is left.

Suppressed counts are always reported in the summary, so a silenced finding is visible as a
number even when its detail is not.
