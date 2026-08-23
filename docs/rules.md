# Rule reference

Every rule, with the reasoning behind it - 72 in total. `agentdoctor --explain <rule-id>`
prints any of these from the CLI, and `--list-rules` prints the catalogue.

## Correctness

Config the harness is silently ignoring. These are the findings where you believe something is configured and it is not.

### `correctness/invalid-json`

**Config file is not valid JSON** &nbsp;&middot;&nbsp; `error`

The harness cannot read this file, so every setting in it is silently ignored — including any permission rules you thought were protecting you.

### `correctness/unknown-settings-key`

**Unrecognised settings key** &nbsp;&middot;&nbsp; `warning`

Unknown keys are ignored without warning, so a typo means the setting never applies.

### `correctness/unknown-permission-key`

**Unrecognised key under permissions** &nbsp;&middot;&nbsp; `warning`

Valid keys are: allow, deny, ask, defaultMode, additionalDirectories, disableBypassPermissionsMode.

### `correctness/permissions-wrong-type`

**Permission bucket is not an array** &nbsp;&middot;&nbsp; `error`

allow, deny and ask must each be an array of rule strings. A string or object here means the rules never load.

### `correctness/permission-unknown-tool`

**Permission rule names an unknown tool** &nbsp;&middot;&nbsp; `warning`

Tool names are case-sensitive. A rule naming a tool that does not exist never matches anything, so a deny rule written this way protects nothing.

### `correctness/permission-non-string`

**Permission rule is not a string** &nbsp;&middot;&nbsp; `error`

Each entry must be a string like "Bash(npm test:*)".

### `correctness/duplicate-permission`

**Duplicate permission rule** &nbsp;&middot;&nbsp; `info`

Harmless, but usually a sign of a merge that went wrong or a rule that was meant to be edited rather than added.

### `correctness/allow-deny-conflict`

**Same rule in both allow and deny** &nbsp;&middot;&nbsp; `warning`

Deny wins, so the allow entry is dead config. Remove it so the intent is unambiguous to the next reader.

### `correctness/unknown-hook-event`

**Unknown hook event** &nbsp;&middot;&nbsp; `error`

Valid events: PreToolUse, PostToolUse, UserPromptSubmit, Notification, Stop, SubagentStop, PreCompact, SessionStart, SessionEnd. Events are case-sensitive and a misspelled one never fires.

### `correctness/hook-malformed`

**Hook entry has the wrong shape** &nbsp;&middot;&nbsp; `error`

Each event maps to an array of { matcher, hooks: [{ type: "command", command: "..." }] }. A near-miss shape is dropped silently.

### `correctness/hook-matcher-ignored`

**Matcher set on an event that has no tool** &nbsp;&middot;&nbsp; `info`

Only PreToolUse, PostToolUse, PreCompact use a matcher. Elsewhere it is ignored, which can look like the hook is scoped when it is not.

### `correctness/hook-matcher-invalid-regex`

**Hook matcher is not a valid pattern** &nbsp;&middot;&nbsp; `error`

Matchers are treated as regular expressions. An invalid pattern means the hook silently never matches.

### `correctness/hook-matcher-unknown-tool`

**Hook matcher names no existing tool** &nbsp;&middot;&nbsp; `warning`

Check the spelling and casing of the tool name. A matcher that matches nothing is a hook that never fires.

### `correctness/invalid-model`

**Unrecognised model name** &nbsp;&middot;&nbsp; `warning`

Use an alias (opus, sonnet, haiku) or a full model id. An unknown value falls back to the default without telling you.

### `correctness/agent-missing-frontmatter`

**Subagent definition has no frontmatter** &nbsp;&middot;&nbsp; `error`

A subagent file needs a --- delimited frontmatter block with at least name and description. Without it the agent is not registered.

### `correctness/agent-missing-field`

**Subagent is missing a required field** &nbsp;&middot;&nbsp; `error`

Both name and description are required. The description is what the orchestrating model reads to decide whether to delegate, so an empty one means the agent is never chosen.

### `correctness/agent-name-mismatch`

**Subagent name does not match its filename** &nbsp;&middot;&nbsp; `warning`

Keep the frontmatter name and the filename in sync; mismatches make agents hard to find and, depending on the harness version, can shadow each other.

### `correctness/agent-unknown-tool`

**Subagent grants a tool that does not exist** &nbsp;&middot;&nbsp; `warning`

