import {
  SETTINGS_KEYS, PERMISSION_KEYS, HOOK_EVENTS, MATCHER_EVENTS,
  TOOL_NAMES, MODEL_ALIASES,
} from '../constants.js';
import { basename, dirname } from 'node:path';

/** Levenshtein distance, capped for speed — only used for typo suggestions. */
export function editDistance(a, b, max = 3) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      best = Math.min(best, row[j]);
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length];
}

/** Closest known name, or null when nothing is plausibly a typo of `name`. */
export function suggest(name, candidates, max = 3) {
  let best = null;
  let bestScore = max + 1;
  for (const candidate of candidates) {
    const score = editDistance(name.toLowerCase(), candidate.toLowerCase(), max);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  // A one-character difference on a short key is a typo; a large distance is
  // just an unknown key and should not produce a misleading suggestion.
  const threshold = name.length <= 6 ? 2 : 3;
  return bestScore <= threshold ? best : null;
}

const slugify = (value) => String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const correctnessRules = [
  {
    id: 'correctness/invalid-json',
    category: 'correctness',
    severity: 'error',
    title: 'Config file is not valid JSON',
    help: 'The harness cannot read this file, so every setting in it is silently ignored — including any permission rules you thought were protecting you.',
    check({ files, report }) {
      for (const file of files) {
        if (!file.parseError) continue;
        report({
          file,
          line: file.parseError.line,
          column: file.parseError.column,
          message: `${file.display} failed to parse: ${file.parseError.message}. The entire file is ignored.`,
        });
      }
    },
  },

  {
    id: 'correctness/unknown-settings-key',
    category: 'correctness',
    severity: 'warning',
    title: 'Unrecognised settings key',
    help: 'Unknown keys are ignored without warning, so a typo means the setting never applies.',
    check({ files, report, helpers }) {
      for (const file of files) {
        if (file.kind !== 'settings' || !file.data || typeof file.data !== 'object') continue;
        for (const key of Object.keys(file.data)) {
          if (SETTINGS_KEYS.has(key)) continue;
          const hint = suggest(key, SETTINGS_KEYS);
          const position = helpers.at(file, key);
          report({
            file,
            line: position.line,
            column: position.column,
            configPath: key,
            severity: hint ? 'warning' : 'info',
            message: hint
              ? `"${key}" is not a known setting. Did you mean "${hint}"?`
              : `"${key}" is not a setting agentdoctor recognises; it will be ignored unless a newer harness version added it.`,
          });
        }
      }
    },
  },

  {
    id: 'correctness/unknown-permission-key',
    category: 'correctness',
    severity: 'warning',
    title: 'Unrecognised key under permissions',
    help: `Valid keys are: ${[...PERMISSION_KEYS].join(', ')}.`,
    check({ files, report, helpers }) {
      for (const file of files) {
        if (file.kind !== 'settings') continue;
        const perms = file.data?.permissions;
        if (!perms || typeof perms !== 'object' || Array.isArray(perms)) continue;
        for (const key of Object.keys(perms)) {
          if (PERMISSION_KEYS.has(key)) continue;
          const hint = suggest(key, PERMISSION_KEYS);
          const position = helpers.at(file, `permissions.${key}`);
          report({
            file,
            line: position.line,
            column: position.column,
            configPath: `permissions.${key}`,
            message: hint
              ? `permissions.${key} is not valid. Did you mean "${hint}"?`
              : `permissions.${key} is not a recognised permission key and is ignored.`,
          });
        }
      }
    },
  },

  {
    id: 'correctness/permissions-wrong-type',
    category: 'correctness',
    severity: 'error',
    title: 'Permission bucket is not an array',
    help: 'allow, deny and ask must each be an array of rule strings. A string or object here means the rules never load.',
    check({ files, report, helpers }) {
      for (const file of files) {
        if (file.kind !== 'settings') continue;
        const perms = file.data?.permissions;
        if (!perms || typeof perms !== 'object') continue;
        for (const bucket of ['allow', 'deny', 'ask', 'additionalDirectories']) {
          const value = perms[bucket];
          if (value === undefined || Array.isArray(value)) continue;
          const position = helpers.at(file, `permissions.${bucket}`);
          report({
            file,
            line: position.line,
            column: position.column,
            configPath: `permissions.${bucket}`,
            message: `permissions.${bucket} must be an array, got ${describeType(value)}.`,
          });
        }
      }
    },
  },

  {
    id: 'correctness/permission-unknown-tool',
    category: 'correctness',
    severity: 'warning',
    title: 'Permission rule names an unknown tool',
    help: 'Tool names are case-sensitive. A rule naming a tool that does not exist never matches anything, so a deny rule written this way protects nothing.',
    check({ files, report, helpers }) {
      for (const file of files) {
        if (file.kind !== 'settings') continue;
        for (const bucket of ['allow', 'deny', 'ask']) {
          const rules = file.data?.permissions?.[bucket];
          if (!Array.isArray(rules)) continue;
          rules.forEach((rule, index) => {
            if (typeof rule !== 'string') return;
            const parsed = helpers.parsePermission(rule);
            const tool = parsed.tool;
            if (!tool) return;
            if (tool.startsWith('mcp__')) return;
            if (TOOL_NAMES.has(tool)) return;
            const hint = suggest(tool, TOOL_NAMES);
            const configPath = `permissions.${bucket}[${index}]`;
            const position = helpers.at(file, configPath);
            report({
              file,
              line: position.line,
              column: position.column,
              configPath,
              snippet: rule,
              severity: bucket === 'deny' ? 'error' : 'warning',
              message: hint
                ? `"${rule}" targets unknown tool "${tool}". Did you mean "${hint}"?${bucket === 'deny' ? ' This deny rule currently blocks nothing.' : ''}`
                : `"${rule}" targets unknown tool "${tool}", so the rule never matches.`,
            });
          });
        }
      }
    },
  },

  {
    id: 'correctness/permission-non-string',
    category: 'correctness',
    severity: 'error',
    title: 'Permission rule is not a string',
    help: 'Each entry must be a string like "Bash(npm test:*)".',
    check({ files, report, helpers }) {
      for (const file of files) {
        if (file.kind !== 'settings') continue;
        for (const bucket of ['allow', 'deny', 'ask']) {
          const rules = file.data?.permissions?.[bucket];
          if (!Array.isArray(rules)) continue;
          rules.forEach((rule, index) => {
            if (typeof rule === 'string') return;
            const configPath = `permissions.${bucket}[${index}]`;
            const position = helpers.at(file, configPath);
            report({
              file,
              line: position.line,
              column: position.column,
              configPath,
              message: `permissions.${bucket}[${index}] is ${describeType(rule)}, expected a rule string.`,
            });
          });
        }
      }
    },
  },

  {
    id: 'correctness/duplicate-permission',
    category: 'correctness',
    severity: 'info',
    title: 'Duplicate permission rule',
    help: 'Harmless, but usually a sign of a merge that went wrong or a rule that was meant to be edited rather than added.',
    check({ files, report, helpers }) {
      for (const file of files) {
        if (file.kind !== 'settings') continue;
        for (const bucket of ['allow', 'deny', 'ask']) {
          const rules = file.data?.permissions?.[bucket];
          if (!Array.isArray(rules)) continue;
          const seen = new Map();
          rules.forEach((rule, index) => {
            if (typeof rule !== 'string') return;
            const key = rule.trim();
            if (seen.has(key)) {
              const configPath = `permissions.${bucket}[${index}]`;
              const position = helpers.at(file, configPath);
              report({
                file,
                line: position.line,
                column: position.column,
                configPath,
                snippet: rule,
                message: `"${rule}" is listed twice in permissions.${bucket} (first at index ${seen.get(key)}).`,
              });
              return;
            }
            seen.set(key, index);
          });
        }
      }
    },
  },

  {
    id: 'correctness/allow-deny-conflict',
    category: 'correctness',
    severity: 'warning',
    title: 'Same rule in both allow and deny',
    help: 'Deny wins, so the allow entry is dead config. Remove it so the intent is unambiguous to the next reader.',
    check({ files, report, helpers }) {
      for (const file of files) {
        if (file.kind !== 'settings') continue;
        const perms = file.data?.permissions;
        const allow = Array.isArray(perms?.allow) ? perms.allow : [];
        const deny = Array.isArray(perms?.deny) ? perms.deny : [];
        if (!allow.length || !deny.length) continue;
        const denySet = new Set(deny.filter((r) => typeof r === 'string').map((r) => r.trim()));
        allow.forEach((rule, index) => {
          if (typeof rule !== 'string' || !denySet.has(rule.trim())) return;
          const configPath = `permissions.allow[${index}]`;
          const position = helpers.at(file, configPath);
          report({
            file,
            line: position.line,
            column: position.column,
            configPath,
            snippet: rule,
            message: `"${rule}" appears in both allow and deny; deny takes precedence, so the allow entry has no effect.`,
          });
        });
      }
    },
  },

  {
    id: 'correctness/unknown-hook-event',
    category: 'correctness',
    severity: 'error',
    title: 'Unknown hook event',
    help: `Valid events: ${[...HOOK_EVENTS].join(', ')}. Events are case-sensitive and a misspelled one never fires.`,
    check({ files, report, helpers }) {
      for (const file of files) {
        if (file.kind !== 'settings') continue;
        const hooks = file.data?.hooks;
        if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) continue;
        for (const event of Object.keys(hooks)) {
          if (HOOK_EVENTS.has(event)) continue;
          const hint = suggest(event, HOOK_EVENTS);
          const position = helpers.at(file, `hooks.${event}`);
          report({
            file,
            line: position.line,
            column: position.column,
            configPath: `hooks.${event}`,
            message: hint
              ? `"${event}" is not a hook event. Did you mean "${hint}"? As written, this hook never runs.`
              : `"${event}" is not a recognised hook event, so this hook never runs.`,
          });
        }
      }
    },
  },

  {
    id: 'correctness/hook-malformed',
    category: 'correctness',
    severity: 'error',
    title: 'Hook entry has the wrong shape',
    help: 'Each event maps to an array of { matcher, hooks: [{ type: "command", command: "..." }] }. A near-miss shape is dropped silently.',
    check({ files, report, helpers }) {
      for (const file of files) {
        if (file.kind !== 'settings') continue;
        const hooks = file.data?.hooks;
        if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) continue;
        for (const [event, matchers] of Object.entries(hooks)) {
          const eventPath = `hooks.${event}`;
          if (!Array.isArray(matchers)) {
            const position = helpers.at(file, eventPath);
            report({
              file,
              line: position.line,
              column: position.column,
              configPath: eventPath,
              message: `hooks.${event} must be an array of matcher objects, got ${describeType(matchers)}.`,
            });
            continue;
          }
          matchers.forEach((entry, matcherIndex) => {
            const entryPath = `${eventPath}[${matcherIndex}]`;
            if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
              const position = helpers.at(file, entryPath);
              report({
                file,
                line: position.line,
                column: position.column,
                configPath: entryPath,
                message: `${entryPath} must be an object, got ${describeType(entry)}.`,
              });
              return;
            }
            if (!Array.isArray(entry.hooks)) {
              const position = helpers.at(file, entryPath);
              report({
                file,
                line: position.line,
                column: position.column,
                configPath: entryPath,
                message: `${entryPath} is missing a "hooks" array, so nothing runs for this matcher.`,
              });
              return;
            }
            entry.hooks.forEach((hook, hookIndex) => {
              const hookPath = `${entryPath}.hooks[${hookIndex}]`;
              const position = helpers.at(file, hookPath);
              if (hook === null || typeof hook !== 'object' || Array.isArray(hook)) {
                report({
                  file, line: position.line, column: position.column, configPath: hookPath,
                  message: `${hookPath} must be an object with type and command.`,
                });
                return;
              }
              if (hook.type !== 'command') {
                report({
                  file, line: position.line, column: position.column, configPath: hookPath,
                  message: `${hookPath}.type is ${JSON.stringify(hook.type)}; only "command" is supported.`,
                });
              }
              if (typeof hook.command !== 'string' || hook.command.trim() === '') {
                report({
                  file, line: position.line, column: position.column, configPath: `${hookPath}.command`,
                  message: `${hookPath}.command is missing or empty.`,
                });
              }
              if (hook.timeout !== undefined && (typeof hook.timeout !== 'number' || hook.timeout <= 0)) {
                report({
                  file, line: position.line, column: position.column, configPath: `${hookPath}.timeout`,
                  severity: 'warning',
                  message: `${hookPath}.timeout must be a positive number of seconds.`,
                });
              }
            });
          });
        }
      }
    },
  },

  {
    id: 'correctness/hook-matcher-ignored',
    category: 'correctness',
    severity: 'info',
    title: 'Matcher set on an event that has no tool',
    help: `Only ${[...MATCHER_EVENTS].join(', ')} use a matcher. Elsewhere it is ignored, which can look like the hook is scoped when it is not.`,
    check({ files, report, helpers }) {
      for (const file of files) {
        if (file.kind !== 'settings') continue;
        const hooks = file.data?.hooks;
        if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) continue;
        for (const [event, matchers] of Object.entries(hooks)) {
          if (!Array.isArray(matchers)) continue;
          if (MATCHER_EVENTS.has(event) || !HOOK_EVENTS.has(event)) continue;
          matchers.forEach((entry, index) => {
            if (!entry || typeof entry.matcher !== 'string' || entry.matcher === '') return;
            const configPath = `hooks.${event}[${index}].matcher`;
            const position = helpers.at(file, configPath);
            report({
              file,
              line: position.line,
              column: position.column,
              configPath,
              message: `${event} has no associated tool, so matcher "${entry.matcher}" is ignored and the hook fires every time.`,
            });
          });
        }
      }
    },
  },

  {
    id: 'correctness/hook-matcher-invalid-regex',
    category: 'correctness',
    severity: 'error',
    title: 'Hook matcher is not a valid pattern',
    help: 'Matchers are treated as regular expressions. An invalid pattern means the hook silently never matches.',
    check({ files, report, helpers }) {
      for (const file of files) {
        if (file.kind !== 'settings') continue;
        const hooks = file.data?.hooks;
        if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) continue;
        for (const [event, matchers] of Object.entries(hooks)) {
          if (!Array.isArray(matchers)) continue;
          matchers.forEach((entry, index) => {
            const matcher = entry?.matcher;
            if (typeof matcher !== 'string' || matcher === '' || matcher === '*') return;
            try {
              new RegExp(matcher);
            } catch (error) {
              const configPath = `hooks.${event}[${index}].matcher`;
              const position = helpers.at(file, configPath);
              report({
                file,
                line: position.line,
                column: position.column,
                configPath,
                snippet: matcher,
                message: `Matcher "${matcher}" is not a valid regular expression: ${error.message}.`,
              });
            }
          });
        }
      }
    },
  },

  {
    id: 'correctness/hook-matcher-unknown-tool',
    category: 'correctness',
    severity: 'warning',
    title: 'Hook matcher names no existing tool',
    help: 'Check the spelling and casing of the tool name. A matcher that matches nothing is a hook that never fires.',
    check({ files, report, helpers }) {
      for (const file of files) {
        if (file.kind !== 'settings') continue;
        const hooks = file.data?.hooks;
        if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) continue;
        for (const [event, matchers] of Object.entries(hooks)) {
          if (!Array.isArray(matchers) || !MATCHER_EVENTS.has(event)) continue;
          matchers.forEach((entry, index) => {
            const matcher = entry?.matcher;
            if (typeof matcher !== 'string' || matcher === '' || matcher === '*') return;
            // '|' is alternation between tool names, which we handle below; any
            // other regex metacharacter means we cannot enumerate the matches.
            if (/[\\^$.[\]()?+{}]/.test(matcher)) return;
            const names = matcher.split('|').map((n) => n.trim()).filter(Boolean);
            const unknown = names.filter((n) => !TOOL_NAMES.has(n) && !n.startsWith('mcp__'));
            if (unknown.length === 0) return;
            const hint = suggest(unknown[0], TOOL_NAMES);
            const configPath = `hooks.${event}[${index}].matcher`;
            const position = helpers.at(file, configPath);
            report({
              file,
              line: position.line,
              column: position.column,
              configPath,
              snippet: matcher,
              message: hint
                ? `Matcher "${matcher}" names unknown tool "${unknown[0]}". Did you mean "${hint}"?`
                : `Matcher "${matcher}" names unknown tool "${unknown[0]}", so this hook never fires.`,
            });
          });
        }
      }
    },
  },

  {
    id: 'correctness/invalid-model',
    category: 'correctness',
    severity: 'warning',
    title: 'Unrecognised model name',
    help: 'Use an alias (opus, sonnet, haiku) or a full model id. An unknown value falls back to the default without telling you.',
    check({ files, report, helpers }) {
      for (const file of files) {
        if (file.kind !== 'settings') continue;
        const model = file.data?.model;
        if (model === undefined) continue;
        if (typeof model !== 'string') {
          const position = helpers.at(file, 'model');
          report({ file, line: position.line, column: position.column, configPath: 'model', severity: 'error',
            message: `model must be a string, got ${describeType(model)}.` });
          continue;
        }
        if (MODEL_ALIASES.has(model)) continue;
        if (/^claude-[a-z0-9.-]+$/i.test(model)) continue;
        if (/^(us|eu|apac)\.anthropic\./i.test(model) || /^anthropic\./i.test(model)) continue;
        const position = helpers.at(file, 'model');
        const hint = suggest(model, MODEL_ALIASES);
        report({
          file, line: position.line, column: position.column, configPath: 'model',
          message: hint
            ? `model "${model}" is not recognised. Did you mean "${hint}"?`
            : `model "${model}" does not look like a valid alias or model id.`,
        });
      }
    },
  },

  {
    id: 'correctness/agent-missing-frontmatter',
    category: 'correctness',
    severity: 'error',
    title: 'Subagent definition has no frontmatter',
    help: 'A subagent file needs a --- delimited frontmatter block with at least name and description. Without it the agent is not registered.',
    check({ files, report }) {
      for (const file of files) {
        if (file.kind !== 'agent') continue;
        if (file.frontmatter) continue;
        report({
          file,
          line: 1,
          message: `${file.display} has no frontmatter block, so this subagent will not be loaded.`,
        });
      }
    },
  },

  {
    id: 'correctness/agent-missing-field',
    category: 'correctness',
    severity: 'error',
    title: 'Subagent is missing a required field',
    help: 'Both name and description are required. The description is what the orchestrating model reads to decide whether to delegate, so an empty one means the agent is never chosen.',
    check({ files, report, helpers }) {
      for (const file of files) {
        if (file.kind !== 'agent' || !file.frontmatter) continue;
        for (const field of ['name', 'description']) {
          const value = file.frontmatter[field];
          if (typeof value === 'string' && value.trim() !== '') continue;
          const position = helpers.atFrontmatter(file, field);
          report({
            file,
            line: position.line,
            configPath: field,
            message: `${file.display} is missing a "${field}" in its frontmatter.`,
          });
        }
      }
    },
  },

  {
    id: 'correctness/agent-name-mismatch',
    category: 'correctness',
    severity: 'warning',
    title: 'Subagent name does not match its filename',
    help: 'Keep the frontmatter name and the filename in sync; mismatches make agents hard to find and, depending on the harness version, can shadow each other.',
    check({ files, report, helpers }) {
      for (const file of files) {
        if (file.kind !== 'agent' || !file.frontmatter) continue;
        const name = file.frontmatter.name;
        if (typeof name !== 'string' || !name.trim()) continue;
        const expected = basename(file.path).replace(/\.md$/, '');
        if (slugify(name) === slugify(expected)) continue;
        const position = helpers.atFrontmatter(file, 'name');
        report({
          file,
          line: position.line,
          configPath: 'name',
          message: `Subagent is named "${name}" but the file is "${expected}.md".`,
        });
      }
    },
  },

  {
    id: 'correctness/agent-unknown-tool',
    category: 'correctness',
    severity: 'warning',
    title: 'Subagent grants a tool that does not exist',
    help: 'Tool names in the tools list are case-sensitive. An unknown entry is dropped, so the agent quietly runs without the capability you meant to give it.',
    check({ files, report, helpers }) {
      for (const file of files) {
        if (file.kind !== 'agent' || !file.frontmatter) continue;
        const tools = file.frontmatter.tools;
        const list = Array.isArray(tools) ? tools : (typeof tools === 'string' && tools !== '*' ? tools.split(',').map((t) => t.trim()) : []);
        for (const tool of list) {
          if (!tool || tool === '*') continue;
          if (TOOL_NAMES.has(tool) || tool.startsWith('mcp__')) continue;
          const hint = suggest(tool, TOOL_NAMES);
          const position = helpers.atFrontmatter(file, 'tools');
          report({
            file,
            line: position.line,
            configPath: 'tools',
            snippet: tool,
            message: hint
              ? `Subagent "${file.frontmatter.name ?? file.display}" lists unknown tool "${tool}". Did you mean "${hint}"?`
              : `Subagent "${file.frontmatter.name ?? file.display}" lists unknown tool "${tool}", which will be ignored.`,
          });
        }
      }
    },
  },

  {
    id: 'correctness/duplicate-agent-name',
    category: 'correctness',
    severity: 'error',
    title: 'Two subagents share a name',
    help: 'Names must be unique; the loser is unreachable. Project-scope agents shadow user-scope agents with the same name.',
    check({ files, report, helpers }) {
      const seen = new Map();
      for (const file of files) {
        if (file.kind !== 'agent' || !file.frontmatter) continue;
        const name = file.frontmatter.name;
        if (typeof name !== 'string' || !name.trim()) continue;
        const key = slugify(name);
        if (seen.has(key)) {
          const previous = seen.get(key);
          const position = helpers.atFrontmatter(file, 'name');
          report({
            file,
            line: position.line,
            configPath: 'name',
            message: `Subagent name "${name}" is already defined in ${previous.display}.`,
          });
          continue;
        }
        seen.set(key, file);
      }
    },
  },

  {
    id: 'correctness/skill-name-mismatch',
    category: 'correctness',
    severity: 'error',
    title: 'Skill name does not match its directory',
    help: 'A skill is invoked by its directory name, so a mismatched frontmatter name makes the skill impossible to invoke by the name it advertises.',
    check({ files, report, helpers }) {
      for (const file of files) {
        if (file.kind !== 'skill' || !file.frontmatter) continue;
        const name = file.frontmatter.name;
        if (typeof name !== 'string' || !name.trim()) continue;
        const dir = basename(dirname(file.path));
        if (slugify(name) === slugify(dir)) continue;
        const position = helpers.atFrontmatter(file, 'name');
        report({
          file,
          line: position.line,
          configPath: 'name',
          message: `Skill declares name "${name}" but lives in directory "${dir}".`,
        });
      }
    },
  },

  {
    id: 'correctness/skill-missing-field',
    category: 'correctness',
    severity: 'error',
    title: 'Skill is missing a required field',
    help: 'name and description are both required. The description is the only thing the model sees when deciding whether to load the skill.',
    check({ files, report, helpers }) {
      for (const file of files) {
        if (file.kind !== 'skill') continue;
        if (!file.frontmatter) {
          report({ file, line: 1, message: `${file.display} has no frontmatter, so the skill will not load.` });
          continue;
        }
        for (const field of ['name', 'description']) {
          const value = file.frontmatter[field];
          if (typeof value === 'string' && value.trim() !== '') continue;
          const position = helpers.atFrontmatter(file, field);
          report({ file, line: position.line, configPath: field,
            message: `${file.display} is missing "${field}" in its frontmatter.` });
        }
      }
    },
  },

  {
    id: 'correctness/duplicate-skill-name',
    category: 'correctness',
    severity: 'error',
    title: 'Two skills share a name',
    help: 'Only one wins. Rename one, or move it under a directory-scoped path if the collision is deliberate.',
    check({ files, report, helpers }) {
      const seen = new Map();
      for (const file of files) {
        if (file.kind !== 'skill' || !file.frontmatter) continue;
        const name = file.frontmatter.name;
        if (typeof name !== 'string' || !name.trim()) continue;
        const key = slugify(name);
        if (seen.has(key)) {
          const position = helpers.atFrontmatter(file, 'name');
          report({ file, line: position.line, configPath: 'name',
            message: `Skill name "${name}" is already defined in ${seen.get(key).display}.` });
          continue;
        }
        seen.set(key, file);
      }
    },
  },

  {
    id: 'correctness/mcp-server-incomplete',
    category: 'correctness',
    severity: 'error',
    title: 'MCP server has no way to start',
    help: 'A server needs either "command" (stdio) or "url" (SSE/HTTP). Without one the server fails to connect on every session start.',
    check({ files, report, helpers }) {
      for (const file of files) {
        const servers = file.data?.mcpServers;
        if (!servers || typeof servers !== 'object' || Array.isArray(servers)) continue;
        for (const [name, server] of Object.entries(servers)) {
          const basePath = `mcpServers.${name}`;
          const position = helpers.at(file, basePath);
          if (server === null || typeof server !== 'object' || Array.isArray(server)) {
            report({ file, line: position.line, column: position.column, configPath: basePath,
              message: `MCP server "${name}" must be an object, got ${describeType(server)}.` });
            continue;
          }
          const hasCommand = typeof server.command === 'string' && server.command.trim() !== '';
          const hasUrl = typeof server.url === 'string' && server.url.trim() !== '';
          if (!hasCommand && !hasUrl) {
            report({ file, line: position.line, column: position.column, configPath: basePath,
              message: `MCP server "${name}" defines neither "command" nor "url".` });
          }
          if (server.args !== undefined && !Array.isArray(server.args)) {
            report({ file, line: position.line, column: position.column, configPath: `${basePath}.args`,
              message: `MCP server "${name}" has args of type ${describeType(server.args)}, expected an array.` });
          }
        }
      }
    },
  },

  {
    id: 'correctness/mcp-server-toggled-both-ways',
    category: 'correctness',
    severity: 'warning',
    title: 'MCP server both enabled and disabled',
    help: 'Remove it from one of the two lists so the intended state is obvious.',
    check({ files, report, helpers }) {
      for (const file of files) {
        if (file.kind !== 'settings') continue;
        const enabled = file.data?.enabledMcpjsonServers;
        const disabled = file.data?.disabledMcpjsonServers;
        if (!Array.isArray(enabled) || !Array.isArray(disabled)) continue;
        const disabledSet = new Set(disabled);
        enabled.forEach((name, index) => {
          if (!disabledSet.has(name)) return;
          const configPath = `enabledMcpjsonServers[${index}]`;
          const position = helpers.at(file, configPath);
          report({ file, line: position.line, column: position.column, configPath, snippet: String(name),
            message: `MCP server "${name}" is in both enabledMcpjsonServers and disabledMcpjsonServers.` });
        });
      }
    },
  },

  {
    id: 'correctness/statusline-malformed',
    category: 'correctness',
    severity: 'warning',
    title: 'statusLine is misconfigured',
    help: 'statusLine must be an object with type "command" and a command string.',
    check({ files, report, helpers }) {
      for (const file of files) {
        if (file.kind !== 'settings') continue;
        const status = file.data?.statusLine;
        if (status === undefined) continue;
        const position = helpers.at(file, 'statusLine');
        if (status === null || typeof status !== 'object' || Array.isArray(status)) {
          report({ file, line: position.line, column: position.column, configPath: 'statusLine',
            message: `statusLine must be an object, got ${describeType(status)}.` });
          continue;
        }
        if (status.type !== 'command') {
          report({ file, line: position.line, column: position.column, configPath: 'statusLine.type',
            message: `statusLine.type is ${JSON.stringify(status.type)}; expected "command".` });
        }
        if (typeof status.command !== 'string' || !status.command.trim()) {
          report({ file, line: position.line, column: position.column, configPath: 'statusLine.command',
            message: 'statusLine.command is missing or empty.' });
        }
      }
    },
  },

  {
    id: 'correctness/env-non-string-value',
    category: 'correctness',
    severity: 'warning',
    title: 'Environment value is not a string',
    help: 'Environment variables are strings. Numbers and booleans here may be dropped or coerced unpredictably — quote them.',
    check({ files, report, helpers }) {
      for (const file of files) {
        if (file.kind !== 'settings') continue;
        const env = file.data?.env;
        if (!env || typeof env !== 'object' || Array.isArray(env)) continue;
        for (const [key, value] of Object.entries(env)) {
          if (typeof value === 'string') continue;
          const position = helpers.at(file, `env.${key}`);
          report({ file, line: position.line, column: position.column, configPath: `env.${key}`,
            message: `env.${key} is ${describeType(value)}; write it as a string ("${String(value)}").` });
        }
      }
    },
  },
];

function describeType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'object') return 'an object';
  if (typeof value === 'string') return 'a string';
  return `a ${typeof value}`;
}
