# Fix recipes

Read this when a finding's `help` text is not enough to act on. Recipes are grouped by rule
id prefix. Full rationale for any rule: `npx @jqntn/agentdoctor --explain <rule-id>`.

## security/unrestricted-bash, security/unrestricted-egress

Replace the wildcard with the narrowest set of commands the project genuinely runs
unattended. Derive them from the project itself (package.json scripts, Makefile, CI):

```json
"allow": ["Bash(npm test:*)", "Bash(npm run lint)", "Bash(git status)", "Bash(git diff:*)"]
```

For WebFetch, scope to domains: `"WebFetch(domain:docs.example.com)"`. If the user insists on
a blanket rule, move it to `permissions.ask` instead of `allow` so a prompt survives.

## security/destructive-allow

Move the rule from `allow` to `ask`. If only part of the command is dangerous, split it:
allow the safe subset (`Bash(git push origin main)`), ask for the rest (`Bash(git push:*)`).

## security/sensitive-read-allowed, security/missing-secret-denies

Remove the offending allow rule, then ensure the deny list contains at least:

```json
"deny": ["Read(./.env*)", "Read(**/.ssh/**)", "Read(**/*.pem)", "Read(**/.aws/credentials)"]
```

## security/secret-in-config

Move the value into the environment or a secret manager, reference it indirectly, and tell
the user to **rotate the credential** — it must be treated as leaked once committed. Do not
just delete the line; the value remains in git history.

## security/hook-remote-code

Download the remote script once, commit it under `.claude/hooks/`, make it executable, and
point the hook at `$CLAUDE_PROJECT_DIR/.claude/hooks/<name>.sh`. Show the user the script
content before committing it.

## security/mcp-unpinned-package

Pin the exact version currently in use: run `npm view <pkg> version` (or check the lockfile)
and change `@latest`/no-version to `@<that version>`.

## correctness/* typos (unknown-settings-key, unknown-hook-event, permission-unknown-tool, hook-matcher-unknown-tool, invalid-model)

The message contains a `Did you mean "X"` suggestion — apply exactly that casing. These are
the highest-value fixes in the catalogue: each one turns dead config back on.

## correctness/invalid-json

Fix the syntax error at the reported line/column (common: trailing comma before `}`, missing
comma, unquoted key). The whole file is ignored until this parses, so fix it first — other
findings in that file only appear on the next run.

## correctness/agent-* and skill-* mismatches

Rename to agree: frontmatter `name` should match the filename (agents) or directory (skills).
Prefer renaming the frontmatter unless other config references the old name.

## cost/memory-file-too-large, cost/memory-contains-generated-content

Move reference material (pasted code, long command lists, API docs) out of CLAUDE.md into a
regular file, and replace it with one line: `See docs/<topic>.md for <thing>.` Keep in
CLAUDE.md only what must apply to every session: build/test commands, conventions, hard
invariants.

## cost/duplicated-memory-instructions

Keep the instruction in the more general file (usually the repo root CLAUDE.md); delete the
copy. Never keep both — they drift until they contradict.

## Adopting on a repo with many findings (baseline)

If the user wants CI green today without fixing the backlog:

```sh
npx @jqntn/agentdoctor --no-user --write-baseline .agentdoctor-baseline.json
```

Commit the baseline. CI then runs with `--baseline .agentdoctor-baseline.json` and fails only
on new findings. Fix errors before baselining if at all possible — baselines are for debt,
not for hazards.

## Setting up a team policy

If the user manages multiple repos, offer:

```sh
npx @jqntn/agentdoctor --init-policy
```

Then edit `agentdoctor.policy.json` with them. Wildcards: a single `*` is literal (matches
exactly that rule text); `**` is the wildcard (`Bash(**sudo**)` = any Bash rule mentioning
sudo).

## Permanent installation

```sh
npx @jqntn/agentdoctor --init-ci      # GitHub Actions: SARIF PR annotations + error gate
npx @jqntn/agentdoctor --badge        # README badge showing the current grade
```

Both are overwrite-safe (they refuse if the file exists).
