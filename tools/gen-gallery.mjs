#!/usr/bin/env node
/**
 * Generates the Product Hunt / social gallery cards as SVG.
 *
 * These are rasterized with rsvg-convert, which resolves the generic
 * `monospace` family to DejaVu Sans Mono - noticeably wider than the
 * JetBrains Mono these were first laid out for. Text that fit in a browser
 * preview therefore clipped at the canvas edge once rendered.
 *
 * So every line is measured before it is emitted: `fits()` computes the advance
 * width at DejaVu Sans Mono metrics and the build fails loudly rather than
 * shipping a clipped card. Fixed-pitch metrics make this exact, not a guess.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'gallery');

const W = 1270;
const H = 760;
const MARGIN = 56;

/** DejaVu Sans Mono advance width, in em. Fixed pitch, so this is exact. */
const ADVANCE = 0.6022;

const MONO = "ui-monospace,'JetBrains Mono','SF Mono',SFMono-Regular,Menlo,Consolas,monospace";
const C = {
  bg: '#0B1220', panel: '#020617', border: '#1E293B',
  fg: '#E2E8F0', bright: '#F1F5F9', dim: '#94A3B8', dimmer: '#64748B',
  red: '#F87171', yellow: '#FBBF24', green: '#34D399', cyan: '#67E8F9', magenta: '#C084FC',
  lime: '#A3E635', orange: '#FB923C',
};

const width = (text, size) => text.length * ADVANCE * size;

