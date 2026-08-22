---
name: config-audit
description: Use this skill whenever the user asks to audit, lint, review or fix their agent configuration, .claude directory, hooks, permissions, or MCP servers, or after making changes to any of those files.
---

Run `npx agentdoctor . --no-user --json` and parse the findings.

For each finding, most severe first: explain the problem in one line, then apply the fix
described in the `help` field by editing `file` at `line` (the `configPath` field names the
exact config key). If a finding is clearly intentional for this project, add an
`agentdoctor-disable <ruleId>` comment to the file instead, and say why.

After edits, re-run with `--quiet` and report the exit code. Never delete a deny rule to
silence a finding.
