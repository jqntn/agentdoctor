import {
  MEMORY_TOKEN_WARN, MEMORY_TOKEN_ERROR, TOTAL_MEMORY_TOKEN_WARN,
  MCP_SERVER_WARN_COUNT,
} from '../constants.js';

/**
 * Memory files and MCP tool schemas are re-sent on every single request, so
 * their size is a recurring cost rather than a one-off. These rules quantify
 * that instead of just saying "this file is long".
 */

/**
 * Cost model for always-on context.
 *
 * Memory files sit at the very front of the prompt, which is the most stable
 * part of it — so in practice they are cached rather than re-billed in full on
 * every turn. Pricing that ignores this overstates the cost by roughly an order
 * of magnitude, so the model below is explicit about it:
 *
 *   per session = 1 cache write (1.25x base) + (turns - 1) cache reads (0.1x base)
 *
 * The numbers are deliberately conservative and are labelled as estimates in
 * every message. The token count is the fact; the euro figure is a model, and
 * the assumptions are stated so a reader can disagree with them.
 */
const INPUT_USD_PER_MTOK = 3;      // Sonnet-tier base input price; Opus-tier is higher
const CACHE_WRITE_MULTIPLIER = 1.25; // 5-minute TTL
const CACHE_READ_MULTIPLIER = 0.1;
const SESSIONS_PER_DAY = 10;
const TURNS_PER_SESSION = 15;
const WORKING_DAYS_PER_MONTH = 22;

/**
 * Estimated monthly USD cost of keeping `tokens` in always-on context.
 * @param {number} tokens
 * @param {{ cached?: boolean }} [options] pass cached:false for the worst case
 */
export function monthlyCostEstimate(tokens, options = {}) {
  const cached = options.cached !== false;
  const perSession = cached
    ? CACHE_WRITE_MULTIPLIER + (TURNS_PER_SESSION - 1) * CACHE_READ_MULTIPLIER
    : TURNS_PER_SESSION;
  const billedTokens = tokens * perSession * SESSIONS_PER_DAY * WORKING_DAYS_PER_MONTH;
  return (billedTokens / 1_000_000) * INPUT_USD_PER_MTOK;
}

/** Requests per month implied by the assumptions above, for message text. */
const REQUESTS_PER_MONTH = SESSIONS_PER_DAY * TURNS_PER_SESSION * WORKING_DAYS_PER_MONTH;

const formatUsd = (value) => (value < 1 ? `$${value.toFixed(2)}` : `$${Math.round(value)}`);

