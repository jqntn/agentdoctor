# agentdoctor (Claude Code plugin)

This directory is the installable plugin: a manifest and the `config-audit` skill, and nothing
else. It is deliberately separate from the repository root so that installing the plugin fetches
only these files — not the linter's source, its test fixtures, or the site generator.

The skill shells out to `npx @jqntn/agentdoctor`, so the plugin itself installs no binary.

- Source and issues: <https://github.com/jqntn/agentdoctor>
- Documentation: <https://jqntn.github.io/agentdoctor/>
