# Running agentdoctor in CI

## GitHub Actions, as code scanning annotations

Findings appear inline on the pull request diff.

```yaml
name: agentdoctor

on: [pull_request]

permissions:
  contents: read
  security-events: write

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }

      # continue-on-error so the SARIF still uploads when findings exist;
      # the gate job below is what actually fails the build.
      - run: npx @jqntn/agentdoctor --no-user --sarif > agentdoctor.sarif
        continue-on-error: true

      - uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: agentdoctor.sarif

      - name: Fail on errors
        run: npx @jqntn/agentdoctor --no-user --quiet
```

`--no-user` matters in CI: there is no `~/.claude` on a runner, and scanning it locally would
report findings a reviewer cannot act on.

## Any other CI

```sh
npx @jqntn/agentdoctor --no-user --json > agentdoctor.json   # exit 1 if errors exist
npx @jqntn/agentdoctor --no-user --max-warnings 0            # also fail on warnings
```

Exit codes are the contract:

| Code | Meaning |
|---|---|
| 0 | No errors (and warnings within `--max-warnings`) |
| 1 | At least one error, or too many warnings |
| 2 | Bad usage: unknown flag, missing path, unreadable baseline |

## Adopting on a repo that already has findings

Fail on new problems without having to fix the backlog first:

```sh
# once, on a green-ish commit
npx @jqntn/agentdoctor --no-user --write-baseline .agentdoctor-baseline.json
git add .agentdoctor-baseline.json

# in CI, from then on
npx @jqntn/agentdoctor --no-user --baseline .agentdoctor-baseline.json
```

Baseline entries are fingerprints of `rule id + file + config path`, so moving a rule within a
file keeps it suppressed, while adding a genuinely new one does not.

Shrink the baseline as you fix things:

```sh
npx @jqntn/agentdoctor --no-user --write-baseline .agentdoctor-baseline.json
```

## Enforcing one standard across many repos

Commit the same `agentdoctor.policy.json` to every repo, or fetch it from a central location in
CI, and the policy rules hold each repo to it:

```yaml
      - run: curl -sSf https://internal.example.com/agentdoctor.policy.json -o agentdoctor.policy.json
      - run: npx @jqntn/agentdoctor --no-user --quiet
```

The policy rules activate on the presence of the file — nothing else to configure.
