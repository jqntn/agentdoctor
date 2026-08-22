## What

<!-- One paragraph. Link the issue if there is one. -->

## Checklist

- [ ] `npm test` is green
- [ ] `node bin/agentdoctor.js .` still exits 0 (self-audit)
- [ ] No new dependencies (hard invariant — PRs adding any are declined)
- [ ] New/changed rules: firing test + non-firing test added, `docs/rules.md` regenerated
      (`node tools/gen-docs.mjs`), README counts updated
- [ ] Findings introduced by this change never echo an unredacted secret
