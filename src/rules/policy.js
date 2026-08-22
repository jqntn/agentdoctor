import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseJsonWithPositions } from '../parse.js';

/**
 * Team policy enforcement.
 *
 * A single repo can be audited by reading it. A fleet of repos needs a written
 * standard that CI can check, which is what these rules do: they compare the
 * discovered config against an `agentdoctor.policy.json` committed by whoever
 * owns the standard. These rules only activate when a policy file exists, so
 * they cost solo users nothing.
 */

export const POLICY_FILENAMES = [
  'agentdoctor.policy.json',
  '.agentdoctor.policy.json',
  '.claude/agentdoctor.policy.json',
];

/**
 * @typedef {Object} Policy
 * @property {string[]} [requiredDeny]        deny rules every project must carry
 * @property {string[]} [forbiddenAllow]      allow rules no project may carry (glob-ish)
 * @property {string[]} [allowedMcpServers]   whitelist of MCP server names
 * @property {string[]} [requiredHooks]       hook events that must be configured
 * @property {number}   [maxMemoryTokens]     ceiling on always-on context
 * @property {string[]} [forbiddenPermissionModes]
 * @property {boolean}  [requireBypassDisabled]
 */

/** Loads the policy for a workspace, if one is committed. */
export function loadPolicy(root, explicitPath) {
  const candidates = explicitPath ? [explicitPath] : POLICY_FILENAMES.map((name) => join(root, name));
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      const { value } = parseJsonWithPositions(readFileSync(candidate, 'utf8'));
      return { policy: value, path: candidate };
    } catch (error) {
      return { policy: null, path: candidate, error: error.message };
    }
  }
  return { policy: null, path: null };
}

/**
 * Matches a policy pattern against a permission rule.
 *
 * A single `*` is literal, because permission rules contain `*` themselves and
 * a policy entry of "Bash(*)" must mean exactly that rule rather than "every
 * Bash rule". `**` is the wildcard: "Bash(**)" matches any Bash rule and
 * "Bash(**sudo**)" matches any Bash rule mentioning sudo.
 */
export function matchesPattern(pattern, value) {
  if (typeof pattern !== 'string' || typeof value !== 'string') return false;
  if (pattern === value) return true;
  if (!pattern.includes('**')) return false;
  const escaped = pattern
    .split('**')
    .map((part) => part.replace(/[.*+^${}()|[\]\\?]/g, '\\$&'))
    .join('[\\s\\S]*');
  return new RegExp(`^${escaped}$`).test(value);
}

function collectSettings(files) {
  return files.filter((f) => f.kind === 'settings' && f.data);
}

