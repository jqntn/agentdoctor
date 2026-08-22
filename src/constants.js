/**
 * Known-good vocabulary for agent harness config.
 *
 * These lists drive typo detection, so they are intentionally permissive:
 * anything unrecognised is reported at `info` unless it is a near-miss for a
 * real key, which is reported as a likely typo. New harness releases add keys,
 * and a linter that shouts about every unknown field is a linter people delete.
 */

export const SETTINGS_KEYS = new Set([
  'permissions', 'env', 'model', 'hooks', 'apiKeyHelper', 'cleanupPeriodDays',
  'includeCoAuthoredBy', 'enableAllProjectMcpServers', 'enabledMcpjsonServers',
  'disabledMcpjsonServers', 'statusLine', 'forceLoginMethod', 'outputStyle',
  'disableAllHooks', 'awsAuthRefresh', 'awsCredentialExport', 'otelHeadersHelper',
  'sandbox', 'agents', 'alwaysThinkingEnabled', 'spinnerTipsEnabled',
  'attributionSuffix', 'autoUpdates', 'installMethod', 'mcpServers',
  'extraKnownMarkdownFiles', 'schema', '$schema',
]);

export const PERMISSION_KEYS = new Set([
  'allow', 'deny', 'ask', 'defaultMode', 'additionalDirectories',
  'disableBypassPermissionsMode',
]);

export const PERMISSION_MODES = new Set([
  'default', 'acceptEdits', 'plan', 'bypassPermissions',
]);

export const HOOK_EVENTS = new Set([
  'PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Notification', 'Stop',
  'SubagentStop', 'PreCompact', 'SessionStart', 'SessionEnd',
]);

/** Hook events that receive a tool matcher; the rest ignore `matcher`. */
export const MATCHER_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PreCompact']);

export const TOOL_NAMES = new Set([
  'Agent', 'Task', 'Bash', 'BashOutput', 'KillBash', 'KillShell', 'Glob', 'Grep',
  'Read', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'NotebookRead',
  'WebFetch', 'WebSearch', 'TodoWrite', 'ExitPlanMode', 'SlashCommand', 'Skill',
  'ListMcpResources', 'ReadMcpResource',
]);

export const MODEL_ALIASES = new Set([
  'opus', 'sonnet', 'haiku', 'opusplan', 'inherit', 'default', 'fable',
]);

/** Tools that can read arbitrary local content. */
export const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'NotebookRead']);

/** Tools that can move data off the machine. */
export const EGRESS_TOOLS = new Set(['WebFetch', 'WebSearch', 'Bash']);

/** Tools that mutate the working tree. */
export const WRITE_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);

/**
 * Command fragments that are destructive or irreversible enough that a blanket
 * allow rule is very likely a mistake.
 */
export const DESTRUCTIVE_PATTERNS = [
  { pattern: /\brm\s+(-[a-zA-Z]*[rRf][a-zA-Z]*\s+)+/, label: 'recursive/forced delete (rm -rf)' },
  { pattern: /\bgit\s+push\s+.*(--force\b|-f\b)/, label: 'force push' },
  { pattern: /\bgit\s+reset\s+--hard\b/, label: 'hard reset (discards local work)' },
  { pattern: /\bgit\s+clean\s+-[a-zA-Z]*[fd]/, label: 'git clean (deletes untracked files)' },
  { pattern: /\bdd\s+.*\bof=/, label: 'raw disk write (dd)' },
  { pattern: /\bmkfs(\.|\s)/, label: 'filesystem format' },
  { pattern: /\bchmod\s+(-R\s+)?777\b/, label: 'chmod 777' },
  { pattern: /\bsudo\b/, label: 'privilege escalation (sudo)' },
  { pattern: /\bshutdown\b|\breboot\b|\bhalt\b/, label: 'host shutdown' },
  { pattern: /\bkubectl\s+delete\b/, label: 'kubectl delete' },
  { pattern: /\bterraform\s+(destroy|apply)\b/, label: 'terraform destroy/apply' },
  { pattern: /\baws\s+s3\s+rb\b|\baws\s+s3\s+rm\b.*--recursive/, label: 'recursive S3 delete' },
  { pattern: /\bdrop\s+(table|database)\b/i, label: 'SQL DROP' },
  { pattern: /\btruncate\s+table\b/i, label: 'SQL TRUNCATE' },
  { pattern: /\bnpm\s+publish\b|\bcargo\s+publish\b|\btwine\s+upload\b/, label: 'package publish' },
  { pattern: /\bgh\s+(pr|release)\s+(merge|create|delete)\b/, label: 'GitHub state change' },
  { pattern: /:\(\)\s*\{.*\}\s*;\s*:/, label: 'fork bomb' },
];