Tool names in the tools list are case-sensitive. An unknown entry is dropped, so the agent quietly runs without the capability you meant to give it.

### `correctness/duplicate-agent-name`

**Two subagents share a name** &nbsp;&middot;&nbsp; `error`

Names must be unique; the loser is unreachable. Project-scope agents shadow user-scope agents with the same name.

### `correctness/skill-name-mismatch`

**Skill name does not match its directory** &nbsp;&middot;&nbsp; `error`

A skill is invoked by its directory name, so a mismatched frontmatter name makes the skill impossible to invoke by the name it advertises.

### `correctness/skill-missing-field`

**Skill is missing a required field** &nbsp;&middot;&nbsp; `error`

name and description are both required. The description is the only thing the model sees when deciding whether to load the skill.

### `correctness/duplicate-skill-name`

**Two skills share a name** &nbsp;&middot;&nbsp; `error`

Only one wins. Rename one, or move it under a directory-scoped path if the collision is deliberate.

### `correctness/mcp-server-incomplete`

**MCP server has no way to start** &nbsp;&middot;&nbsp; `error`

A server needs either "command" (stdio) or "url" (SSE/HTTP). Without one the server fails to connect on every session start.

### `correctness/mcp-server-toggled-both-ways`

**MCP server both enabled and disabled** &nbsp;&middot;&nbsp; `warning`

Remove it from one of the two lists so the intended state is obvious.

### `correctness/statusline-malformed`

**statusLine is misconfigured** &nbsp;&middot;&nbsp; `warning`

statusLine must be an object with type "command" and a command string.

### `correctness/env-non-string-value`

**Environment value is not a string** &nbsp;&middot;&nbsp; `warning`

Environment variables are strings. Numbers and booleans here may be dropped or coerced unpredictably — quote them.

## Security

The config surface is an execution surface. These rules find the places where it is wider than intended.

### `security/unrestricted-bash`

**Blanket Bash allow rule** &nbsp;&middot;&nbsp; `error`

Replace the wildcard with the specific commands you actually want unattended, e.g. "Bash(npm test:*)" or "Bash(git status)". A blanket allow means any command the model proposes runs without asking you.

### `security/destructive-allow`

**Destructive command pre-approved** &nbsp;&middot;&nbsp; `error`

Move this rule to permissions.ask so you still get a prompt, or narrow it to the safe subset of the command.

### `security/bypass-permissions-default`

**Permission checks disabled by default** &nbsp;&middot;&nbsp; `error`

Use "default" or "acceptEdits" for day-to-day work and opt into bypass explicitly per session. Committing bypassPermissions applies it to everyone who checks out the repo.

### `security/hooks-globally-disabled`

**All hooks disabled** &nbsp;&middot;&nbsp; `warning`

If hooks were disabled to work around one noisy hook, remove that hook instead. disableAllHooks also silences hooks your team relies on for guardrails.

### `security/hook-remote-code`

**Hook downloads and executes remote code** &nbsp;&middot;&nbsp; `error`

Vendor the script into the repo and run it from a pinned path. Hooks run automatically with your full user privileges and no confirmation, so whoever controls that URL controls your machine.

### `security/hook-unpinned-path`

**Hook command resolves through PATH or cwd** &nbsp;&middot;&nbsp; `warning`

Use an absolute path or "$CLAUDE_PROJECT_DIR/.claude/hooks/name.sh". A bare name resolves via PATH, so a same-named file earlier in PATH — or in a repo you clone — runs instead.

### `security/hook-dangerous-command`

**Hook runs a destructive command** &nbsp;&middot;&nbsp; `warning`

Hooks fire automatically with no confirmation step. Anything irreversible belongs in a command you invoke deliberately, not in a hook.

### `security/secret-in-config`

**Credential hardcoded in agent config** &nbsp;&middot;&nbsp; `error`

Move the value to a secret manager or an untracked env file and reference it indirectly. Config files are committed, synced and shared far more often than people expect.

### `security/dangerous-env-var`

**Loader-influencing environment variable set** &nbsp;&middot;&nbsp; `warning`

Set these per-command instead of session-wide. Anything defined in settings.env applies to every process the agent spawns for the whole session.

### `security/broad-additional-directory`

**Filesystem root granted as a working directory** &nbsp;&middot;&nbsp; `error`

List only the specific sibling directories the agent needs. Granting "/" or your home directory hands it every SSH key, browser profile and other project on the machine.

### `security/unrestricted-egress`

**Unrestricted network egress pre-approved** &nbsp;&middot;&nbsp; `warning`

