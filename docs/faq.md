# FAQ

## Is my config uploaded anywhere?

No. agentdoctor makes zero network calls — no telemetry, no update checks, no license pings.
The entire run is local file reads. It also never opens credential files
(`.credentials.json`, `.netrc`, private keys); they are excluded by path before anything
reads them, and the summary reports how many were skipped.

## Why did it find nothing?

Probably because your config is small. A 10-line `settings.json` with two permission rules
has little to get wrong, and agentdoctor is deliberately quiet on healthy setups — the test
suite asserts zero findings on a well-configured project. The findings density rises with
hooks, MCP servers, subagents, skills, and memory files.

## Isn't this just a JSON schema?

A schema catches type errors. It cannot tell you that `Bash(*)` is a bad idea, that your hook
script does not exist on disk, that your deny rule names a tool that does not exist (and
therefore blocks nothing), or that your `CLAUDE.md` costs real money per month. Most of the
catalogue is semantic, not structural.

## Why do you report warnings on things that are technically legal?

Because the failure mode this tool exists for is config that is *legal and inert*. A
misspelled hook event is valid JSON. It just never fires, and nothing tells you. When
agentdoctor is unsure, it says `info`; when something is legal but almost certainly not what
you meant, `warning`; when a guardrail provably does nothing or a real hazard is
pre-approved, `error`.

## A rule fired on something intentional. What now?

Suppress it where it fired, visibly:

```
// agentdoctor-disable security/hook-unpinned-path
```

If you believe the rule is wrong in general, that is a bug — false positives are treated as
more severe than false negatives. Open an issue with the config that triggered it.

## How accurate are the cost estimates?

The token counts are direct estimates from file size. The money figures are a *model*, and the
message says so: they assume the memory file stays prompt-cached (it sits at the front of the
prompt, which is exactly the content that caches) and state the request volume they assume.
The uncached worst case is also shown where it matters. Assumptions live in
`src/rules/cost.js` where you can disagree with them.

## Does it modify my config?

No. agentdoctor reports; you decide. Every finding includes what to change and why, but the
edit is yours. The only file it ever writes is a baseline, and only when you pass
`--write-baseline`.

## Which harnesses does it understand?

The `.claude/` configuration surface (Claude Code and compatible tooling), `.mcp.json` MCP
server definitions, and the `CLAUDE.md`/`AGENTS.md` memory-file convention. The rule engine is
harness-agnostic — discovery is the only layer that knows file layouts — so support for other
agent config formats is an issue away.

## Why Node 20+? Why zero dependencies?

Node 20 is the oldest LTS with everything the tool needs built in. Zero dependencies is a
security decision, not an aesthetic one: a tool that warns you about unpinned supply chains
should not install one.

## Can I use it as a library?

Yes — `import { run } from 'agentdoctor'` and you get structured findings. See the
[API docs](api.md), including how to add organisation-specific rules.
