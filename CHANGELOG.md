# Changelog

## 0.1.1

No functional changes: the rules, CLI and output are identical to 0.1.0. This release exists to
exercise the OIDC trusted-publishing pipeline end to end, and carries one CI fix.

- `fix(ci)`: the publish workflow's dry-run mode ran `npm publish --dry-run`, which always
  fails once the current version exists, so the check broke the moment 0.1.0 shipped. It now
  validates the tarball and reports whether the version is still free.

## 0.1.0

First release.

- 72 rules across security, correctness, cost, hygiene and team policy - all free, MIT
- A health grade (A+ to F) on every audit, with a one-sentence formula
- `--share` (paste-ready score card, rule ids and counts only) and `--badge` (README badge)
- One-command adoption: `--init-ci` (GitHub Actions with SARIF PR annotations + gate) and
  `--init-skill` (a Claude Code skill that turns findings into fixes)
- Team policy enforcement via a committed `agentdoctor.policy.json`
- Terminal, JSON (with shipped JSON Schema) and SARIF 2.1.0 output
- Content-anchored baselines that survive unrelated edits
- Inline `agentdoctor-disable` suppression
- Zero runtime dependencies; no network calls; credential files are never opened
