# CLAUDE.md

Repo instructions for Claude Code. The full contract lives in @AGENTS.md — read it before
changing anything.

The two commands that matter: `npm test` (must stay green) and `node bin/agentdoctor.js .`
(the tool must pass its own audit with zero findings). Zero dependencies is a hard invariant;
never add one. `docs/rules.md` is generated — edit rules in `src/rules/` and run
`node tools/gen-docs.mjs`.
