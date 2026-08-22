# Getting started

## Requirements

Node 20 or newer. Nothing else — agentdoctor has zero dependencies and installs no transitive
packages.

## Run it

No install needed:

```sh
npx agentdoctor
```

Or install it:

```sh
npm install -g agentdoctor     # global CLI
npm install -D agentdoctor    # per-project, for CI
```

By default it audits the current directory plus your user-level config in `~/.claude`. To audit
a specific project, pass the path:

```sh
agentdoctor path/to/repo
agentdoctor --no-user          # project config only (use this in CI)
```

## What gets scanned

| File | What it is |
|---|---|
| `.claude/settings.json` | Project settings: permissions, hooks, env, model |
| `.claude/settings.local.json` | Personal overrides (should be gitignored) |
| `~/.claude/settings.json` | User-level settings |
| `.mcp.json` | MCP server definitions |
| `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md` | Memory files, at any depth |
| `.claude/agents/*.md` | Subagent definitions |
| `.claude/skills/*/SKILL.md` | Skill definitions |
| `.claude/commands/*.md` | Slash commands |
| `.claude/hooks/*` | Hook scripts (existence and permissions only) |
| `.claude/keybindings.json` | Key bindings |

**Never scanned:** `.credentials.json`, `.netrc`, private keys. These are skipped by path
before anything opens them, and the summary reports how many files were skipped. agentdoctor
also makes no network calls — nothing leaves your machine.

## Reading a finding

```
.claude/settings.json
  4:7     error  "Bash(*)" auto-approves every shell command, including ones
                 you have not seen.
                 | Bash(*)
                 -> Replace the wildcard with the specific commands you actually
                    want unattended, e.g. "Bash(npm test:*)".
                 security/unrestricted-bash
```

Top to bottom: file, `line:column`, severity, what is wrong, the offending value, what to do
instead, and the rule id. Every rule id works with `--explain`:

```sh
agentdoctor --explain security/unrestricted-bash
```

## Severities

| Severity | Meaning |
|---|---|
| `error` | Broken or dangerous. A guardrail that does not work, a pre-approved destructive command, a committed credential. |
| `warning` | Very likely a problem, occasionally intentional. |
| `info` | Worth knowing; act on it or ignore it. |

## Exit codes

| Code | Meaning |
|---|---|
| 0 | No errors (and warnings within `--max-warnings`, if set) |
| 1 | At least one error, or too many warnings |
| 2 | Bad usage: unknown flag, missing path, unreadable baseline |

## Next steps

- [Configuration](configuration.md) — every flag, suppression, disabling rules
- [CI setup](ci.md) — SARIF annotations, exit-code gating
- [Baselines](baselines.md) — adopting agentdoctor on a repo that already has findings
- [Team policy](policy.md) — holding many repos to one standard
- [Rule reference](rules.md) — all 72 rules and the reasoning behind each