Scope WebFetch to the domains you actually need, e.g. "WebFetch(domain:docs.example.com)". An open fetch rule is a one-step path for anything in your context to leave the machine.

### `security/sensitive-read-allowed`

**Credential file explicitly readable** &nbsp;&middot;&nbsp; `error`

Remove the rule and add the path to permissions.deny instead. Secrets read into context end up in transcripts, logs and any tool call the model makes next.

### `security/missing-secret-denies`

**No deny rules protecting secrets** &nbsp;&middot;&nbsp; `info`

Add a deny list such as ["Read(./.env*)", "Read(**/.ssh/**)", "Read(**/*.pem)", "Read(**/.aws/credentials)"]. Deny rules are the only guardrail that survives an accepted prompt, since they are checked before anything runs.

### `security/mcp-unpinned-package`

**MCP server runs an unpinned remote package** &nbsp;&middot;&nbsp; `warning`

Pin the exact version, e.g. "@scope/server@1.4.2". With "@latest" or no version, every session silently installs whatever was published most recently, including a compromised release.

### `security/mcp-auto-enable-all`

**Project MCP servers auto-enabled without review** &nbsp;&middot;&nbsp; `warning`

Leave this off and enable servers explicitly via enabledMcpjsonServers. Otherwise cloning a repo is enough to run its MCP servers on your machine.

### `security/mcp-plaintext-url-credential`

**Credential embedded in MCP server URL** &nbsp;&middot;&nbsp; `error`

Move the token into a header sourced from the environment. URLs land in logs, crash reports and shell history.

### `security/world-writable-config`

**Agent config writable by other users** &nbsp;&middot;&nbsp; `error`

Run "chmod go-w" on the file. Any user who can write your agent config can add a hook, and hooks execute automatically as you.

### `security/hook-script-not-executable`

**Hook script is world-writable or missing** &nbsp;&middot;&nbsp; `warning`

Keep hook scripts inside the repo, owned by you, and not group-writable.

### `security/apikeyhelper-inline-secret`

**apiKeyHelper echoes a literal key** &nbsp;&middot;&nbsp; `error`

Point apiKeyHelper at a script that reads from your OS keychain or secret manager, rather than embedding the key in the command.

### `security/deny-bucket-empty-with-broad-allow`

**Broad allow list with no deny list** &nbsp;&middot;&nbsp; `warning`

Pair permissive allow rules with explicit denies. Deny is evaluated first and is the only rule class the model cannot talk its way past.

### `security/bypass-mode-not-locked`

**Bypass mode not disabled for the project** &nbsp;&middot;&nbsp; `info`

Set permissions.disableBypassPermissionsMode to "disable" in committed project settings to stop anyone opting out of prompts in this repo.

### `security/invalid-permission-mode`

**Unknown permission mode** &nbsp;&middot;&nbsp; `error`

Use one of: default, acceptEdits, plan, bypassPermissions. An unrecognised mode is ignored, so you silently fall back to the default.

## Cost

Memory files and tool schemas are re-sent on every request, so their size is a recurring charge. These rules quantify it.

### `cost/memory-file-too-large`

**Memory file is large enough to cost real money** &nbsp;&middot;&nbsp; `warning`

Move reference material into a skill or a linked file that gets read on demand. Memory files are prepended to every request, so their size multiplies by every turn you take.

### `cost/total-memory-budget`

**Combined always-on context is heavy** &nbsp;&middot;&nbsp; `warning`

Aim to keep the always-loaded total under a few thousand tokens. Everything here competes with the actual task for the model attention you are paying for.

### `cost/duplicated-memory-instructions`

**The same instruction appears in several memory files** &nbsp;&middot;&nbsp; `info`

Keep each instruction in exactly one file. Duplicates cost tokens twice and, worse, drift apart until they contradict each other.

### `cost/many-mcp-servers`

**Many MCP servers enabled at once** &nbsp;&middot;&nbsp; `warning`

Enable servers per project rather than globally. Every connected server contributes its tool schemas to the context window on every request, whether or not you use it.

### `cost/vague-skill-description`

**Skill description gives the model nothing to match on** &nbsp;&middot;&nbsp; `warning`

Write descriptions as trigger conditions: "Use when the user asks to X, mentions Y, or is working on Z." The description is the only signal the model has, so a vague one means the skill you wrote is never used.

### `cost/vague-agent-description`

**Subagent description will not attract delegation** &nbsp;&middot;&nbsp; `info`

