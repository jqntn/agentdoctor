/**
 * Rules about config that is legal and safe but will cause avoidable confusion,
 * leakage between machines, or silent drift between team members.
 */
export const hygieneRules = [
  {
    id: 'hygiene/local-settings-not-ignored',
    category: 'hygiene',
    severity: 'error',
    title: 'Local settings file is not gitignored',
    help: 'Add ".claude/settings.local.json" to .gitignore. That file is where personal overrides and machine-specific paths go, and committing it pushes your permissions onto everyone else.',
    check({ workspace, report }) {
      const local = workspace.files.find((f) => f.kind === 'settings' && f.scope === 'local');
      if (!local || !workspace.isGitRepo) return;
      const ignore = workspace.gitignore ?? '';
      const ignored = ignore
        .split(/\r?\n/)
        .map((line) => line.trim())
        .some((line) => (
          line === '.claude/settings.local.json'
          || line === '**/settings.local.json'
          || line === 'settings.local.json'
          || line === '.claude/'
          || line === '.claude'
          || line === '*.local.json'
        ));
      if (ignored) return;
      report({
        file: local,
        line: 1,
        message: '.claude/settings.local.json exists but is not covered by .gitignore, so personal overrides will be committed.',
      });
    },
  },

  {
    id: 'hygiene/empty-config',
    category: 'hygiene',
    severity: 'info',
    title: 'Config file has no effective content',
    help: 'Delete it, or fill it in. An empty file reads as "configured" to the next person who opens the repo.',
    check({ files, report }) {
      for (const file of files) {
        if (file.parseError) continue;
        if (file.kind === 'settings' || file.kind === 'mcp' || file.kind === 'keybindings') {
          if (file.data && typeof file.data === 'object' && Object.keys(file.data).length > 0) continue;
          report({ file, line: 1, message: `${file.display} is empty and has no effect.` });
          continue;
        }
        if (file.kind === 'memory' && file.text.trim() === '') {
          report({ file, line: 1, message: `${file.display} is empty.` });
        }
      }
    },
  },

  {
    id: 'hygiene/skill-body-empty',
    category: 'hygiene',
    severity: 'warning',
    title: 'Skill has frontmatter but no instructions',
    help: 'The body is what the model actually follows once the skill loads. Frontmatter alone advertises a capability that does nothing.',
    check({ files, report }) {
      for (const file of files) {
        if (file.kind !== 'skill' || !file.frontmatter) continue;
        if ((file.body ?? '').trim().length >= 40) continue;
        report({
          file,
          line: (file.frontmatterLines ?? 0) + 1,
          message: `Skill "${file.frontmatter.name ?? file.display}" has an empty body, so loading it adds nothing.`,
        });
      }
    },
  },

  {
    id: 'hygiene/agent-body-empty',
    category: 'hygiene',
    severity: 'warning',
    title: 'Subagent has no system prompt',
    help: 'The body of an agent file is its system prompt. Without one the subagent behaves like a default agent with a narrower toolset.',
    check({ files, report }) {
      for (const file of files) {
        if (file.kind !== 'agent' || !file.frontmatter) continue;
        if ((file.body ?? '').trim().length >= 40) continue;
        report({
          file,
          line: (file.frontmatterLines ?? 0) + 1,
          message: `Subagent "${file.frontmatter.name ?? file.display}" has an empty body, so it has no instructions of its own.`,
        });
      }
    },
  },

  {
    id: 'hygiene/no-project-memory',
    category: 'hygiene',
    severity: 'info',
    title: 'No project memory file',
    help: 'A short CLAUDE.md covering build/test commands and project conventions removes the same handful of questions from every session.',
    check({ workspace, report }) {
      if (!workspace.isGitRepo) return;
      const hasProjectMemory = workspace.files.some((f) => f.kind === 'memory' && f.scope !== 'user');
      if (hasProjectMemory) return;
      report({
        file: { path: workspace.root, display: '.' },
        line: 1,
        message: 'This repo has no CLAUDE.md, so every session starts without project conventions.',
      });
    },
  },

  {
    id: 'hygiene/absolute-home-path',
    category: 'hygiene',
    severity: 'warning',
    title: 'Committed config contains a machine-specific path',
    help: 'Use $CLAUDE_PROJECT_DIR or a relative path so the config works on every machine. Hardcoded home directories break for every other contributor.',
    check({ files, report }) {
      const pattern = /(\/(?:home|Users)\/[A-Za-z0-9._-]+|[A-Z]:\\Users\\[A-Za-z0-9._-]+)/;
      for (const file of files) {
        if (file.scope !== 'project') continue;
        if (file.kind !== 'settings' && file.kind !== 'mcp') continue;
        file.text.split(/\r?\n/).forEach((line, index) => {
          const match = pattern.exec(line);
          if (!match) return;
          report({
            file,
            line: index + 1,
            column: match.index + 1,
            snippet: match[1],
            message: `Committed config hardcodes "${match[1]}", which only exists on one machine.`,
          });
        });
      }
    },
  },

  {
    id: 'hygiene/settings-scope-conflict',
    category: 'hygiene',
    severity: 'info',
    title: 'Local settings silently override project settings',
    help: 'Not a bug, but worth knowing: this key differs between the committed project config and your local override, so your session behaves differently from your teammates.',
    check({ files, report, helpers }) {
      const project = files.find((f) => f.kind === 'settings' && f.scope === 'project' && f.data);
      const local = files.find((f) => f.kind === 'settings' && f.scope === 'local' && f.data);
      if (!project || !local) return;
      for (const key of Object.keys(local.data)) {
        if (!(key in project.data)) continue;
        const same = JSON.stringify(local.data[key]) === JSON.stringify(project.data[key]);
        if (same) continue;
        const position = helpers.at(local, key);
        report({
          file: local,
          line: position.line,
          column: position.column,
          configPath: key,
          message: `"${key}" is set in both project and local settings; your local value wins and your teammates get the other one.`,
        });
      }
    },
  },

  {
    id: 'hygiene/keybindings-duplicate',
    category: 'hygiene',
    severity: 'warning',
    title: 'Two actions bound to the same key',
    help: 'One of the two bindings will not fire. Pick a different chord for the loser.',
    check({ files, report, helpers }) {
      for (const file of files) {
        if (file.kind !== 'keybindings' || !file.data) continue;
        const bindings = Array.isArray(file.data) ? file.data : file.data.bindings;
        if (!Array.isArray(bindings)) continue;
        const seen = new Map();
        bindings.forEach((binding, index) => {
          const key = binding?.key ?? binding?.keys;
          if (typeof key !== 'string') return;
          const normalized = key.toLowerCase().replace(/\s+/g, '');
          if (seen.has(normalized)) {
            const configPath = Array.isArray(file.data) ? `[${index}]` : `bindings[${index}]`;
            const position = helpers.at(file, configPath);
            report({
              file,
              line: position.line,
              column: position.column,
              configPath,
              snippet: key,
              message: `"${key}" is bound twice (first at index ${seen.get(normalized)}).`,
            });
            return;
          }
          seen.set(normalized, index);
        });
      }
    },
  },
];
