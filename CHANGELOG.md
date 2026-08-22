# Changelog

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