State what the agent is for and when to pick it. Orchestrators route on this string alone.

### `cost/memory-contains-generated-content`

**Memory file contains content that belongs in a file, not in context** &nbsp;&middot;&nbsp; `warning`

Reference the file by path instead of pasting it. The agent can read a path in one tool call; pasted content is paid for on every single request forever.

### `cost/no-cleanup-period`

**Transcript retention never trimmed** &nbsp;&middot;&nbsp; `info`

Set cleanupPeriodDays to something like 30. Old transcripts are dead weight on disk and, if they contain customer data, a growing liability.

## Hygiene

Legal, safe config that will still cause avoidable confusion or leak personal settings between machines.

### `hygiene/local-settings-not-ignored`

**Local settings file is not gitignored** &nbsp;&middot;&nbsp; `error`

Add ".claude/settings.local.json" to .gitignore. That file is where personal overrides and machine-specific paths go, and committing it pushes your permissions onto everyone else.

### `hygiene/empty-config`

**Config file has no effective content** &nbsp;&middot;&nbsp; `info`

Delete it, or fill it in. An empty file reads as "configured" to the next person who opens the repo.

### `hygiene/skill-body-empty`

**Skill has frontmatter but no instructions** &nbsp;&middot;&nbsp; `warning`

The body is what the model actually follows once the skill loads. Frontmatter alone advertises a capability that does nothing.

### `hygiene/agent-body-empty`

**Subagent has no system prompt** &nbsp;&middot;&nbsp; `warning`

The body of an agent file is its system prompt. Without one the subagent behaves like a default agent with a narrower toolset.

### `hygiene/no-project-memory`

**No project memory file** &nbsp;&middot;&nbsp; `info`

A short CLAUDE.md covering build/test commands and project conventions removes the same handful of questions from every session.

### `hygiene/absolute-home-path`

**Committed config contains a machine-specific path** &nbsp;&middot;&nbsp; `warning`

Use $CLAUDE_PROJECT_DIR or a relative path so the config works on every machine. Hardcoded home directories break for every other contributor.

### `hygiene/settings-scope-conflict`

**Local settings silently override project settings** &nbsp;&middot;&nbsp; `info`

Not a bug, but worth knowing: this key differs between the committed project config and your local override, so your session behaves differently from your teammates.

### `hygiene/keybindings-duplicate`

**Two actions bound to the same key** &nbsp;&middot;&nbsp; `warning`

One of the two bindings will not fire. Pick a different chord for the loser.

## Policy

Enforcement of a written standard across more than one repository. These rules activate when an agentdoctor.policy.json is committed and are silent otherwise.

### `policy/missing-required-deny`

**Required deny rule is absent** &nbsp;&middot;&nbsp; `error`

Add the rule to committed project settings. It is mandated by your agentdoctor.policy.json.

### `policy/forbidden-allow`

**Allow rule forbidden by policy** &nbsp;&middot;&nbsp; `error`

Remove the rule or get the policy amended. Policy exists so this decision is made once, centrally, instead of per repo.

### `policy/unapproved-mcp-server`

**MCP server not on the approved list** &nbsp;&middot;&nbsp; `error`

MCP servers run code and see your context. Add the server to allowedMcpServers in policy once it has been reviewed.

### `policy/required-hook-missing`

**Mandated guardrail hook is missing** &nbsp;&middot;&nbsp; `error`

Policy requires this hook event to be configured. Copy it from your organisation template.

### `policy/memory-budget-exceeded`

**Always-on context exceeds the policy budget** &nbsp;&middot;&nbsp; `error`

Trim the memory files or raise maxMemoryTokens deliberately. A context budget is the only thing that stops CLAUDE.md growing without limit.

### `policy/forbidden-permission-mode`

**Permission mode forbidden by policy** &nbsp;&middot;&nbsp; `error`

Change defaultMode to a mode your policy permits.

### `policy/permission-drift`

**Local overrides widen the committed permission set** &nbsp;&middot;&nbsp; `warning`

Local settings are invisible in review. If a rule is genuinely needed, put it in project settings so the team sees it; if it is personal, keep it narrow.

### `policy/file-invalid`

**Policy file could not be read** &nbsp;&middot;&nbsp; `error`

A policy that fails to parse enforces nothing, which is the most dangerous state for a guardrail to be in.

---

Suppress any rule for one file with a comment in that file:

```
agentdoctor-disable <rule-id>
```
