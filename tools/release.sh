#!/usr/bin/env bash
#
# One-command release. Does every remaining step: substitutes the placeholder
# URLs, fills the identity fields npm needs, verifies, tags, pushes, publishes.
#
#   ./tools/release.sh [github-user] [author-name] [author-email]
#
# With no arguments it uses the authenticated `gh` account and the maintainer
# identity below.
#
# Requires you to be authenticated first (these are the steps that need a
# person, and the script checks them up front rather than failing halfway):
#
#   gh auth login
#   npm login
#
# Everything before the "outward-facing" section is local and reversible.

set -euo pipefail

# The GitHub username defaults to whoever `gh` is authenticated as, so there is
# nothing to guess and no way to publish under a mistyped account.
GH_USER="${1:-}"
AUTHOR_NAME="${2:-Julien QUENTIN}"
AUTHOR_EMAIL="${3:-jqntn88@gmail.com}"
REPO_NAME="agentdoctor"

die() { printf '\033[31merror\033[0m %s\n' "$*" >&2; exit 1; }
step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
ok() { printf '\033[32m  ok\033[0m %s\n' "$*"; }

[ -f package.json ] || die "run this from the repository root"

# ---------------------------------------------------------------------------
# 0. Preflight: fail now, not halfway through
# ---------------------------------------------------------------------------
step "Preflight"
command -v node >/dev/null || die "node is required"
command -v gh   >/dev/null || die "gh is required: https://cli.github.com"
gh auth status >/dev/null 2>&1 || die "not logged in to GitHub. Run: gh auth login"
GH_LOGIN="$(gh api user --jq .login)"
ok "GitHub authenticated as ${GH_LOGIN}"
[ -n "$GH_USER" ] || GH_USER="$GH_LOGIN"
if [ "$GH_USER" != "$GH_LOGIN" ]; then
  printf '  note: publishing under "%s" while authenticated as "%s"\n' "$GH_USER" "$GH_LOGIN"
fi
NPM_USER="$(npm whoami 2>/dev/null || true)"
[ -n "$NPM_USER" ] || die "not logged in to npm. Run: npm login"
ok "npm authenticated as $NPM_USER"

PKG_VERSION="$(node -p "require('./package.json').version")"
if [ "$(curl -s -o /dev/null -w '%{http_code}' "https://registry.npmjs.org/${REPO_NAME}")" != "404" ]; then
  die "the npm name '${REPO_NAME}' is taken. Pick another and update REPO_NAME plus package.json name."
fi
ok "npm name '${REPO_NAME}' is available"

if [ -n "$(git status --porcelain)" ]; then
  die "working tree is dirty. Commit or stash first."
fi
ok "working tree clean"

# Checked here rather than at the commit step: failing after the substitution
# has already rewritten files is the worst place to stop.
git var GIT_AUTHOR_IDENT >/dev/null 2>&1 \
  || die "git has no author identity. Run: git config --global user.name 'You' && git config --global user.email 'you@example.com'"
ok "git identity $(git var GIT_AUTHOR_IDENT | sed 's/ [0-9].*//')"

# ---------------------------------------------------------------------------
# 1. Substitute placeholder URLs
# ---------------------------------------------------------------------------
step "Setting project URLs to github.com/${GH_USER}/${REPO_NAME}"
FILES="$(git grep -l jqntn || true)"
[ -n "$FILES" ] && echo "$FILES" | xargs sed -i "s/jqntn/${GH_USER}/g"
! git grep -q jqntn || die "jqntn survived the substitution"
ok "$(echo "$FILES" | wc -l) files updated"

# ---------------------------------------------------------------------------
# 2. Identity fields npm needs (author, repository, homepage, bugs)
# ---------------------------------------------------------------------------
step "Filling package.json identity fields"
GH_USER="$GH_USER" REPO_NAME="$REPO_NAME" AUTHOR_NAME="$AUTHOR_NAME" AUTHOR_EMAIL="$AUTHOR_EMAIL" node - <<'NODE'
const fs = require('node:fs');
const { GH_USER, REPO_NAME, AUTHOR_NAME, AUTHOR_EMAIL } = process.env;
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

// Ordered so the manifest reads sensibly in the npm sidebar.
const merged = {
  name: pkg.name, version: pkg.version, description: pkg.description,
  keywords: pkg.keywords, license: pkg.license,
  author: AUTHOR_EMAIL ? `${AUTHOR_NAME} <${AUTHOR_EMAIL}>` : AUTHOR_NAME,
  homepage: `https://${GH_USER}.github.io/${REPO_NAME}/`,
  repository: { type: 'git', url: `git+https://github.com/${GH_USER}/${REPO_NAME}.git` },
  bugs: { url: `https://github.com/${GH_USER}/${REPO_NAME}/issues` },
  ...pkg,
};
fs.writeFileSync('package.json', JSON.stringify(merged, null, 2) + '\n');
console.log(`  author:     ${merged.author}`);
console.log(`  homepage:   ${merged.homepage}`);
console.log(`  repository: ${merged.repository.url}`);
NODE

# ---------------------------------------------------------------------------
# 3. Absolute image URLs so the logo renders on npmjs.com
#
# npm rewrites relative image paths only when `repository` is set, and its
# sanitizer drops <picture>/<source>. Absolute raw URLs plus a plain <img>
# fallback render correctly on both npm and GitHub.
# ---------------------------------------------------------------------------
step "Making README image URLs absolute (for npmjs.com)"
RAW="https://raw.githubusercontent.com/${GH_USER}/${REPO_NAME}/main"
sed -i "s|srcset=\"assets/|srcset=\"${RAW}/assets/|g; s|src=\"assets/|src=\"${RAW}/assets/|g" README.md
grep -q "raw.githubusercontent" README.md && ok "logo URLs absolute"

# ---------------------------------------------------------------------------
# 4. Verify everything, with the URLs now real
# ---------------------------------------------------------------------------
step "Verifying"
npm test >/dev/null 2>&1 && ok "test suite green" || die "tests failed - nothing was published"
node bin/agentdoctor.js . --no-user --quiet && ok "self-audit clean (grade A+)" || die "the tool does not pass its own audit"
node tools/gen-docs.mjs >/dev/null && ok "rule reference regenerated"
node tools/build-site.mjs >/dev/null && ok "docs site builds"
npm pack --dry-run >/dev/null 2>&1 && ok "package tarball valid"
node tools/check-commits.mjs HEAD >/dev/null && ok "commit messages conform" || die "commit messages do not follow Conventional Commits"

git add -A
git commit -q -m "chore(release): set project URLs and package metadata"
ok "committed"

# ---------------------------------------------------------------------------
# 5. Outward-facing, irreversible from here
# ---------------------------------------------------------------------------
step "Publishing (irreversible)"
printf '  About to: create a public GitHub repo, push, tag v%s, publish to npm.\n' "$PKG_VERSION"
printf '  npm versions cannot be re-published once taken. Continue? [y/N] '
read -r REPLY
case "$REPLY" in [yY]*) ;; *) echo "  Aborted. All local work is committed; re-run when ready."; exit 0 ;; esac

