# Contributing

## Adding a rule

A rule is a plain object in one of the `src/rules/*.js` category files:

```js
{
  id: 'security/my-new-rule',        // prefix must equal the category
  category: 'security',
  severity: 'error' | 'warning' | 'info',
  title: 'One line, shown in --list-rules',
  help: 'Why it matters and what to do instead. Shown under every finding.',
  check({ files, report, helpers, workspace }) {
    // call report({ file, line, column?, configPath?, snippet?, message }) per finding
  },
}
```

Three requirements, all enforced by the test suite:

1. **Every rule has a test.** `test/rules-coverage.test.js` fails if a rule id appears in no
   test file. Add at least one positive case (it fires) and one negative case (it stays quiet
   on legitimate config).
2. **No false positives on the clean fixture.** `test/fixtures/clean` is a well-configured
   project and must produce zero findings. If your rule fires there, the rule is wrong, not
   the fixture.
3. **Findings must be anchored.** Prefer `snippet` (the offending value) over `configPath`
   over nothing — baselines key off it, and a value-anchored finding survives file edits.

Then regenerate the rule reference:

```sh
node tools/gen-docs.mjs
```

## Commit messages

[Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/), validated in CI
and by an optional local hook:

```
type(optional-scope): description

optional body

optional footer
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`,
`revert`. Scopes are the area touched: `rules`, `engine`, `parse`, `report`, `adopt`, `site`,
`plugin`, `docs`, `deps`.

Rules the validator enforces: lowercase description, no trailing period, subject under 72
characters, a blank line before the body, and `!` in the subject whenever there is a
`BREAKING CHANGE:` footer.

```sh
node tools/check-commits.mjs --install-hook   # validate as you commit (recommended)
node tools/check-commits.mjs HEAD             # validate the whole history
node tools/check-commits.mjs origin/main..HEAD
```

Good: `fix(rules): stop flagging group-writable hook scripts in clones`
Bad: `Fixed a bug.`

## Ground rules

- **Zero dependencies stays zero.** This is a security tool; its own supply chain is part of
  the product. PRs adding a dependency will be declined regardless of how nice the dependency is.
- **Never read credential files.** Anything that widens what the tool opens needs a very good
  reason and an explicit test proving contents can't leak into output.
- **False positives are bugs**, and are treated as more severe than false negatives. A linter
  that cries wolf gets uninstalled, at which point it catches nothing at all.
- Tests: `npm test`. No build step, no transpiler — the source is what runs.
