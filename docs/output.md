# Output formats

Three formats, one flag apart. The terminal report is for humans; `--json` is the stable
contract for scripts and agents; `--sarif` is for CI annotation.

## `--json`

```sh
agentdoctor --no-user --json
```

```json
{
  "version": 1,
  "tool": "agentdoctor",
  "toolVersion": "0.1.0",
  "root": "/work/api",
  "scannedFiles": [
    { "path": ".claude/settings.json", "kind": "settings", "scope": "project", "bytes": 512 }
  ],
  "skippedFiles": ["/home/u/.claude/.credentials.json"],
  "rulesRun": ["correctness/invalid-json", "..."],
  "suppressed": 0,
  "grade": "D",
  "summary": { "error": 2, "warning": 1, "info": 0 },
  "findings": [
    {
      "ruleId": "security/unrestricted-bash",
      "severity": "error",
      "category": "security",
      "message": "\"Bash(*)\" auto-approves every shell command, including ones you have not seen.",
      "help": "Replace the wildcard with the specific commands you actually want unattended...",
      "file": ".claude/settings.json",
      "absolutePath": "/work/api/.claude/settings.json",
      "line": 4,
      "column": 7,
      "configPath": "permissions.allow[0]",
      "snippet": "Bash(*)"
    }
  ]
}
```

Field notes:

- `grade` is the health grade, computed from the post-filter findings: `A+` zero findings,
  `A` info only, `B` 1-2 warnings, `C` 3+ warnings, `D` 1-2 errors, `F` 3+ errors.
- `version` is the format version. Additions are the only change ever made to shape `1`;
  removals or renames would bump it.
- `findings` is sorted: severity first (`error` > `warning` > `info`), then file, then line.
- `column`, `configPath`, `snippet`, and `help` are `null` when not applicable.
- `snippet` never contains an unredacted secret — credential-shaped values are truncated to
  a prefix/suffix with `(redacted)`.
- `file` is display-relative (repo-relative, or `~/`-prefixed for user scope);
  `absolutePath` is absolute.
- A machine-readable JSON Schema ships in the package: `schemas/report.schema.json`.

`--list-rules --json` emits the catalogue as `[{ id, severity, title }]`.

## `--sarif`

SARIF 2.1.0, consumable by GitHub code scanning and any SARIF-aware tool. Findings appear as
inline annotations on the PR diff.

```sh
agentdoctor --no-user --sarif > agentdoctor.sarif
```

Properties worth knowing:

- Severities map `error → error`, `warning → warning`, `info → note`.
- `partialFingerprints.agentdoctorFingerprint` gives stable finding identity across runs, so
  GitHub tracks findings as "existing" rather than re-announcing them per commit.
- Artifact URIs are repo-relative. Files outside the repo (user scope) are shortened to a
  suffix rather than leaking an absolute home path into CI logs.
- Every rule referenced by a result includes its full description and help text in
  `tool.driver.rules`, so the annotation is self-explanatory in the GitHub UI.

Wiring for GitHub Actions is in the [CI guide](ci.md).

## Terminal report

The default. Grouped by file so you fix one file at a time; within a file, sorted by severity
then line. Color respects `NO_COLOR`, `FORCE_COLOR`, and TTY detection, and degrades to plain
text in pipes. Every finding ends with its rule id so `--explain` is always one copy-paste
away.

The summary line always includes: the grade, counts by severity, rules run, elapsed time,
suppressed findings (baseline + inline), and how many credential files were skipped unread.

## Exit codes (all formats)

| Code | Meaning |
|---|---|
| 0 | No errors; warnings within `--max-warnings` if set |
| 1 | At least one error, or warnings over the limit |
| 2 | Usage error |