if gh repo view "${GH_USER}/${REPO_NAME}" >/dev/null 2>&1; then
  ok "repo already exists; pushing to it"
  git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/${GH_USER}/${REPO_NAME}.git"
  git push -u origin main
else
  gh repo create "${REPO_NAME}" --public --source . --remote origin --push \
    --description "Lint and grade your AI coding-agent configuration: permissions, hooks, MCP servers, skills, memory files. 72 rules, zero dependencies, MIT."
  ok "repo created and pushed"
fi

# Topics drive GitHub search discovery.
gh repo edit "${GH_USER}/${REPO_NAME}" \
  --homepage "https://${GH_USER}.github.io/${REPO_NAME}/" \
  --add-topic claude-code --add-topic ai-agents --add-topic linter \
  --add-topic mcp --add-topic developer-tools --add-topic cli \
  --add-topic static-analysis --add-topic agents-md >/dev/null 2>&1 && ok "topics and homepage set"

git tag -f "v${PKG_VERSION}" -m "agentdoctor v${PKG_VERSION}"
git push -f origin "v${PKG_VERSION}"
ok "tagged v${PKG_VERSION}"

npm publish --access public
ok "published to npm"

gh release create "v${PKG_VERSION}" --title "agentdoctor v${PKG_VERSION}" --notes-file - <<RELEASE
First public release.

\`\`\`sh
npx @jqntn/agentdoctor
\`\`\`

A zero-dependency linter for AI coding-agent configuration — permissions, hooks, MCP servers,
skills, subagents and memory files. Agent config has no feedback loop: a misspelled hook event
never fires, a deny rule naming a nonexistent tool blocks nothing, \`Bash(*)\` auto-approves
every command. Nothing errors. This finds all of it, with line numbers and fixes.

**72 rules** — 22 security, 26 correctness, 8 cost, 8 hygiene, 8 team policy.

- Health grade (A+ to F) on every audit; \`--share\` for a safe score card, \`--badge\` for the README
- One-command adoption: \`--init-ci\` (GitHub Actions + SARIF PR annotations), \`--init-skill\`
  (Claude Code), \`--init-agents\` (AGENTS.md, for Codex/Cursor/Gemini CLI)
- Terminal, JSON (with JSON Schema) and SARIF 2.1.0 output
- Content-anchored baselines that survive unrelated edits
- Zero dependencies, no network calls, never opens credential files

Docs: https://${GH_USER}.github.io/${REPO_NAME}/
RELEASE
ok "GitHub release created"

step "Done"
cat <<DONE
  npm:   https://www.npmjs.com/package/${REPO_NAME}
  repo:  https://github.com/${GH_USER}/${REPO_NAME}
  site:  https://${GH_USER}.github.io/${REPO_NAME}/   (enable: Settings > Pages > Source: GitHub Actions)

  Verify the published package from a clean directory:
    cd \$(mktemp -d) && npx ${REPO_NAME}@${PKG_VERSION} --version

  Then: Product Hunt and OpenHunts kits are in ~/agentdoctor-private/launch/
DONE
