# Changelog

## 0.1.2

No change to the rules, CLI or output. The published tarball differs from 0.1.1 by a single
character, and only in the README.

- `fix(docs)`: escape the `>` in the Node badge's `alt` text. GitHub's markdown parser ends a
  raw HTML tag at the first `>` even inside a quoted attribute, so the badge row rendered as a
  broken image followed by a literal URL. npm's renderer already handled it correctly, so this
  was only ever visible on GitHub.

Changes outside the package, already live and not part of this tarball:

- `fix(site)`: mobile layout and light-mode contrast. Dark-on-dark text in the hero CTA and the
  demo terminal, horizontal overflow on every docs page (`1fr` is `minmax(auto, 1fr)` and will
  not shrink below its widest child), and a header that collided with its nav below 640px.
- `fix(ci)`: removed a stray file whose name broke Windows checkout, and stopped deriving
  filesystem paths from a file URL's pathname. Guards added for both.
- `feat(assets)`: the launch gallery is generated from measured text metrics, so a card whose
  text would clip fails the build instead of shipping.

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
