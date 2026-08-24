# Changelog

## 0.1.5

No change to the rules, CLI or output. The packaged tarball is identical to 0.1.4 apart from the
version string; everything below is on the website, which deploys from `main` and has been live
since it was pushed. The release exists so the tag, the npm version and the plugin manifest keep
agreeing with each other.

- `fix(site)`: the copy button on the landing page's terminal demo copied nothing. It read from
  the element it was appended to rather than the `<code>` inside it, so the one snippet a visitor
  is most likely to try was the one that silently failed. It also scrolled away with the code
  block on narrow screens; it is now pinned to the frame.
- `style(site)`: the two footer badges are stacked at a matched width instead of sitting side by
  side at whatever intrinsic size each provider's image happened to be.
- `docs(site)`: the about section no longer opens on a rule count.

## 0.1.4

- `fix(rules)`: 14 real settings keys were reported as unrecognised, including
  `enabledPlugins` and `extraKnownMarketplaces` - which Claude Code writes
  itself, so **every user with a plugin installed** saw a bogus finding they
  could neither act on nor silence. Also added were `availableModels`,
  `modelOverrides`, `fallbackModel`, `effortLevel`, `useAutoModeDuringPlan`,
  `allowManagedPermissionRulesOnly`, `disableClaudeAiConnectors`,
  `isolatePeerMachines`, `remoteControlAtStartup`, `requiredMinimumVersion`,
  `syncClaudeAiSkills` and `crossSessionInbound`.
- `docs`: the README now has an Install section with runnable commands. The
  plugin install was previously only present inside a `#` comment, which a
  registry's documentation check flagged and which a reader could not copy.
- The self-hosted marketplace is renamed `jqntn`, so installs read
  `agentdoctor@jqntn` rather than `agentdoctor@agentdoctor`.

## 0.1.3

- `fix(report)`: the summary line mixed two separator styles, reading
  `Summary  Grade F  3 errors  - 72 rules in 41ms`. Run metadata is now
  parenthesised: `Summary  Grade F  3 errors, 1 warning  (72 rules, 41ms)`. The
  skipped-files line used a hyphen where a colon belonged and printed `file(s)`
  instead of pluralising.
- `refactor(plugin)`: the Claude Code plugin moved to `plugin/`, containing only
  its manifest and the canonical skill. The marketplace entry previously pointed
  at the repository root, so installing the plugin fetched 2.1 MB across 107
  files - including test fixtures full of deliberately hostile config - where it
  needs 40 KB in 4. `--init-skill` copies from the new path; the byte-identity
  guarantee between the marketplace and CLI routes is unchanged.
- `docs`: the README and docs now lead on the rule-quality bar rather than a rule
  count, which drifts with every rule and advertises the wrong thing. A privacy
  page was added, stating what the tool reads, what it refuses to read, and that
  it makes no network calls. Trailing comments in code blocks are aligned.

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
