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

## A ready-made Claude Code skill

Drop this in `.claude/skills/config-audit/SKILL.md` to give Claude Code a first-class audit
command (also shipped in the repo under `examples/claude-skill/`):

```markdown
---
name: config-audit
description: Use this skill whenever the user asks to audit, lint, review or fix their
  agent configuration, .claude directory, hooks, permissions, or MCP servers, or after
  making changes to any of those files.
---

Run `npx agentdoctor . --no-user --json` and parse the findings.

For each finding, most severe first: explain the problem in one line, then apply the fix
described in the `help` field by editing `file` at `line` (the `configPath` field names the
exact config key). If a finding is clearly intentional for this project, add an
`agentdoctor-disable <ruleId>` comment to the file instead, and say why.

After edits, re-run with `--quiet` and report the exit code. Never delete a deny rule to
silence a finding.
```

## For agents working on this repository

The repo root carries an `AGENTS.md` (mirrored by `CLAUDE.md`) with the build/test commands,
the architectural invariants, and the rules for adding rules. The docs site serves
[`llms.txt`](https://REPLACE_ME.github.io/agentdoctor/llms.txt) and a concatenated
`llms-full.txt`, and every docs page is also available as raw markdown at the same URL with
`.md` — agents should prefer those over scraping HTML.
