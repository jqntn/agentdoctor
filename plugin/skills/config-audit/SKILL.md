---
name: config-audit
description: Audit and fix AI coding-agent configuration with agentdoctor. Use whenever the user asks to audit, lint, review, secure, or fix their agent config, .claude directory, permissions, hooks, MCP servers, skills, subagents, or CLAUDE.md; after any edit to those files; when a hook "isn't firing" or a permission rule "isn't working"; or when the user asks for their config grade. Requires only npx.
---

# Audit agent configuration with agentdoctor

agentdoctor is a zero-dependency linter for agent config, covering security, correctness,
cost, hygiene and team policy. It makes no network calls and never opens credential files, so it
is safe to run unattended in any project.

## Run the audit

```sh
npx @jqntn/agentdoctor . --no-user --json
```

Nothing is installed by this skill itself: `npx` uses the project's own `agentdoctor` if one
is in `node_modules`, and otherwise fetches it on first use (then caches it). If the user
wants it permanent and versioned, offer `npm install -D @jqntn/agentdoctor`; if `npx` cannot fetch
(offline/registry-blocked environment) and there is no local install, say so and stop rather
than improvising an audit by hand.

Exit codes: `0` clean, `1` findings with severity error exist, `2` usage error. **Exit 1 is a
successful audit** — valid JSON is still on stdout; only exit 2 means the run itself failed.

Key fields per finding (already sorted most-severe-first):

| Field | Use it to |
|---|---|
| `severity` | `error` > `warning` > `info` |
| `message` | explain the problem to the user in one line |
| `help` | apply the fix — it states what to change and why |
| `file` + `line` | locate the edit |
| `configPath` | the exact config key, e.g. `permissions.allow[2]` |
| `snippet` | the offending value (secrets arrive redacted) |
| top-level `grade` | `A+` (clean) through `F` (3+ errors) — report it to the user |

## Fix loop

For each finding, most severe first:

1. State the problem in one line (use `message`).
2. Edit `file` at `line`, guided by `help`; `configPath` names the exact key. Typical fixes
   are in `references/fix-recipes.md` — read it when a fix is not obvious from `help`.
3. If the finding is clearly intentional for this project, do NOT silently skip it: add a
   suppression comment to that file and tell the user why:
   `agentdoctor-disable <ruleId>`

Then verify:

```sh
npx @jqntn/agentdoctor . --no-user --quiet
```

Exit 0 means clean. Re-run the JSON audit if it is still 1 and continue.

## Hard rules

- **Never delete or weaken a `deny` rule to silence a finding.** Fix the rule (usually a
  casing or tool-name typo) so it actually blocks what it names.
- **Never widen an allow rule as a "fix".** Findings about broad rules are fixed by
  narrowing, moving to `permissions.ask`, or adding deny rules.
- **Never echo secrets.** Findings arrive redacted; keep them that way in your summary.
- If more than ~10 findings exist, fix all errors, then ask the user whether to continue
  with warnings or record a baseline instead (see `references/fix-recipes.md`).

## Report back

End with: the grade before and after, what you fixed (rule ids), what you suppressed and why,
and anything needing a human decision. If the user wants to track this in CI or show the
grade, the one-command options are `npx @jqntn/agentdoctor --init-ci` and `npx @jqntn/agentdoctor --badge`.
