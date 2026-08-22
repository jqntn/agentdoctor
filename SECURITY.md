# Security policy

## What agentdoctor does and does not do

- **Reads** agent configuration files in the audited project and (unless `--no-user`) in
  `~/.claude`.
- **Never opens** credential files: `.credentials.json`, `credentials.json`, `.netrc`,
  `id_rsa`, `id_ed25519`. They are excluded by path before any read, and the test suite
  asserts a value planted in a credentials file cannot reach any output.
- **Never makes network calls.** No telemetry, no update checks. The run is local file reads.
- **Never writes** to your config. The only file it writes is a baseline, only on
  `--write-baseline`.
- **Redacts secrets** it detects: findings show a short prefix/suffix and `(redacted)`, in
  every output format, so reports are safe to put in logs and CI artifacts.
- **Has zero dependencies**, so `npm install agentdoctor` adds exactly one package to your
  tree. What you audit is what we ship.

## Reporting a vulnerability

If you find a way to make agentdoctor read a file it promises not to read, leak an unredacted
secret into output, execute anything, or reach the network — that is a vulnerability even if
it requires a malicious config file, since auditing untrusted repos is a supported use case.

Report it privately via GitHub Security Advisories ("Report a vulnerability" on the Security
tab) rather than a public issue. You will get an acknowledgment within 72 hours and a fix or a
timeline within 14 days. Please include the config that triggers it.

False positives and ordinary bugs are welcome as public issues.