export const policyRules = [
  {
    id: 'policy/missing-required-deny',
    category: 'policy',
    severity: 'error',
    title: 'Required deny rule is absent',
    help: 'Add the rule to committed project settings. It is mandated by your agentdoctor.policy.json.',
    check({ workspace, report, helpers }) {
      const { policy } = workspace.policy ?? {};
      const required = policy?.requiredDeny;
      if (!Array.isArray(required) || required.length === 0) return;
      const settings = collectSettings(workspace.files);
      const present = new Set();
      for (const file of settings) {
        const deny = file.data?.permissions?.deny;
        if (!Array.isArray(deny)) continue;
        for (const rule of deny) if (typeof rule === 'string') present.add(rule.trim());
      }
      const target = settings.find((f) => f.scope === 'project')
        ?? settings[0]
        ?? { path: workspace.root, display: '.' };
      for (const rule of required) {
        if (typeof rule !== 'string') continue;
        if ([...present].some((existing) => matchesPattern(rule, existing))) continue;
        report({
          file: target,
          line: 1,
          snippet: rule,
          message: `Policy requires deny rule "${rule}", which is not configured anywhere.`,
        });
      }
    },
  },

  {
    id: 'policy/forbidden-allow',
    category: 'policy',
    severity: 'error',
    title: 'Allow rule forbidden by policy',
    help: 'Remove the rule or get the policy amended. Policy exists so this decision is made once, centrally, instead of per repo.',
    check({ workspace, report, helpers }) {
      const { policy } = workspace.policy ?? {};
      const forbidden = policy?.forbiddenAllow;
      if (!Array.isArray(forbidden) || forbidden.length === 0) return;
      for (const file of collectSettings(workspace.files)) {
        const allow = file.data?.permissions?.allow;
        if (!Array.isArray(allow)) continue;
        allow.forEach((rule, index) => {
          if (typeof rule !== 'string') return;
          const hit = forbidden.find((pattern) => typeof pattern === 'string' && matchesPattern(pattern, rule.trim()));
          if (!hit) return;
          const configPath = `permissions.allow[${index}]`;
          const position = helpers.at(file, configPath);
          report({
            file,
            line: position.line,
            column: position.column,
            configPath,
            snippet: rule,
            message: `"${rule}" is forbidden by policy pattern "${hit}".`,
          });
        });
      }
    },
  },

  {
    id: 'policy/unapproved-mcp-server',
    category: 'policy',
    severity: 'error',
    title: 'MCP server not on the approved list',
    help: 'MCP servers run code and see your context. Add the server to allowedMcpServers in policy once it has been reviewed.',
    check({ workspace, report, helpers }) {
      const { policy } = workspace.policy ?? {};
      const allowed = policy?.allowedMcpServers;
      if (!Array.isArray(allowed)) return;
      const allowedSet = new Set(allowed);
      for (const file of workspace.files) {
        const servers = file.data?.mcpServers;
        if (!servers || typeof servers !== 'object' || Array.isArray(servers)) continue;
        for (const name of Object.keys(servers)) {
          if (allowedSet.has(name) || allowed.some((p) => matchesPattern(p, name))) continue;
          const configPath = `mcpServers.${name}`;
          const position = helpers.at(file, configPath);
          report({
            file,
            line: position.line,
            column: position.column,
            configPath,
            snippet: name,
            message: `MCP server "${name}" is not in the approved list.`,
          });
        }
      }
    },
  },

  {
    id: 'policy/required-hook-missing',
    category: 'policy',
    severity: 'error',
    title: 'Mandated guardrail hook is missing',
    help: 'Policy requires this hook event to be configured. Copy it from your organisation template.',
    check({ workspace, report }) {
      const { policy } = workspace.policy ?? {};
      const required = policy?.requiredHooks;
      if (!Array.isArray(required) || required.length === 0) return;
      const settings = collectSettings(workspace.files);
      const configured = new Set();
      for (const file of settings) {
        const hooks = file.data?.hooks;
        if (!hooks || typeof hooks !== 'object') continue;
        for (const event of Object.keys(hooks)) configured.add(event);
      }
      const target = settings.find((f) => f.scope === 'project') ?? settings[0] ?? { path: workspace.root, display: '.' };
      for (const event of required) {
        if (configured.has(event)) continue;
        report({ file: target, line: 1, snippet: event, message: `Policy requires a ${event} hook; none is configured.` });
      }
    },
  },

  {
    id: 'policy/memory-budget-exceeded',
    category: 'policy',
    severity: 'error',
    title: 'Always-on context exceeds the policy budget',
    help: 'Trim the memory files or raise maxMemoryTokens deliberately. A context budget is the only thing that stops CLAUDE.md growing without limit.',
    check({ workspace, report, helpers }) {
      const { policy } = workspace.policy ?? {};
      const max = policy?.maxMemoryTokens;
      if (typeof max !== 'number' || max <= 0) return;
      const memories = workspace.files.filter((f) => f.kind === 'memory' && f.scope !== 'user');
      if (memories.length === 0) return;
      const total = memories.reduce((sum, f) => sum + helpers.estimateTokens(f.text), 0);
      if (total <= max) return;
      const biggest = memories.map((f) => ({ f, t: helpers.estimateTokens(f.text) })).sort((a, b) => b.t - a.t)[0];
      report({
        file: biggest.f,
        line: 1,
        message: `Project memory is ~${total.toLocaleString('en-US')} tokens, over the policy budget of ${max.toLocaleString('en-US')}. Largest contributor: ${biggest.f.display} (~${biggest.t.toLocaleString('en-US')}).`,
      });
    },
  },

  {
    id: 'policy/forbidden-permission-mode',
    category: 'policy',
    severity: 'error',
    title: 'Permission mode forbidden by policy',
    help: 'Change defaultMode to a mode your policy permits.',
    check({ workspace, report, helpers }) {
      const { policy } = workspace.policy ?? {};
      const forbidden = policy?.forbiddenPermissionModes;
      if (!Array.isArray(forbidden) || forbidden.length === 0) return;
      for (const file of collectSettings(workspace.files)) {
        const mode = file.data?.permissions?.defaultMode;
        if (typeof mode !== 'string' || !forbidden.includes(mode)) continue;
        const position = helpers.at(file, 'permissions.defaultMode');
        report({
          file,
          line: position.line,
          column: position.column,
          configPath: 'permissions.defaultMode',
          message: `defaultMode "${mode}" is forbidden by policy.`,
        });
      }
    },
  },

  {
    id: 'policy/permission-drift',
    category: 'policy',
    severity: 'warning',
    title: 'Local overrides widen the committed permission set',
    help: 'Local settings are invisible in review. If a rule is genuinely needed, put it in project settings so the team sees it; if it is personal, keep it narrow.',
    check({ workspace, report, helpers }) {
      const project = workspace.files.find((f) => f.kind === 'settings' && f.scope === 'project' && f.data);
      const local = workspace.files.find((f) => f.kind === 'settings' && f.scope === 'local' && f.data);
      if (!project || !local) return;
      const projectAllow = new Set((project.data?.permissions?.allow ?? []).filter((r) => typeof r === 'string'));
      const localAllow = local.data?.permissions?.allow;
      if (!Array.isArray(localAllow)) return;
      localAllow.forEach((rule, index) => {
        if (typeof rule !== 'string' || projectAllow.has(rule)) return;
        const parsed = helpers.parsePermission(rule);
        const broad = parsed.argument === null || ['*', '**', ':*'].includes(String(parsed.argument).trim());
        if (!broad) return;
        const configPath = `permissions.allow[${index}]`;
        const position = helpers.at(local, configPath);
        report({
          file: local,
          line: position.line,
          column: position.column,
          configPath,
          snippet: rule,
          message: `Local settings add unrestricted rule "${rule}" that the committed project config does not grant.`,
        });
      });
    },
  },

  {
    id: 'policy/file-invalid',
    category: 'policy',
    severity: 'error',
    title: 'Policy file could not be read',
    help: 'A policy that fails to parse enforces nothing, which is the most dangerous state for a guardrail to be in.',
    check({ workspace, report }) {
      const { path, error } = workspace.policy ?? {};
      if (!path || !error) return;
      report({
        file: { path, display: path },
        line: 1,
        message: `Policy file failed to parse: ${error}. No policy rules were enforced.`,
      });
    },
  },
];
