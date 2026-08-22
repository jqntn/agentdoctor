import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, basename, sep } from 'node:path';
import { parseJsonWithPositions, parseFrontmatter, JsonSyntaxError } from './parse.js';

/** Directories that never contain agent config worth linting. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', 'target',
  'vendor', '.next', '.nuxt', '.venv', 'venv', '__pycache__', '.cache',
  'coverage', '.turbo', '.gradle', 'Pods', '.terraform',
]);

/**
 * Files that may hold live credentials. agentdoctor never opens these — it can
 * report on their permissions via stat(), but the contents stay unread so the
 * tool can be run safely in CI and on shared machines.
 */
const NEVER_READ = new Set(['.credentials.json', 'credentials.json', '.netrc', 'id_rsa', 'id_ed25519']);

const MAX_WALK_DEPTH = 6;
const MAX_FILE_BYTES = 4 * 1024 * 1024;

/**
 * @typedef {Object} ConfigFile
 * @property {string} path            absolute path
 * @property {string} display         path shown to the user
 * @property {'settings'|'mcp'|'memory'|'agent'|'skill'|'command'|'hook'|'keybindings'} kind
 * @property {'project'|'local'|'user'|'enterprise'} scope
 * @property {string} text
 * @property {unknown} [data]
 * @property {Map<string,{line:number,column:number}>} [positions]
 * @property {Record<string,unknown>|null} [frontmatter]
 * @property {number} [frontmatterLines]
 * @property {string} [body]
 * @property {{message:string,line:number,column:number}} [parseError]
 * @property {number} bytes
 * @property {number} mode
 * @property {number} gid
 * @property {number} uid
 */

/**
 * Collects every agent-configuration file in scope for a run.
 *
 * @param {string} root project root to scan
 * @param {{ includeUserScope?: boolean, home?: string }} [options]
 * @returns {{ root: string, files: ConfigFile[], gitignore: string|null, isGitRepo: boolean, skipped: string[] }}
 */
export function discover(root, options = {}) {
  const includeUserScope = options.includeUserScope !== false;
  const home = options.home ?? homedir();
  /** @type {ConfigFile[]} */
  const files = [];
  const skipped = [];

  const add = (path, kind, scope) => {
    if (!existsSync(path)) return;
    let stats;
    try {
      stats = statSync(path);
    } catch {
      return;
    }
    if (!stats.isFile()) return;
    if (NEVER_READ.has(basename(path))) {
      skipped.push(path);
      return;
    }
    if (stats.size > MAX_FILE_BYTES) {
      skipped.push(path);
      return;
    }
    if (files.some((f) => f.path === path)) return;

    let text;
    try {
      text = readFileSync(path, 'utf8');
    } catch (error) {
      skipped.push(path);
      return;
    }

    /** @type {ConfigFile} */
    const file = {
      path,
      display: displayPath(path, root, home),
      kind,
      scope,
      text,
      bytes: stats.size,
      mode: stats.mode,
      gid: stats.gid,
      uid: stats.uid,
    };

    if (kind === 'settings' || kind === 'mcp' || kind === 'keybindings') {
      try {
        const parsed = parseJsonWithPositions(text);
        file.data = parsed.value;
        file.positions = parsed.positions;
      } catch (error) {
        if (error instanceof JsonSyntaxError) {
          file.parseError = { message: error.message, line: error.line, column: error.column };
        } else {
          file.parseError = { message: String(error.message ?? error), line: 1, column: 1 };
        }
      }
    } else if (kind === 'agent' || kind === 'skill' || kind === 'command') {
      const fm = parseFrontmatter(text);
      file.frontmatter = fm.frontmatter;
      file.frontmatterLines = fm.frontmatterLines;
      file.body = fm.body;
    }

    files.push(file);
  };

  // --- project scope -------------------------------------------------------
  add(join(root, '.claude', 'settings.json'), 'settings', 'project');
  add(join(root, '.claude', 'settings.local.json'), 'settings', 'local');
  add(join(root, '.mcp.json'), 'mcp', 'project');
  add(join(root, '.claude', 'keybindings.json'), 'keybindings', 'project');
  addDirectory(join(root, '.claude', 'agents'), 'agent', 'project', add, '.md');
  addDirectory(join(root, '.claude', 'commands'), 'command', 'project', add, '.md');
  addSkills(join(root, '.claude', 'skills'), 'project', add);
  addDirectory(join(root, '.claude', 'hooks'), 'hook', 'project', add, null);

  for (const memory of findMemoryFiles(root)) {
    add(memory, 'memory', memory.includes('.local.md') ? 'local' : 'project');
  }

  // --- user scope ----------------------------------------------------------
  if (includeUserScope) {
    const userClaude = join(home, '.claude');
    add(join(userClaude, 'settings.json'), 'settings', 'user');
    add(join(userClaude, 'keybindings.json'), 'keybindings', 'user');
    add(join(userClaude, 'CLAUDE.md'), 'memory', 'user');
    addDirectory(join(userClaude, 'agents'), 'agent', 'user', add, '.md');
    addDirectory(join(userClaude, 'commands'), 'command', 'user', add, '.md');
    addSkills(join(userClaude, 'skills'), 'user', add);
    addDirectory(join(userClaude, 'hooks'), 'hook', 'user', add, null);
    // Credential file is intentionally recorded as skipped, never read.
    const cred = join(userClaude, '.credentials.json');
    if (existsSync(cred)) skipped.push(cred);
  }

  let gitignore = null;
  const gitignorePath = join(root, '.gitignore');
  if (existsSync(gitignorePath)) {
    try {
      gitignore = readFileSync(gitignorePath, 'utf8');
    } catch {
      gitignore = null;
    }
  }

  return {
    root,
    files,
    gitignore,
    isGitRepo: existsSync(join(root, '.git')),
    skipped,
  };
}

function addDirectory(dir, kind, scope, add, extension) {
  if (!existsSync(dir)) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      // Namespaced subdirectories are supported for agents and commands.
      if (kind === 'agent' || kind === 'command') {
        addDirectory(join(dir, entry.name), kind, scope, add, extension);
      }
      continue;
    }
    if (extension && !entry.name.endsWith(extension)) continue;
    add(join(dir, entry.name), kind, scope);
  }
}

function addSkills(dir, scope, add) {
  if (!existsSync(dir)) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    add(join(dir, entry.name, 'SKILL.md'), 'skill', scope);
  }
}

/** Walks the project for CLAUDE.md files, which can live at any depth. */
function findMemoryFiles(root, depth = 0) {
  const found = [];
  if (depth > MAX_WALK_DEPTH) return found;
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith('.') && entry.name !== '.claude') continue;
      found.push(...findMemoryFiles(join(root, entry.name), depth + 1));
      continue;
    }
    if (entry.name === 'CLAUDE.md' || entry.name === 'CLAUDE.local.md' || entry.name === 'AGENTS.md') {
      found.push(join(root, entry.name));
    }
  }
  return found;
}

function displayPath(path, root, home) {
  if (path.startsWith(root + sep)) return relative(root, path);
  if (path.startsWith(home + sep)) return '~' + sep + relative(home, path);
  return path;
}

export { NEVER_READ, SKIP_DIRS };