export const costRules = [
  {
    id: 'cost/memory-file-too-large',
    category: 'cost',
    severity: 'warning',
    title: 'Memory file is large enough to cost real money',
    help: 'Move reference material into a skill or a linked file that gets read on demand. Memory files are prepended to every request, so their size multiplies by every turn you take.',
    check({ files, report, helpers }) {
      for (const file of files) {
        if (file.kind !== 'memory') continue;
        const tokens = helpers.estimateTokens(file.text);
        if (tokens < MEMORY_TOKEN_WARN) continue;
        const severity = tokens >= MEMORY_TOKEN_ERROR ? 'error' : 'warning';
        const monthly = monthlyCostEstimate(tokens);
        report({
          file,
          line: 1,
          severity,
          message: `${file.display} is ~${tokens.toLocaleString('en-US')} tokens of always-on context, sent with every request (~${formatUsd(monthly)}/month at ${REQUESTS_PER_MONTH.toLocaleString('en-US')} requests, assuming it stays prompt-cached).`,
        });
      }
    },
  },

  {
    id: 'cost/total-memory-budget',
    category: 'cost',
    severity: 'warning',
    title: 'Combined always-on context is heavy',
    help: 'Aim to keep the always-loaded total under a few thousand tokens. Everything here competes with the actual task for the model attention you are paying for.',
    check({ files, report, helpers, workspace }) {
      const memories = files.filter((f) => f.kind === 'memory');
      if (memories.length === 0) return;
      const total = memories.reduce((sum, f) => sum + helpers.estimateTokens(f.text), 0);
      if (total < TOTAL_MEMORY_TOKEN_WARN) return;
      const monthly = monthlyCostEstimate(total);
      const biggest = memories
        .map((f) => ({ f, t: helpers.estimateTokens(f.text) }))
        .sort((a, b) => b.t - a.t)[0];
      report({
        file: biggest.f,
        line: 1,
        message: `${memories.length} memory files total ~${total.toLocaleString('en-US')} tokens of always-on context (~${formatUsd(monthly)}/month cached, ~${formatUsd(monthlyCostEstimate(total, { cached: false }))} if cache misses are common). Largest: ${biggest.f.display} at ~${biggest.t.toLocaleString('en-US')}.`,
      });
    },
  },

  {
    id: 'cost/duplicated-memory-instructions',
    category: 'cost',
    severity: 'info',
    title: 'The same instruction appears in several memory files',
    help: 'Keep each instruction in exactly one file. Duplicates cost tokens twice and, worse, drift apart until they contradict each other.',
    check({ files, report, helpers }) {
      const memories = files.filter((f) => f.kind === 'memory');
      if (memories.length < 2) return;
      /** @type {Map<string, {file:any, line:number, text:string}[]>} */
      const index = new Map();
      for (const file of memories) {
        file.text.split(/\r?\n/).forEach((raw, i) => {
          const line = raw.trim();
          // Only compare substantive instruction lines, not headings or prose fragments.
          if (line.length < 40) return;
          if (line.startsWith('#') || line.startsWith('```') || line.startsWith('|')) return;
          const key = line.toLowerCase().replace(/\s+/g, ' ');
          if (!index.has(key)) index.set(key, []);
          index.get(key).push({ file, line: i + 1, text: line });
        });
      }
      for (const [key, hits] of index) {
        const byFile = new Map();
        for (const hit of hits) if (!byFile.has(hit.file.path)) byFile.set(hit.file.path, hit);
        if (byFile.size < 2) continue;
        // Report once per duplicated line rather than once per copy, on the
        // second file so the first occurrence reads as the canonical one.
        const [first, second, ...rest] = [...byFile.values()];
        const copies = byFile.size - 1;
        const wasted = helpers.estimateTokens(key) * copies;
        const elsewhere = rest.length > 0
          ? ` and ${rest.length} other file${rest.length === 1 ? '' : 's'}`
          : '';
        report({
          file: second.file,
          line: second.line,
          snippet: second.text.length > 80 ? `${second.text.slice(0, 77)}...` : second.text,
          message: `This line also appears in ${first.file.display}:${first.line}${elsewhere}, costing ~${wasted} duplicate tokens on every request.`,
        });
      }
    },
  },

  {
    id: 'cost/many-mcp-servers',
    category: 'cost',
    severity: 'warning',
    title: 'Many MCP servers enabled at once',
    help: 'Enable servers per project rather than globally. Every connected server contributes its tool schemas to the context window on every request, whether or not you use it.',
    check({ files, report, helpers }) {
      let count = 0;
      let target = null;
      let targetPath = null;
      for (const file of files) {
        const servers = file.data?.mcpServers;
        if (!servers || typeof servers !== 'object' || Array.isArray(servers)) continue;
        const names = Object.keys(servers);
        count += names.length;
        if (!target) {
          target = file;
          targetPath = 'mcpServers';
        }
      }
      if (count <= MCP_SERVER_WARN_COUNT || !target) return;
      const position = helpers.at(target, targetPath);
      report({
        file: target,
        line: position.line,
        column: position.column,
        configPath: targetPath,
        message: `${count} MCP servers are configured. Each one adds its tool definitions to every request, which crowds out the task and slows first token.`,
      });
    },
  },

  {
    id: 'cost/vague-skill-description',
    category: 'cost',
    severity: 'warning',
    title: 'Skill description gives the model nothing to match on',
    help: 'Write descriptions as trigger conditions: "Use when the user asks to X, mentions Y, or is working on Z." The description is the only signal the model has, so a vague one means the skill you wrote is never used.',
    check({ files, report, helpers }) {
      for (const file of files) {
        if (file.kind !== 'skill' || !file.frontmatter) continue;
        const description = file.frontmatter.description;
        if (typeof description !== 'string' || !description.trim()) continue;
        const words = description.trim().split(/\s+/).length;
        const hasTrigger = /\b(use (this )?(skill )?when|whenever|triggers? on|invoke when|for (tasks|requests)|if the user)\b/i.test(description);
        if (words >= 12 && hasTrigger) continue;
        const position = helpers.atFrontmatter(file, 'description');
        const reason = words < 12
          ? `only ${words} words long`
          : 'missing any "use when…" trigger phrasing';
        report({
          file,
          line: position.line,
          configPath: 'description',
          message: `Skill "${file.frontmatter.name ?? file.display}" has a description that is ${reason}, so the model has little reason to load it.`,
        });
      }
    },
  },

  {
    id: 'cost/vague-agent-description',
    category: 'cost',
    severity: 'info',
    title: 'Subagent description will not attract delegation',
    help: 'State what the agent is for and when to pick it. Orchestrators route on this string alone.',
    check({ files, report, helpers }) {
      for (const file of files) {
        if (file.kind !== 'agent' || !file.frontmatter) continue;
        const description = file.frontmatter.description;
        if (typeof description !== 'string' || !description.trim()) continue;
        if (description.trim().split(/\s+/).length >= 10) continue;
        const position = helpers.atFrontmatter(file, 'description');
        report({
          file,
          line: position.line,
          configPath: 'description',
          message: `Subagent "${file.frontmatter.name ?? file.display}" has a ${description.trim().split(/\s+/).length}-word description, which is rarely enough for a router to choose it correctly.`,
        });
      }
    },
  },

  {
    id: 'cost/memory-contains-generated-content',
    category: 'cost',
    severity: 'warning',
    title: 'Memory file contains content that belongs in a file, not in context',
    help: 'Reference the file by path instead of pasting it. The agent can read a path in one tool call; pasted content is paid for on every single request forever.',
    check({ files, report, helpers }) {
      for (const file of files) {
        if (file.kind !== 'memory') continue;
        const lines = file.text.split(/\r?\n/);
        let fenceStart = -1;
        let fenceLang = '';
        lines.forEach((line, index) => {
          const fence = /^```(\w+)?/.exec(line.trim());
          if (!fence) return;
          if (fenceStart === -1) {
            fenceStart = index;
            fenceLang = fence[1] ?? '';
            return;
          }
          const length = index - fenceStart - 1;
          // A long code block in a memory file is nearly always pasted source
          // or output that should be read on demand.
          if (length >= 40) {
            const block = lines.slice(fenceStart + 1, index).join('\n');
            const tokens = helpers.estimateTokens(block);
            report({
              file,
              line: fenceStart + 1,
              message: `A ${length}-line ${fenceLang || 'code'} block (~${tokens.toLocaleString('en-US')} tokens) is pasted into always-on context; reference the file path instead.`,
            });
          }
          fenceStart = -1;
          fenceLang = '';
        });
      }
    },
  },

  {
    id: 'cost/no-cleanup-period',
    category: 'cost',
    severity: 'info',
    title: 'Transcript retention never trimmed',
    help: 'Set cleanupPeriodDays to something like 30. Old transcripts are dead weight on disk and, if they contain customer data, a growing liability.',
    check({ files, report, helpers }) {
      const user = files.find((f) => f.kind === 'settings' && f.scope === 'user' && f.data);
      if (!user) return;
      if (user.data.cleanupPeriodDays !== undefined) return;
      report({
        file: user,
        line: 1,
        message: 'cleanupPeriodDays is unset, so session transcripts accumulate indefinitely.',
      });
    },
  },
];
