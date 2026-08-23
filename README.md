<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/jqntn/agentdoctor/main/assets/logo-dark.svg">
    <img src="https://raw.githubusercontent.com/jqntn/agentdoctor/main/assets/logo-light.svg" alt="agentdoctor" width="420">
  </picture>

  <p><strong>Lint your AI coding agent's configuration before it bites.</strong></p>

  <p>
    <a href="https://github.com/jqntn/agentdoctor/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/jqntn/agentdoctor/actions/workflows/ci.yml/badge.svg"></a>
    <a href="https://www.npmjs.com/package/@jqntn/agentdoctor"><img alt="npm" src="https://img.shields.io/npm/v/%40jqntn%2Fagentdoctor"></a>
    <img alt="zero dependencies" src="https://img.shields.io/badge/dependencies-0-34D399">
    <img alt="node &gt;=20" src="https://img.shields.io/badge/node-%3E%3D20-64748B">
    <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-blue"></a>
  </p>

  <p>
    <a href="https://jqntn.github.io/agentdoctor/">Website</a> ·
    <a href="docs/getting-started.md">Getting started</a> ·
    <a href="docs/rules.md">Rule reference</a> ·
    <a href="docs/ci.md">CI setup</a> ·
    <a href="docs/agents.md">For agents</a>
  </p>
</div>

---

Agent harnesses read a surprising amount of config: permission rules, hooks that execute
automatically, MCP servers that run third-party code, and memory files re-sent on every
request. Almost none of it is validated, and the failures are **silent**. A misspelled hook
event never fires. A deny rule naming a tool that does not exist blocks nothing — while
looking exactly like a guardrail. `Bash(*)` in an allow list means every command the model
proposes runs without asking you.

`agentdoctor` reads that config and tells you what is actually wrong with it:

```sh
npx @jqntn/agentdoctor
```

```
agentdoctor scanned 8 config files in /work/api

.claude/settings.json
  4:7     error  "Bash(*)" auto-approves every shell command, including ones you have not seen.
                 | Bash(*)
                 -> Replace the wildcard with the specific commands you actually want
                    unattended, e.g. "Bash(npm test:*)" or "Bash(git status)".
                 security/unrestricted-bash

  27:43   error  PreToolUse hook uses curl | sh; the remote content is executed unreviewed on
                 every trigger.
                 | curl -sSL https://example.com/guard.sh | bash
                 -> Vendor the script into the repo and run it from a pinned path.
                 security/hook-remote-code

  35:21   error  "PostToolUsee" is not a hook event. Did you mean "PostToolUse"? As written,
                 this hook never runs.
                 correctness/unknown-hook-event

CLAUDE.md
  1       warn   CLAUDE.md is ~14,200 tokens of always-on context, sent with every request
                 (~$25/month at 3,300 requests, assuming it stays prompt-cached).
                 cost/memory-file-too-large

Summary  Grade F  3 errors, 1 warning  - 72 rules in 41ms
```

Zero dependencies. No network calls. Credential files are never opened. MIT — all of it.

## What it checks

Findings fall into five categories. The bar for a rule is that it catches a failure that
actually happens **and** stays quiet on legitimate config: a correctly configured project
reports nothing, which the test suite asserts against a fixture. False positives are treated
as more severe than missed findings, because a linter that cries wolf gets uninstalled and
then catches nothing at all.

Every rule states what is wrong, why it matters, and what to change instead, and every rule
has a test. There are 72 today; the current catalogue is always in the
[rule reference](docs/rules.md), or `agentdoctor --list-rules`.

### Security

The config surface is an execution surface. Blanket `Bash(*)` allows; destructive commands
pre-approved without confirmation (`sudo`, `rm -rf`, force push, `terraform destroy`,
`DROP TABLE`, …); hooks piping remote content into a shell (`curl | sh`,
`eval "$(curl …)"`); live credentials committed in config (Anthropic, OpenAI, GitHub, AWS,
Slack, Stripe keys, JWTs, private keys — always reported **redacted**); MCP servers running
unpinned packages or carrying tokens in URLs; `bypassPermissions` committed to shared repos;
loader-hijacking env vars; world-writable config.

### Correctness

Config that is silently ignored is worse than config that errors, because you believe it is
working. Invalid JSON (which voids the whole file, permission rules included); misspelled
settings keys, hook events, tool names, and models — each with a did-you-mean; deny rules
that block nothing (an **error**, because it is a guardrail that only looks like one);
malformed hooks and invalid matcher regexes; duplicate agent/skill names; MCP servers with no
way to start.

### Cost

Memory files and MCP tool schemas ride along on every request. Token counts for every memory
file with an estimated monthly cost — the estimate assumes the file stays prompt-cached
(that is exactly the content that caches) and states its assumptions; the same instruction
duplicated across files; pasted code blocks that belong behind a file path; skill
descriptions too vague for the model to ever load them.

### Hygiene

`settings.local.json` not gitignored; machine-specific absolute paths in committed config;
local settings silently shadowing project settings; empty skill/agent bodies; duplicate
keybindings.

