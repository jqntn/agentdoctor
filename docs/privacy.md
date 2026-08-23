# Privacy

**agentdoctor collects nothing, transmits nothing, and has no servers.**

That claim is easy to make and hard to trust, so here is exactly what the tool does, and how
you can verify each point yourself.

## What it reads

Only files in the project you point it at, plus your user-level configuration in `~/.claude`
unless you pass `--no-user`:

`.claude/settings.json`, `.claude/settings.local.json`, `~/.claude/settings.json`, `.mcp.json`,
`CLAUDE.md` / `CLAUDE.local.md` / `AGENTS.md`, `.claude/agents/*.md`,
`.claude/skills/*/SKILL.md`, `.claude/commands/*.md`, `.claude/hooks/*`,
`.claude/keybindings.json`, and `.gitignore`.

## What it never reads

Credential files are excluded **by path, before anything opens them**:
`.credentials.json`, `credentials.json`, `.netrc`, `id_rsa`, `id_ed25519`. The report tells you
how many files were skipped for this reason. A test in the suite plants a tripwire value inside
a credentials file and asserts it can never appear in any output.

## What leaves your machine

Nothing. There is no telemetry, no analytics, no crash reporting, no licence check, no update
check, and no phone-home of any kind. The tool makes **zero network requests**. You can confirm
this by running it with the network disabled, or by reading the source — there is no HTTP client
in it, and it has zero dependencies, so there is no transitive code that could add one.

## What it writes

Nothing, unless you explicitly ask:

- `--write-baseline <file>` writes a list of accepted finding fingerprints
- `--init-ci`, `--init-skill`, `--init-agents`, `--init-policy` each create one well-known file
  and refuse to overwrite an existing one

It never edits your configuration. Findings tell you what to change; the change is yours.

## Secrets in output

When a rule detects a credential-shaped value, the finding shows a short prefix and suffix with
`(redacted)` — never the value. This holds in every output format, so reports are safe to paste
into an issue, a CI log, or a model's context.

`--share` goes further: it emits only rule ids and counts, never file paths, messages, or
snippets, so a score card is safe to post publicly from a private repository.

## This website

Static files served by GitHub Pages. No analytics, no cookies, no trackers, no fonts or scripts
loaded from third parties. The one exception is a linked badge image hosted by openhunts.com in
the footer; requesting it reveals your IP address to that host, as any remote image does.

## Contact

Questions or a discrepancy between this page and the code:
<https://github.com/jqntn/agentdoctor/issues>
