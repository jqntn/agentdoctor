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
      - uses: jqntn/agentdoctor@v0
```

The action uploads the SARIF to code scanning, prints the findings to the log, and fails the
job on errors. It always passes `--no-user`, because a runner has no `~/.claude`. It needs
Node 20 or later on the `PATH`. GitHub-hosted runners include it. If the upload fails, for
example on a pull request from a fork, the log shows a warning. The audit still runs and fails
the job on errors.

| Input | Default | Meaning |
|---|---|---|
| `args` | `''` | Extra flags, for example `--max-warnings 0` or `--baseline .agentdoctor-baseline.json` |
| `upload-sarif` | `true` | Set to `false` when code scanning is not available, for example on a private repo without GitHub Advanced Security |

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