### Policy

Team standards, enforced mechanically across every repo. Commit an
`agentdoctor.policy.json` and these activate — no flag, no account:

```sh
agentdoctor --init-policy
```

`requiredDeny`, `forbiddenAllow`, `allowedMcpServers`, `requiredHooks`, `maxMemoryTokens`,
`forbiddenPermissionModes`, plus drift detection when local settings quietly widen the
committed permission set. [Policy guide](docs/policy.md).

## Adopt it in one command

```sh
npx @jqntn/agentdoctor --init-ci      # GitHub Actions: SARIF annotations on PRs + error gate
npx @jqntn/agentdoctor --init-skill   # Claude Code skill: findings -> fixes, automatically
npx @jqntn/agentdoctor --init-agents  # AGENTS.md section: same loop for Codex, Cursor, Gemini CLI
npx @jqntn/agentdoctor --badge        # README badge with your current grade
npx @jqntn/agentdoctor --share        # paste-ready score card (rule ids + counts only)
```

Every audit ends in a grade - `A+` down to `F`, formula stated in the docs. The badge and the
share card contain rule ids and counts only, never messages, paths, or snippets, so they are
safe to post from private repos.

[![agentdoctor: A+](https://img.shields.io/badge/agentdoctor-A%2B-34D399)](https://jqntn.github.io/agentdoctor/)

## CI

```yaml
- run: npx @jqntn/agentdoctor --no-user --sarif > agentdoctor.sarif
  continue-on-error: true
- uses: github/codeql-action/upload-sarif@v3
  with: { sarif_file: agentdoctor.sarif }
- run: npx @jqntn/agentdoctor --no-user --quiet   # exit 1 on errors
```

Findings annotate the PR diff via SARIF. Adopting on a repo with existing findings? Record
them once and fail only on new ones — baselines are anchored to content, not line numbers, so
unrelated edits never invalidate them:

```sh
agentdoctor --write-baseline .agentdoctor-baseline.json   # once
agentdoctor --baseline .agentdoctor-baseline.json         # in CI
```

[CI guide](docs/ci.md) · [Baselines](docs/baselines.md)

## Built for agents, audited by agents

Every capability is non-interactive and machine-readable: `--json` (stable schema, shipped as
[JSON Schema](schemas/report.schema.json)), `--sarif`, `--explain`, `--list-rules --json`,
deterministic ordering, redacted secrets safe for model context, pipe-safe output. The docs
site serves `llms.txt` and raw markdown.

The repo is also a **Claude Code plugin**: it ships the
[config-audit skill](plugin/skills/config-audit/SKILL.md) (audit -> fix loop, with fix recipes) and
invokable as `/agentdoctor:config-audit`. Install it any of three ways:

```
# in Claude Code, then: /plugin install agentdoctor
/plugin marketplace add jqntn/agentdoctor

# copies the skill into this project only
npx @jqntn/agentdoctor --init-skill

# by hand, from an installed package
cp -r node_modules/@jqntn/agentdoctor/plugin/skills/config-audit .claude/skills/
```

[Agent guide](docs/agents.md)

## What it will not do

- **Never reads credential files.** `.credentials.json`, `.netrc`, private keys are excluded
  by path before anything opens them — asserted by tests.
- **No network calls.** No telemetry, no update checks, nothing leaves the machine.
- **No dependencies.** A tool that warns about supply-chain risk should not install one.
- **Never edits your config.** Findings say what to change and why; the change is yours.

[Architecture and design principles](docs/architecture.md) · [FAQ](docs/faq.md) ·
[Security policy](SECURITY.md)

## Documentation

| | |
|---|---|
| [Getting started](docs/getting-started.md) | Install, first run, reading findings, exit codes |
| [Configuration](docs/configuration.md) | Every flag, suppression, disabling rules |
| [Rule reference](docs/rules.md) | Every rule, with the reasoning behind it |
| [CI setup](docs/ci.md) | GitHub Actions, SARIF, exit-code gating |
| [Baselines](docs/baselines.md) | Adopting on an existing repo |
| [Team policy](docs/policy.md) | One standard across many repos |
| [Output formats](docs/output.md) | JSON, SARIF, terminal |
| [Programmatic API](docs/api.md) | `run()`, custom rules, embedding |
| [For agents](docs/agents.md) | The machine-readable contract + fix loop |
| [Architecture](docs/architecture.md) | How it works, design principles |
| [FAQ](docs/faq.md) | |

## Contributing

False positives are treated as more severe than missed findings — if a rule fires on your
legitimate config, [that is a bug](.github/ISSUE_TEMPLATE/false-positive.yml). Adding a rule
takes one object and two tests: see [CONTRIBUTING.md](CONTRIBUTING.md). The suite enforces the
invariants (every rule tested, zero findings on the clean fixture, zero dependencies), so if
`npm test` is green, the PR is reviewable.

## License

[MIT](LICENSE). Every rule, every output format, no accounts, no telemetry, no paid tier.
