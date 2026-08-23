---
description: Audit this project's agent configuration with agentdoctor and fix what it finds
---

Audit this project's agent configuration.

Run `npx @jqntn/agentdoctor . --no-user --json` and follow the config-audit skill's fix loop: for
each finding (most severe first) explain the problem in one line, apply the fix from its
`help` field by editing `file` at `line`, or add an `agentdoctor-disable <ruleId>` comment
with a stated reason if it is clearly intentional. Never delete or weaken a deny rule, never
widen an allow rule, never echo unredacted secrets.

Verify with `npx @jqntn/agentdoctor . --no-user --quiet` and report the grade before and after,
what was fixed, and what was suppressed and why.

$ARGUMENTS