/**
 * Shell fragments that download and execute code in one step. These turn any
 * allowed hook or command into a remote-code-execution channel.
 */
export const REMOTE_EXEC_PATTERNS = [
  { pattern: /\b(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(ba|z|k|da)?sh\b/, label: 'curl | sh' },
  { pattern: /\b(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(python3?|node|perl|ruby)\b/, label: 'download piped to interpreter' },
  { pattern: /\bIEX\s*\(|\bInvoke-Expression\b/i, label: 'PowerShell Invoke-Expression' },
  { pattern: /\bNet\.WebClient\b/i, label: 'PowerShell remote download' },
  { pattern: /\beval\s+"?\$\((curl|wget)/, label: 'eval of remote output' },
  { pattern: /\bbash\s+<\(\s*(curl|wget)/, label: 'process substitution of remote script' },
  { pattern: /\bsource\s+<\(\s*(curl|wget)/, label: 'sourcing a remote script' },
];

/**
 * Secret shapes worth flagging. Each entry is anchored enough to avoid firing
 * on ordinary prose or placeholder text.
 */
export const SECRET_PATTERNS = [
  { pattern: /\bsk-ant-[A-Za-z0-9_-]{16,}/, label: 'Anthropic API key' },
  { pattern: /\bsk-(proj-)?[A-Za-z0-9]{32,}/, label: 'OpenAI-style API key' },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}/, label: 'GitHub token' },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{30,}/, label: 'GitHub fine-grained PAT' },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/, label: 'AWS access key id' },
  { pattern: /\bASIA[0-9A-Z]{16}\b/, label: 'AWS temporary access key id' },
  { pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/, label: 'Slack token' },
  { pattern: /\bAIza[0-9A-Za-z_-]{35}\b/, label: 'Google API key' },
  { pattern: /\bglpat-[A-Za-z0-9_-]{20,}/, label: 'GitLab personal access token' },
  { pattern: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, label: 'private key' },
  { pattern: /\bey[A-Za-z0-9_-]{10,}\.ey[A-Za-z0-9_-]{10,}\./, label: 'JWT' },
  { pattern: /\bsk_live_[A-Za-z0-9]{20,}/, label: 'Stripe live secret key' },
  { pattern: /\bnpm_[A-Za-z0-9]{36}\b/, label: 'npm access token' },
  { pattern: /\bhf_[A-Za-z0-9]{30,}/, label: 'Hugging Face token' },
];

/** Environment variables that change how child processes load code. */
export const DANGEROUS_ENV_VARS = new Map([
  ['LD_PRELOAD', 'injects a shared library into every child process'],
  ['LD_LIBRARY_PATH', 'redirects dynamic library resolution'],
  ['DYLD_INSERT_LIBRARIES', 'injects a dylib into every child process (macOS)'],
  ['NODE_OPTIONS', 'can preload arbitrary JavaScript into every Node process'],
  ['PYTHONSTARTUP', 'executes a file on every interactive Python start'],
  ['PATH', 'changes which binaries commands resolve to'],
  ['GIT_SSH_COMMAND', 'replaces the transport used for every git operation'],
  ['BASH_ENV', 'executes a file on every non-interactive bash start'],
]);

/** Paths that should generally be unreadable to an agent. */
export const SENSITIVE_READ_TARGETS = [
  '.env', '.env.*', '**/.ssh/**', '**/*.pem', '**/*.key',
  '**/.aws/credentials', '**/.kube/config', '**/.npmrc', '**/.netrc',
  '**/id_rsa', '**/.git-credentials',
];

/** Rough per-turn context budget before a memory file starts costing real money. */
export const MEMORY_TOKEN_WARN = 4000;
export const MEMORY_TOKEN_ERROR = 12000;
export const TOTAL_MEMORY_TOKEN_WARN = 10000;
export const MCP_SERVER_WARN_COUNT = 8;
