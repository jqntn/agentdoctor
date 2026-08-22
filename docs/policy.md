# Team policy

One repo can be audited by reading it. Forty repos need a written standard that CI checks
mechanically — that is what `agentdoctor.policy.json` is. Commit it at the repo root (or ship
the same file to every repo from a central location) and the eight `policy/*` rules activate
automatically. No flag, no account. Repos without a policy file never see these rules fire.

## Quick start

```sh
agentdoctor --init-policy
```

writes a starter policy:

```json
{
  "requiredDeny": ["Read(./.env*)", "Read(**/.ssh/**)", "Read(**/*.pem)", "Read(**/.aws/credentials)"],
  "forbiddenAllow": ["Bash(*)", "Bash(:*)", "Bash()", "WebFetch(*)", "Bash(**sudo**)", "Bash(**rm -rf**)"],
  "forbiddenPermissionModes": ["bypassPermissions"],
  "allowedMcpServers": [],
  "requiredHooks": [],
  "maxMemoryTokens": 6000
}
```

Edit, commit, done. `agentdoctor` now fails (exit 1) when the repo violates it.

## Fields

### `requiredDeny: string[]`

Deny rules every repo must carry, in any settings file. Enforced by
`policy/missing-required-deny`. Deny rules are the only guardrail evaluated before anything
runs, which makes them the one thing worth mandating centrally.

### `forbiddenAllow: string[]`

Allow rules no repo may carry. Enforced by `policy/forbidden-allow`.

### `allowedMcpServers: string[]`

If present, every configured MCP server name must match an entry. Enforced by
`policy/unapproved-mcp-server`. This turns "someone committed a new MCP server" from a silent
event into a review decision. Omit the field entirely to skip this check; an empty array means
*no servers are approved*.

### `requiredHooks: string[]`

Hook events that must be configured, e.g. `["PreToolUse"]` if your org mandates a guardrail
hook. Enforced by `policy/required-hook-missing`.

### `maxMemoryTokens: number`

A ceiling on the estimated token size of the project's always-on memory files (`CLAUDE.md`
et al., user scope excluded). Enforced by `policy/memory-budget-exceeded`. A context budget is
the only thing that stops memory files growing without limit.

### `forbiddenPermissionModes: string[]`

Usually `["bypassPermissions"]`. Enforced by `policy/forbidden-permission-mode`.

## Wildcard semantics

Permission rules themselves contain `*`, so policy patterns treat it literally:

- A single `*` is **literal**. `"Bash(*)"` forbids exactly the rule `Bash(*)` — it does **not**
  forbid `Bash(npm test:*)`.
- `**` is the **wildcard**. `"Bash(**)"` matches every Bash rule; `"Bash(**sudo**)"` matches
  any Bash rule mentioning sudo.

This is the difference between "nobody may have the blanket rule" and "nobody may run Bash at
all" — the starter policy uses both deliberately.

## Two rules that need no policy fields

- `policy/permission-drift` fires when `.claude/settings.local.json` adds an *unrestricted*
  allow rule the committed project config does not grant. Local settings are invisible in code
  review; this makes the widening visible.
- `policy/file-invalid` fires when the policy file itself fails to parse — a policy that
  silently enforces nothing is the worst state for a guardrail.

## Rolling out across an organisation

1. Write one policy centrally. Start with `requiredDeny` + `forbiddenPermissionModes` only —
   they are the least controversial and catch the worst failure modes.
2. Ship it to each repo (commit it, or `curl` it in CI before running agentdoctor).
3. Run `agentdoctor --no-user` in CI. Use a [baseline](baselines.md) per repo if there is a
   backlog.
4. Tighten over time: add `allowedMcpServers` once you have inventoried what is in use, then
   `maxMemoryTokens` once teams have trimmed.

A JSON Schema for the policy file ships with the package (`schemas/policy.schema.json`) and is
served on the docs site, so editors validate it as you type.
