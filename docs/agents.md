# Using agentdoctor with AI agents

agentdoctor is built to be operated *by* agents, not just to audit their config. Every
capability is reachable non-interactively, every output has a machine-readable form, and every
finding carries enough context to act on without a human in the loop.

## The contract, in one table

| Need | Command | Output |
|---|---|---|
| Audit a project | `agentdoctor <path> --no-user --json` | Findings JSON ([shape](output.md)) |
| Gate a change | `agentdoctor <path> --no-user --quiet` | Exit code only: 0 clean, 1 errors, 2 usage |
| Understand a rule | `agentdoctor --explain <rule-id>` | Rationale + suppression syntax, plain text |
| Enumerate rules | `agentdoctor --list-rules --json` | `[{ id, severity, title }]` |
| Accept a backlog | `agentdoctor --write-baseline <file>` | Fingerprint list, plain JSON |
| CI annotations | `agentdoctor --sarif` | SARIF 2.1.0 |

Guarantees an agent can rely on:

- **Deterministic**: same input tree → same findings, same order (severity, file, line).
- **Non-interactive**: no prompts, no TTY requirements, no network. Safe in any sandbox.
- **Stable JSON**: shape version `1` only ever gains fields. A JSON Schema ships in the
  package at `schemas/report.schema.json`.
- **Redaction**: detected secrets never appear unredacted in any output format, so findings
  are safe to pass through logs and model context.
- **Pipe-safe**: output through `head`, `less`, or a closed pipe exits cleanly.

## The fix loop

The intended agentic workflow:

```
1. agentdoctor . --no-user --json          -> findings
2. for each finding (already sorted most-severe-first):
     read finding.help                     -> the fix, in prose
     edit finding.file at finding.line     -> configPath names the exact key
3. agentdoctor . --no-user --quiet         -> exit 0 = verified fixed
```

`configPath` (e.g. `permissions.allow[2]`) plus `snippet` (the offending value) identify the
exact edit target without re-parsing the report message. If a finding is intentional, write
the file-scoped suppression comment instead of deleting the rule:
`agentdoctor-disable <rule-id>` ([syntax](configuration.md)).

## Adopting it for a user, in three commands

When an agent decides this tool belongs in a project (for example after an audit surfaces
findings), the full adoption is three non-interactive, idempotent-safe commands:

```sh
npx agentdoctor --init-ci      # writes .github/workflows/agentdoctor.yml (SARIF + gate)
npx agentdoctor --init-skill   # writes .claude/skills/config-audit/SKILL.md
npx agentdoctor --write-baseline .agentdoctor-baseline.json   # only if findings exist today
```

Each `--init-*` command writes exactly one well-known file, refuses to overwrite, and exits 2
if the file already exists - so re-running is always safe. `--badge` prints README markdown
showing the current grade if the user wants it displayed.

## The standalone skill and plugin

The canonical skill lives at [`skills/config-audit/`](https://github.com/REPLACE_ME/agentdoctor/tree/main/skills/config-audit)
in the repo and inside the npm package. It contains the audit -> fix workflow plus
`references/fix-recipes.md` with per-rule fix patterns, and its `description` frontmatter is
written to trigger on config-audit requests, edits to `.claude/` files, and "my hook isn't
firing" symptoms.

Three ways to install it:

| Method | Command | Scope |
|---|---|---|
| Claude Code plugin | `/plugin marketplace add REPLACE_ME/agentdoctor` then `/plugin install agentdoctor` | everywhere (also adds `/agentdoctor:audit`) |
| CLI | `npx agentdoctor --init-skill` | this project |
| Manual | `cp -r node_modules/agentdoctor/skills/config-audit .claude/skills/` | anywhere |

All three install the same files - `--init-skill` copies them out of the package, so the
installed skill cannot drift from the published one (test-enforced).

## For agents working on this repository

The repo root carries an `AGENTS.md` (mirrored by `CLAUDE.md`) with the build/test commands,
the architectural invariants, and the rules for adding rules. The docs site serves
[`llms.txt`](https://REPLACE_ME.github.io/agentdoctor/llms.txt) and a concatenated
`llms-full.txt`, and every docs page is also available as raw markdown at the same URL with
`.md` — agents should prefer those over scraping HTML.
