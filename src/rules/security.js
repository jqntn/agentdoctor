import {
  DESTRUCTIVE_PATTERNS, REMOTE_EXEC_PATTERNS, SECRET_PATTERNS,
  DANGEROUS_ENV_VARS, PERMISSION_MODES, EGRESS_TOOLS,
} from '../constants.js';
import { existsSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

/** Matchers that grant a tool with no argument restriction at all. */
const WILDCARD_ARGS = new Set(['*', '**', ':*', '', '.*', '*:*']);

const isWildcard = (argument) =>
  argument === null || WILDCARD_ARGS.has(String(argument).trim());

/** Walks every permission rule in every settings file. */
function eachPermission(files, helpers, callback) {
  for (const file of files) {
    if (file.kind !== 'settings' || !file.data) continue;
    for (const bucket of ['allow', 'deny', 'ask']) {
      const rules = file.data?.permissions?.[bucket];
      if (!Array.isArray(rules)) continue;
      rules.forEach((rule, index) => {
        const configPath = `permissions.${bucket}[${index}]`;
        callback({
          file,
          bucket,
          rule,
          index,
          configPath,
          position: helpers.at(file, configPath),
          parsed: helpers.parsePermission(rule),
        });
      });
    }
  }
}

/** Collects every shell command a hook would run. */
function eachHookCommand(files, helpers, callback) {
  for (const file of files) {
    if (file.kind !== 'settings' || !file.data?.hooks) continue;
    const hooks = file.data.hooks;
    if (typeof hooks !== 'object' || Array.isArray(hooks)) continue;
    for (const [event, matchers] of Object.entries(hooks)) {
      if (!Array.isArray(matchers)) continue;
      matchers.forEach((entry, matcherIndex) => {
        const list = entry?.hooks;
        if (!Array.isArray(list)) return;
        list.forEach((hook, hookIndex) => {
          const configPath = `hooks.${event}[${matcherIndex}].hooks[${hookIndex}].command`;
          callback({
            file,
            event,
            hook,
            command: typeof hook?.command === 'string' ? hook.command : null,
            configPath,
            position: helpers.at(file, configPath),
            matcher: entry?.matcher,
          });
        });
      });
    }
  }
}

export const securityRules = [
  {
    id: 'security/unrestricted-bash',
    category: 'security',
    severity: 'error',
    title: 'Blanket Bash allow rule',
    help: 'Replace the wildcard with the specific commands you actually want unattended, e.g. "Bash(npm test:*)" or "Bash(git status)". A blanket allow means any command the model proposes runs without asking you.',
    check({ files, report, helpers }) {
      eachPermission(files, helpers, ({ file, bucket, parsed, configPath, position, rule }) => {
        if (bucket !== 'allow') return;
        if (parsed.tool !== 'Bash') return;
        if (!isWildcard(parsed.argument)) return;
        report({
          file,
          line: position.line,
          column: position.column,
          configPath,
          snippet: String(rule),
          message: `"${rule}" auto-approves every shell command, including ones you have not seen.`,
        });
      });
    },
  },

  {
    id: 'security/destructive-allow',
    category: 'security',
    severity: 'error',
    title: 'Destructive command pre-approved',
    help: 'Move this rule to permissions.ask so you still get a prompt, or narrow it to the safe subset of the command.',
    check({ files, report, helpers }) {
      eachPermission(files, helpers, ({ file, bucket, parsed, configPath, position, rule }) => {
        if (bucket !== 'allow') return;
        if (parsed.argument == null) return;
        for (const { pattern, label } of DESTRUCTIVE_PATTERNS) {
          if (pattern.test(parsed.argument)) {
            report({
              file,
              line: position.line,
              column: position.column,
              configPath,
              snippet: String(rule),
              message: `"${rule}" pre-approves ${label} with no confirmation.`,
            });
            return;
          }
        }
      });
    },
  },

  {
    id: 'security/bypass-permissions-default',
    category: 'security',
    severity: 'error',
    title: 'Permission checks disabled by default',
    help: 'Use "default" or "acceptEdits" for day-to-day work and opt into bypass explicitly per session. Committing bypassPermissions applies it to everyone who checks out the repo.',
    check({ files, report, helpers }) {
      for (const file of files) {
        if (file.kind !== 'settings' || !file.data) continue;
        const mode = file.data?.permissions?.defaultMode;
        if (mode !== 'bypassPermissions') continue;
        const position = helpers.at(file, 'permissions.defaultMode');
        report({
          file,
          line: position.line,
          column: position.column,
          configPath: 'permissions.defaultMode',
          message: file.scope === 'project'
            ? 'defaultMode "bypassPermissions" is committed to the repo, so every contributor runs with permission checks off.'
            : 'defaultMode "bypassPermissions" turns off permission checks for every session.',
        });
      }
    },
  },

  {
    id: 'security/hooks-globally-disabled',
    category: 'security',
    severity: 'warning',
    title: 'All hooks disabled',
    help: 'If hooks were disabled to work around one noisy hook, remove that hook instead. disableAllHooks also silences hooks your team relies on for guardrails.',
    check({ files, report, helpers }) {
      for (const file of files) {
        if (file.kind !== 'settings' || file.data?.disableAllHooks !== true) continue;
        const position = helpers.at(file, 'disableAllHooks');
        report({
          file,
          line: position.line,
          column: position.column,
          configPath: 'disableAllHooks',
          message: 'disableAllHooks is true, so every configured guardrail hook is inert.',
        });
      }
    },
  },

  {
    id: 'security/hook-remote-code',
    category: 'security',
    severity: 'error',
    title: 'Hook downloads and executes remote code',
    help: 'Vendor the script into the repo and run it from a pinned path. Hooks run automatically with your full user privileges and no confirmation, so whoever controls that URL controls your machine.',
    check({ files, report, helpers }) {
      eachHookCommand(files, helpers, ({ file, command, configPath, position, event }) => {
        if (!command) return;
        for (const { pattern, label } of REMOTE_EXEC_PATTERNS) {
          if (pattern.test(command)) {
            report({
              file,
              line: position.line,
              column: position.column,
              configPath,
              snippet: command.slice(0, 120),
              message: `${event} hook uses ${label}; the remote content is executed unreviewed on every trigger.`,
            });
            return;
          }
        }
      });
    },
  },

  {
    id: 'security/hook-unpinned-path',
    category: 'security',
    severity: 'warning',
    title: 'Hook command resolves through PATH or cwd',
    help: 'Use an absolute path or "$CLAUDE_PROJECT_DIR/.claude/hooks/name.sh". A bare name resolves via PATH, so a same-named file earlier in PATH — or in a repo you clone — runs instead.',
    check({ files, report, helpers }) {
      eachHookCommand(files, helpers, ({ file, command, configPath, position }) => {
        if (!command) return;
        const first = command.trim().split(/\s+/)[0];
        if (!first) return;
        // Only flag things that look like a script the user wrote, not shell builtins
        // or well-known binaries which are expected to come from PATH.
        if (!/\.(sh|bash|zsh|py|js|mjs|cjs|ts|rb|pl)$/.test(first)) return;
        if (isAbsolute(first)) return;
        if (first.startsWith('$') || first.startsWith('~')) return;
        report({
          file,
          line: position.line,
          column: position.column,
          configPath,
          snippet: command.slice(0, 120),
          message: `Hook runs "${first}" without an absolute path, so which file executes depends on PATH and the current directory.`,
        });
      });
    },
  },

  {
    id: 'security/hook-dangerous-command',
    category: 'security',
    severity: 'warning',
    title: 'Hook runs a destructive command',
    help: 'Hooks fire automatically with no confirmation step. Anything irreversible belongs in a command you invoke deliberately, not in a hook.',
    check({ files, report, helpers }) {
      eachHookCommand(files, helpers, ({ file, command, configPath, position, event }) => {
        if (!command) return;
        for (const { pattern, label } of DESTRUCTIVE_PATTERNS) {
          if (pattern.test(command)) {
            report({
              file,
              line: position.line,
              column: position.column,
              configPath,
              snippet: command.slice(0, 120),
              message: `${event} hook performs ${label} automatically on every trigger.`,
            });
            return;
          }
        }
      });
    },
  },

  {
    id: 'security/secret-in-config',
    category: 'security',
    severity: 'error',
    title: 'Credential hardcoded in agent config',
    help: 'Move the value to a secret manager or an untracked env file and reference it indirectly. Config files are committed, synced and shared far more often than people expect.',
    check({ files, report, helpers }) {
      for (const file of files) {
        if (file.kind === 'hook') continue; // scripts are scanned by their own rule below
        const lines = file.text.split(/\r?\n/);
        lines.forEach((line, index) => {
          if (/agentdoctor-allow-secret/.test(line)) return;
          for (const { pattern, label } of SECRET_PATTERNS) {
            const match = pattern.exec(line);
            if (!match) continue;
            report({
              file,
              line: index + 1,
              column: match.index + 1,
              snippet: redact(match[0]),
              message: `Looks like a live ${label} committed in ${file.display}.`,
            });
            return;
          }
        });
      }
    },
  },

  {
    id: 'security/dangerous-env-var',
    category: 'security',
    severity: 'warning',
    title: 'Loader-influencing environment variable set',
    help: 'Set these per-command instead of session-wide. Anything defined in settings.env applies to every process the agent spawns for the whole session.',
    check({ files, report, helpers }) {
      for (const file of files) {
        if (file.kind !== 'settings') continue;
        const env = file.data?.env;
        if (!env || typeof env !== 'object' || Array.isArray(env)) continue;
        for (const key of Object.keys(env)) {
          const reason = DANGEROUS_ENV_VARS.get(key);
          if (!reason) continue;
          const position = helpers.at(file, `env.${key}`);
          report({
            file,
            line: position.line,
            column: position.column,
            configPath: `env.${key}`,
            message: `env.${key} ${reason}.`,
          });
        }
      }
    },
  },

  {
    id: 'security/broad-additional-directory',
    category: 'security',
    severity: 'error',
    title: 'Filesystem root granted as a working directory',
    help: 'List only the specific sibling directories the agent needs. Granting "/" or your home directory hands it every SSH key, browser profile and other project on the machine.',
    check({ files, report, helpers }) {
      const broad = new Set(['/', '~', '~/', '/home', '/Users', '/etc', 'C:\\', '/var', '/usr']);
      for (const file of files) {
        if (file.kind !== 'settings') continue;
        const dirs = file.data?.permissions?.additionalDirectories;
        if (!Array.isArray(dirs)) continue;
        dirs.forEach((dir, index) => {
          if (typeof dir !== 'string') return;
          const normalized = dir.trim().replace(/\/+$/, '') || '/';
          if (!broad.has(dir.trim()) && !broad.has(normalized)) return;
          const configPath = `permissions.additionalDirectories[${index}]`;
          const position = helpers.at(file, configPath);
          report({
            file,
            line: position.line,
            column: position.column,
            configPath,
            snippet: dir,
            message: `additionalDirectories includes "${dir}", which exposes the entire machine to file tools.`,
          });
        });
      }
    },
  },

  {
    id: 'security/unrestricted-egress',
    category: 'security',
    severity: 'warning',
    title: 'Unrestricted network egress pre-approved',
    help: 'Scope WebFetch to the domains you actually need, e.g. "WebFetch(domain:docs.example.com)". An open fetch rule is a one-step path for anything in your context to leave the machine.',
    check({ files, report, helpers }) {
      eachPermission(files, helpers, ({ file, bucket, parsed, configPath, position, rule }) => {
        if (bucket !== 'allow') return;
        if (parsed.tool !== 'WebFetch') return;
        if (!isWildcard(parsed.argument)) return;
        report({
          file,
          line: position.line,
          column: position.column,
          configPath,
          snippet: String(rule),
          message: `"${rule}" allows fetching any URL without asking, which doubles as an exfiltration channel.`,
        });
      });
    },
  },

  {
    id: 'security/sensitive-read-allowed',
    category: 'security',
    severity: 'error',
    title: 'Credential file explicitly readable',
    help: 'Remove the rule and add the path to permissions.deny instead. Secrets read into context end up in transcripts, logs and any tool call the model makes next.',
    check({ files, report, helpers }) {
      // Two separate shapes: sensitive *paths*, which need a separator or start
      // anchor so "development.env-notes" does not match, and sensitive
      // *extensions*, which are meaningful wherever they end a path.
      const sensitivePath = /(^|[\/\\.])(\.env(\.|$)|\.ssh[\/\\]|\.aws[\/\\]credentials|\.kube[\/\\]config|\.npmrc|\.netrc|id_rsa|id_ed25519|\.git-credentials|secrets?\.(ya?ml|json))/i;
      const sensitiveExtension = /\.(pem|p12|pfx|key|jks|keystore)$/i;
      const sensitive = (value) => sensitivePath.test(value) || sensitiveExtension.test(value);
      eachPermission(files, helpers, ({ file, bucket, parsed, configPath, position, rule }) => {
        if (bucket !== 'allow') return;
        if (parsed.argument == null) return;
        if (!sensitive(parsed.argument)) return;
        report({
          file,
          line: position.line,
          column: position.column,
          configPath,
          snippet: String(rule),
          message: `"${rule}" pre-approves reading a credential file.`,
        });
      });
    },
  },

  {
    id: 'security/missing-secret-denies',
    category: 'security',
    severity: 'info',
    title: 'No deny rules protecting secrets',
    help: 'Add a deny list such as ["Read(./.env*)", "Read(**/.ssh/**)", "Read(**/*.pem)", "Read(**/.aws/credentials)"]. Deny rules are the only guardrail that survives an accepted prompt, since they are checked before anything runs.',
    check({ files, report, helpers }) {
      const settings = files.filter((f) => f.kind === 'settings' && f.data);
      if (settings.length === 0) return;
      const hasAnyDeny = settings.some((file) => {
        const deny = file.data?.permissions?.deny;
        if (!Array.isArray(deny)) return false;
        return deny.some((rule) => typeof rule === 'string' && /\.env|ssh|pem|credential|secret|\.key/i.test(rule));
      });
      if (hasAnyDeny) return;
      // Only worth mentioning if the project actually has secrets lying around.
      const target = settings.find((f) => f.scope === 'project') ?? settings[0];
      report({
        file: target,
        line: 1,
        message: 'No deny rules cover .env, SSH keys or cloud credentials.',
      });
    },
  },

  {
    id: 'security/mcp-unpinned-package',
    category: 'security',
    severity: 'warning',
    title: 'MCP server runs an unpinned remote package',
    help: 'Pin the exact version, e.g. "@scope/server@1.4.2". With "@latest" or no version, every session silently installs whatever was published most recently, including a compromised release.',
    check({ files, report, helpers }) {
      eachMcpServer(files, helpers, ({ file, name, server, basePath }) => {
        const args = Array.isArray(server?.args) ? server.args : [];
        const command = typeof server?.command === 'string' ? server.command : '';
        const runner = /\b(npx|bunx|pnpx|uvx|pipx)\b/.test(command) || /\b(npx|bunx|pnpx|uvx|pipx)\b/.test(args[0] ?? '');
        if (!runner) return;
        const pkg = args.find((a) => typeof a === 'string' && !a.startsWith('-') && !/^(npx|bunx|pnpx|uvx|pipx)$/.test(a));
        if (!pkg) return;
        const pinned = /@\d+\.\d+\.\d+/.test(pkg) || /==\d/.test(pkg);
        if (pinned) return;
        const position = helpers.at(file, `${basePath}.args`);
        report({
          file,
          line: position.line,
          column: position.column,
          configPath: `${basePath}.args`,
          snippet: pkg,
          message: `MCP server "${name}" launches "${pkg}" unpinned, so its code can change under you between sessions.`,
        });
      });
    },
  },

  {
    id: 'security/mcp-auto-enable-all',
    category: 'security',
    severity: 'warning',
    title: 'Project MCP servers auto-enabled without review',
    help: 'Leave this off and enable servers explicitly via enabledMcpjsonServers. Otherwise cloning a repo is enough to run its MCP servers on your machine.',
    check({ files, report, helpers }) {
      for (const file of files) {
        if (file.kind !== 'settings' || file.data?.enableAllProjectMcpServers !== true) continue;
        const position = helpers.at(file, 'enableAllProjectMcpServers');
        report({
          file,
          line: position.line,
          column: position.column,
          configPath: 'enableAllProjectMcpServers',
          message: 'enableAllProjectMcpServers trusts any .mcp.json shipped in a repo you open.',
        });
      }
    },
  },

  {
    id: 'security/mcp-plaintext-url-credential',
    category: 'security',
    severity: 'error',
    title: 'Credential embedded in MCP server URL',
    help: 'Move the token into a header sourced from the environment. URLs land in logs, crash reports and shell history.',
    check({ files, report, helpers }) {
      eachMcpServer(files, helpers, ({ file, name, server, basePath }) => {
        const url = typeof server?.url === 'string' ? server.url : null;
        if (!url) return;
        if (!/[?&](token|key|api[_-]?key|access[_-]?token|secret|password)=[^&\s]{8,}/i.test(url)) return;
        const position = helpers.at(file, `${basePath}.url`);
        report({
          file,
          line: position.line,
          column: position.column,
          configPath: `${basePath}.url`,
          message: `MCP server "${name}" carries a credential in its URL query string.`,
        });
      });
    },
  },

  {
    id: 'security/world-writable-config',
    category: 'security',
    severity: 'error',
    title: 'Agent config writable by other users',
    help: 'Run "chmod go-w" on the file. Any user who can write your agent config can add a hook, and hooks execute automatically as you.',
    check({ files, report }) {
      // Windows has no POSIX mode bits; Node synthesizes 0666, which would make
      // this rule fire on every file. File ACLs there are a different model and
      // outside what this rule can speak to.
      if (process.platform === 'win32') return;
      // Group-write is only meaningful when the group is shared. Most Linux
      // distributions give each user a private group and a 002 umask, which
      // makes mode 664 the harmless default rather than a finding.
      const ownGid = typeof process.getgid === 'function' ? process.getgid() : null;
      for (const file of files) {
        const otherWritable = (file.mode & 0o002) !== 0;
        const groupWritable = (file.mode & 0o020) !== 0;
        const sharedGroup = groupWritable && ownGid !== null && file.gid !== ownGid;
        if (!otherWritable && !sharedGroup) continue;
        report({
          file,
          line: 1,
          severity: otherWritable ? 'error' : 'warning',
          message: otherWritable
            ? `${file.display} is world-writable (mode ${(file.mode & 0o777).toString(8)}), so any user on this machine can inject commands that run as you.`
            : `${file.display} is writable by group ${file.gid} (mode ${(file.mode & 0o777).toString(8)}), which is not your primary group.`,
        });
      }
    },
  },

  {
    id: 'security/hook-script-not-executable',
    category: 'security',
    severity: 'warning',
    title: 'Hook script is world-writable or missing',
    help: 'Keep hook scripts inside the repo, owned by you, and not group-writable.',
    check({ files, report, helpers, workspace }) {
      eachHookCommand(files, helpers, ({ file, command, configPath, position }) => {
        if (!command) return;
        const first = command.trim().split(/\s+/)[0]?.replace(/^["']|["']$/g, '');
        if (!first) return;
        if (!/\.(sh|bash|py|js|mjs|cjs)$/.test(first)) return;
        const resolved = first.includes('$')
          ? first.replace(/\$\{?CLAUDE_PROJECT_DIR\}?/g, workspace.root)
          : (isAbsolute(first) ? first : join(workspace.root, first));
        if (first.includes('$') && /\$(?!\{?CLAUDE_PROJECT_DIR)/.test(first)) return; // unknown variable, can't resolve
        if (!existsSync(resolved)) {
          report({
            file,
            line: position.line,
            column: position.column,
            configPath,
            severity: 'error',
            message: `Hook script "${first}" does not exist at ${resolved}; the hook will fail every time it fires.`,
            help: 'Fix the path, or remove the hook. A hook whose command is missing produces an error on every matching tool call.',
          });
          return;
        }
        // Same ownership logic as security/world-writable-config: group-write
        // only matters when the group is shared. A git checkout under the
        // common umask 002 produces mode 775, so flagging group-write outright
        // would fire on every cloned repository. And Windows synthesizes 0666
        // for every file, so the check is meaningless there.
        if (process.platform === 'win32') return;
        const stats = statSync(resolved);
        const ownGid = typeof process.getgid === 'function' ? process.getgid() : null;
        const otherWritable = (stats.mode & 0o002) !== 0;
        const sharedGroup = (stats.mode & 0o020) !== 0 && ownGid !== null && stats.gid !== ownGid;
        if (otherWritable || sharedGroup) {
          report({
            file,
            line: position.line,
            column: position.column,
            configPath,
            severity: otherWritable ? 'warning' : 'info',
            message: otherWritable
              ? `Hook script "${first}" is world-writable (mode ${(stats.mode & 0o777).toString(8)}), so any user on this machine can change what it runs.`
              : `Hook script "${first}" is writable by group ${stats.gid} (mode ${(stats.mode & 0o777).toString(8)}), which is not your primary group.`,
          });
        }
      });
    },
  },

  {
    id: 'security/apikeyhelper-inline-secret',
    category: 'security',
    severity: 'error',
    title: 'apiKeyHelper echoes a literal key',
    help: 'Point apiKeyHelper at a script that reads from your OS keychain or secret manager, rather than embedding the key in the command.',
    check({ files, report, helpers }) {
      for (const file of files) {
        if (file.kind !== 'settings') continue;
        const helper = file.data?.apiKeyHelper;
        if (typeof helper !== 'string') continue;
        const looksLiteral = SECRET_PATTERNS.some(({ pattern }) => pattern.test(helper))
          || /\becho\s+["']?[A-Za-z0-9_-]{24,}/.test(helper);
        if (!looksLiteral) continue;
        const position = helpers.at(file, 'apiKeyHelper');
        report({
          file,
          line: position.line,
          column: position.column,
          configPath: 'apiKeyHelper',
          message: 'apiKeyHelper appears to contain the key itself rather than a lookup command.',
        });
      }
    },
  },

  {
    id: 'security/deny-bucket-empty-with-broad-allow',
    category: 'security',
    severity: 'warning',
    title: 'Broad allow list with no deny list',
    help: 'Pair permissive allow rules with explicit denies. Deny is evaluated first and is the only rule class the model cannot talk its way past.',
    check({ files, report, helpers }) {
      for (const file of files) {
        if (file.kind !== 'settings' || !file.data?.permissions) continue;
        const perms = file.data.permissions;
        const allow = Array.isArray(perms.allow) ? perms.allow : [];
        const deny = Array.isArray(perms.deny) ? perms.deny : [];
        if (deny.length > 0) continue;
        const broadCount = allow.filter((rule) => {
          const parsed = helpers.parsePermission(rule);
          return isWildcard(parsed.argument) && (EGRESS_TOOLS.has(parsed.tool) || parsed.tool === 'Write' || parsed.tool === 'Edit');
        }).length;
        if (broadCount === 0) continue;
        const position = helpers.at(file, 'permissions');
        report({
          file,
          line: position.line,
          column: position.column,
          configPath: 'permissions',
          message: `${broadCount} unrestricted allow rule(s) for tools that write files or reach the network, and permissions.deny is empty.`,
        });
      }
    },
  },

  {
    id: 'security/bypass-mode-not-locked',
    category: 'security',
    severity: 'info',
    title: 'Bypass mode not disabled for the project',
    help: 'Set permissions.disableBypassPermissionsMode to "disable" in committed project settings to stop anyone opting out of prompts in this repo.',
    check({ files, report, helpers }) {
      const project = files.find((f) => f.kind === 'settings' && f.scope === 'project' && f.data);
      if (!project) return;
      const perms = project.data?.permissions;
      if (!perms) return;
      if (perms.disableBypassPermissionsMode === 'disable') return;
      const denies = Array.isArray(perms.deny) ? perms.deny.length : 0;
      if (denies === 0) return; // only suggest to teams already writing guardrails
      const position = helpers.at(project, 'permissions');
      report({
        file: project,
        line: position.line,
        column: position.column,
        configPath: 'permissions',
        message: 'This project defines deny rules, but any contributor can still start a session in bypassPermissions mode and skip them.',
      });
    },
  },

  {
    id: 'security/invalid-permission-mode',
    category: 'security',
    severity: 'error',
    title: 'Unknown permission mode',
    help: `Use one of: ${[...PERMISSION_MODES].join(', ')}. An unrecognised mode is ignored, so you silently fall back to the default.`,
    check({ files, report, helpers }) {
      for (const file of files) {
        if (file.kind !== 'settings') continue;
        const mode = file.data?.permissions?.defaultMode;
        if (mode === undefined) continue;
        if (typeof mode === 'string' && PERMISSION_MODES.has(mode)) continue;
        const position = helpers.at(file, 'permissions.defaultMode');
        report({
          file,
          line: position.line,
          column: position.column,
          configPath: 'permissions.defaultMode',
          message: `permissions.defaultMode is ${JSON.stringify(mode)}, which is not a valid mode.`,
        });
      }
    },
  },
];

/** Iterates MCP server definitions across .mcp.json and settings files. */
export function eachMcpServer(files, helpers, callback) {
  for (const file of files) {
    if (!file.data) continue;
    const containers = [];
    if (file.kind === 'mcp') containers.push(['mcpServers', file.data?.mcpServers]);
    if (file.kind === 'settings') containers.push(['mcpServers', file.data?.mcpServers]);
    for (const [key, servers] of containers) {
      if (!servers || typeof servers !== 'object' || Array.isArray(servers)) continue;
      for (const [name, server] of Object.entries(servers)) {
        callback({ file, name, server, basePath: `${key}.${name}` });
      }
    }
  }
}

function redact(value) {
  if (value.length <= 10) return '***';
  return `${value.slice(0, 6)}…${value.slice(-2)} (redacted)`;
}
