# Baselines: adopting agentdoctor on an existing repo

An established project will have findings on day one. Fixing all of them before turning on CI
enforcement is how adoption dies. A baseline records the current findings as accepted, so CI
fails only on **new** problems.

## Workflow

```sh
# once, reviewed and committed like any other change
agentdoctor --no-user --write-baseline .agentdoctor-baseline.json
git add .agentdoctor-baseline.json

# in CI, from then on
agentdoctor --no-user --baseline .agentdoctor-baseline.json
```

Fix things over time, then shrink the baseline by regenerating it:

```sh
agentdoctor --no-user --write-baseline .agentdoctor-baseline.json
```

The file is plain JSON — a list of finding fingerprints — so shrinkage is visible in diffs and
code review. A growing baseline is a red flag a reviewer can see.

## Why baselines survive edits

A baseline that breaks when someone inserts an unrelated line is a baseline people stop
trusting. agentdoctor anchors each fingerprint to the most stable identity available, in order:

1. **The offending value itself** (e.g. the text of the permission rule). Permission rules
   live in arrays, so a positional anchor like `permissions.allow[0]` changes meaning the
   moment anyone inserts a rule above it. The rule text does not.
2. **The config path**, for structural findings with no single value (an empty deny list, a
   missing required key).
3. **A hash of the finding's message**, for whole-file findings.

Line numbers are never part of the identity. Concretely:

- Insert a new (bad) rule anywhere in the allow list → exactly one new finding surfaces.
- Add unrelated keys above the offending line → nothing resurfaces.
- Fix a finding → its fingerprint disappears on the next `--write-baseline`.

Each of these is a regression test in the suite (`test/baseline.test.js`).

## Baselines vs inline suppression

| | Baseline | `agentdoctor-disable` comment |
|---|---|---|
| Scope | Whole project, one file | One rule, one file |
| Visibility | A count in every summary + a diffable JSON file | A comment next to the code |
| Use for | The adoption backlog | A deliberate, permanent exception |

Rule of thumb: baselines are for *debt*, inline suppressions are for *decisions*. If you find
yourself regenerating the baseline to absorb new findings, you have turned the fire alarm off.
