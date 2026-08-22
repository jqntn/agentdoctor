# Changelog

## 0.1.0

First release.

- 72 rules across security, correctness, cost, hygiene and team policy — all free, MIT
- Team policy enforcement via a committed `agentdoctor.policy.json`
- Terminal, JSON and SARIF 2.1.0 output
- Baselines for adopting the tool on an existing repository, anchored to content
  rather than line numbers so unrelated edits never invalidate them
- Inline `agentdoctor-disable` suppression
- Zero runtime dependencies; no network calls; credential files are never opened