const problems = [];
/** Records an overflow instead of silently emitting a clipped card. */
function fit(text, size, budget, where) {
  const w = width(text, size);
  if (w > budget) {
    problems.push(`${where}: "${text.slice(0, 46)}..." is ${Math.round(w)}px at ${size}px, budget ${Math.round(budget)}px`);
  }
  return text;
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function text(x, y, size, fill, content, { bold = false, anchor = null } = {}) {
  return `<text x="${x}" y="${y}" font-family="${MONO}" font-size="${size}"`
    + (bold ? ' font-weight="700"' : '')
    + (anchor ? ` text-anchor="${anchor}"` : '')
    + ` fill="${fill}" xml:space="preserve">${esc(content)}</text>`;
}

/** A terminal panel whose height is derived from its content. */
function terminal(x, y, w, lines, size, lh) {
  const inner = [];
  let cursor = y + 74;
  for (const line of lines) {
    if (line === null) { cursor += Math.round(lh * 0.45); continue; }
    let dx = x + 26;
    const spans = line.map(([content, fill]) => {
      const span = `<tspan x="${dx}" fill="${fill}">${esc(content)}</tspan>`;
      dx += width(content, size);
      return span;
    });
    // Whole assembled line must stay inside the panel.
    fit(line.map(([c]) => c).join(''), size, w - 52, 'terminal line');
    inner.push(`<text y="${cursor}" font-family="${MONO}" font-size="${size}" xml:space="preserve">${spans.join('')}</text>`);
    cursor += lh;
  }
  const h = cursor - y + 8;
  return {
    height: h,
    svg: `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16" fill="${C.panel}" stroke="${C.border}" stroke-width="2"/>`
      + `<circle cx="${x + 30}" cy="${y + 28}" r="7" fill="${C.red}"/>`
      + `<circle cx="${x + 54}" cy="${y + 28}" r="7" fill="${C.yellow}"/>`
      + `<circle cx="${x + 78}" cy="${y + 28}" r="7" fill="${C.green}"/>`
      + inner.join(''),
  };
}

function card(file, { headline, sub, lines, size = 19, lh = 30, footer }) {
  const HEAD = 38;
  const SUB = 21;
  fit(headline, HEAD, W - MARGIN * 2, `${file} headline`);
  fit(sub, SUB, W - MARGIN * 2, `${file} sub`);

  const term = terminal(MARGIN, 172, W - MARGIN * 2, lines, size, lh);
  const footerY = H - 30;
  if (172 + term.height > footerY - 26) {
    problems.push(`${file}: terminal overflows the canvas by ${Math.round(172 + term.height - (footerY - 26))}px`);
  }
  fit(footer, 20, W - MARGIN * 2, `${file} footer`);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(headline)}">
  <rect width="${W}" height="${H}" fill="${C.bg}"/>
  ${text(MARGIN, 82, HEAD, C.bright, headline, { bold: true })}
  ${text(MARGIN, 124, SUB, C.dim, sub)}
  ${term.svg}
  ${text(MARGIN, footerY, 20, '#475569', footer)}
</svg>
`;
  writeFileSync(join(OUT, file), svg);
  return file;
}

mkdirSync(OUT, { recursive: true });
const FOOT = 'npx @jqntn/agentdoctor  -  72 rules  -  zero dependencies  -  MIT';

card('1-silent-failures.svg', {
  headline: 'Agent config fails silently. This does not.',
  sub: 'A misspelled hook never fires. A bad deny rule blocks nothing. Neither errors.',
  footer: FOOT,
  lines: [
    [['$ ', C.green], ['npx @jqntn/agentdoctor', C.fg]],
    null,
    [['.claude/settings.json', C.cyan]],
    [['  5:7   ', C.dimmer], ['error', C.red], ['  "bash(curl:*)" targets unknown tool "bash".', C.fg]],
    [['               Did you mean "Bash"? This deny rule blocks nothing.', C.fg]],
    [['               correctness/permission-unknown-tool', C.magenta]],
    null,
    [['  17:21 ', C.dimmer], ['error', C.red], ['  "SubAgentStop" is not a hook event.', C.fg]],
    [['               Did you mean "SubagentStop"? This hook never runs.', C.fg]],
    [['               correctness/unknown-hook-event', C.magenta]],
    null,
    [['  14:51 ', C.dimmer], ['error', C.red], ['  Hook script ".claude/hooks/format.sh" is missing;', C.fg]],
    [['               the hook fails every time it fires.', C.fg]],
    [['               security/hook-script-not-executable', C.magenta]],
    null,
    [['Summary  ', C.fg], ['Grade F', C.red], ['  3 errors  - 72 rules in 14ms', C.dimmer]],
  ],
});

card('2-security.svg', {
  lh: 29,
  headline: 'The config surface is an execution surface.',
  sub: '22 security rules: pre-approved destructive commands, curl|sh hooks, leaked keys.',
  footer: FOOT,
  lines: [
    [['.claude/settings.json', C.cyan]],
    [['  4:7   ', C.dimmer], ['error', C.red], ['  "Bash(*)" auto-approves every shell command,', C.fg]],
    [['               including ones you have not seen.', C.fg]],
    [['               security/unrestricted-bash', C.magenta]],
    null,
    [['  20:51 ', C.dimmer], ['error', C.red], ['  SessionStart hook uses curl | sh; the remote', C.fg]],
    [['               content is executed unreviewed on every trigger.', C.fg]],
    [['               security/hook-remote-code', C.magenta]],
    null,
    [['  15:22 ', C.dimmer], ['error', C.red], ['  Live GitHub token committed in settings.', C.fg]],
    [['               | ghp_A9...4k (redacted)', C.cyan]],
    [['               security/secret-in-config', C.magenta]],
    null,
    [['.mcp.json', C.cyan]],
    [['  6:44  ', C.dimmer], ['warn ', C.yellow], ['  MCP server runs "mcp-scraper@latest" unpinned;', C.fg]],
    [['               its code can change under you between sessions.', C.fg]],
    [['               security/mcp-unpinned-package', C.magenta]],
  ],
});

card('3-policy-ci.svg', {
  lh: 29,
  headline: 'One policy file. Every repo held to it.',
  sub: 'Commit agentdoctor.policy.json and CI enforces the standard, with SARIF on the PR.',
  footer: FOOT,
  lines: [
    [['$ ', C.green], ['cat agentdoctor.policy.json', C.fg]],
    [['{ "requiredDeny":  ["Read(./.env*)", "Read(**/.ssh/**)"],', C.dim]],
    [['  "forbiddenAllow": ["Bash(*)", "Bash(**sudo**)"],', C.dim]],
    [['  "allowedMcpServers": ["github", "team-**"] }', C.dim]],
    null,
    [['$ ', C.green], ['npx @jqntn/agentdoctor --no-user', C.fg]],
    null,
    [['  3:15  ', C.dimmer], ['error', C.red], ['  "Bash(sudo systemctl restart api)" is forbidden', C.fg]],
    [['               by policy pattern "Bash(**sudo**)".', C.fg]],
    [['               policy/forbidden-allow', C.magenta]],
    null,
    [['  3:37  ', C.dimmer], ['error', C.red], ['  MCP server "randos-scraper" is not approved.', C.fg]],
    [['               policy/unapproved-mcp-server', C.magenta]],
    null,
    [['  1     ', C.dimmer], ['error', C.red], ['  Policy requires deny rule "Read(**/.ssh/**)".', C.fg]],
    [['               policy/missing-required-deny', C.magenta]],
    null,
    [['Summary  ', C.fg], ['3 errors', C.red], ['  - exit code 1, CI blocked', C.dimmer]],
  ],
});

// The grade card is laid out by hand: chips plus a share-card panel.
{
  const grades = [['A+', C.green], ['A', C.green], ['B', C.lime], ['C', C.yellow], ['D', C.orange], ['F', C.red]];
  let x = MARGIN;
  let chips = '';
  for (const [g, col] of grades) {
    const w = g.length > 1 ? 92 : 74;
    chips += `<rect x="${x}" y="164" width="${w}" height="70" rx="14" fill="#0F1A2E" stroke="${C.border}" stroke-width="2"/>`
      + text(x + w / 2, 211, 32, col, g, { bold: true, anchor: 'middle' });
    x += w + 16;
  }
  const share = [
    [['## agentdoctor grade: B', C.fg]],
    null,
    [['5 agent config files scanned - 2 warnings.', '#CBD5E1']],
    null,
    [['- `security/mcp-unpinned-package`', C.magenta]],
    [['- `cost/memory-file-too-large`', C.magenta]],
    null,
    [['Check your own agent config:', '#CBD5E1']],
    null,
    [['    npx @jqntn/agentdoctor', C.green]],
  ];
  const term = terminal(MARGIN, 292, 720, share, 19, 30);
  const headline = 'Every audit ends in a grade.';
  const sub = 'A+ zero findings - A info only - B/C warnings - D/F errors. What is yours?';
  fit(headline, 38, W - MARGIN * 2, 'grade headline');
  fit(sub, 21, W - MARGIN * 2, 'grade sub');

  // Segment widths derived from the rendered text, like shields.io does, so the
  // label can never run under the value segment.
  const BADGE_SIZE = 17;
  const PAD = 14;
  const LABEL_W = Math.ceil(width('agentdoctor', BADGE_SIZE) + PAD * 2);
  const VALUE_W = Math.ceil(width('A+', BADGE_SIZE) + PAD * 2);
  const badgeX = 830;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(headline)}">
  <rect width="${W}" height="${H}" fill="${C.bg}"/>
  ${text(MARGIN, 82, 38, C.bright, headline, { bold: true })}
  ${text(MARGIN, 124, 21, C.dim, sub)}
  ${chips}
  ${text(MARGIN, 268, 18, C.dimmer, '$ npx @jqntn/agentdoctor --share')}
  ${term.svg}
  <rect x="${badgeX}" y="292" width="340" height="196" rx="16" fill="#0F1A2E" stroke="${C.border}" stroke-width="2"/>
  ${text(badgeX + 28, 332, 18, C.dimmer, 'README badge:')}
  <rect x="${badgeX + 28}" y="354" width="${LABEL_W + VALUE_W}" height="40" rx="6" fill="#334155"/>
  <rect x="${badgeX + 28 + LABEL_W}" y="354" width="${VALUE_W}" height="40" rx="6" fill="${C.green}"/>
  <rect x="${badgeX + 28 + LABEL_W}" y="354" width="8" height="40" fill="#334155"/>
  ${text(badgeX + 28 + PAD, 381, BADGE_SIZE, C.bright, 'agentdoctor')}
  ${text(badgeX + 28 + LABEL_W + VALUE_W / 2, 381, BADGE_SIZE, '#04110B', 'A+', { bold: true, anchor: 'middle' })}
  ${text(badgeX + 28, 440, 17, C.dimmer, 'npx @jqntn/agentdoctor')}
  ${text(badgeX + 28, 464, 17, C.dimmer, '  --badge')}
  ${text(MARGIN, H - 30, 20, '#475569', 'rule ids and counts only - never paths or snippets - safe from private repos')}
</svg>
`;
  writeFileSync(join(OUT, '4-grade-share.svg'), svg);
  if (292 + term.height > H - 56) problems.push(`4-grade-share.svg: panel overflows by ${Math.round(292 + term.height - (H - 56))}px`);
}

if (problems.length) {
  console.error('Layout problems (these would render clipped):');
  for (const p of problems) console.error(`  - ${p}`);
  process.exitCode = 1;
} else {
  console.log('4 gallery cards written; every line measured to fit at DejaVu Sans Mono metrics');
}
