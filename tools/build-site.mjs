#!/usr/bin/env node
/**
 * Builds the static docs site into site/ from docs/*.md + assets/.
 *
 * No dependencies, no framework: a small markdown renderer, one stylesheet,
 * semantic HTML. The output is deliberately boring - it loads instantly, works
 * without JavaScript enabled, and every docs page is also served as raw
 * markdown so agents can skip the HTML entirely (see llms.txt).
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allRules, CATEGORIES } from '../src/rules/index.js';
import { VERSION } from '../src/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'site');
const BASE_URL = 'https://jqntn.github.io/agentdoctor';

/** Docs shown in the sidebar, in reading order. */
const DOCS = [
  ['getting-started', 'Getting started'],
  ['configuration', 'Configuration'],
  ['rules', 'Rule reference'],
  ['ci', 'CI setup'],
  ['baselines', 'Baselines'],
  ['policy', 'Team policy'],
  ['output', 'Output formats'],
  ['api', 'Programmatic API'],
  ['agents', 'For agents'],
  ['architecture', 'Architecture'],
  ['faq', 'FAQ'],
  ['privacy', 'Privacy'],
];

// ---------------------------------------------------------------------------
// Markdown -> HTML. Covers exactly what docs/*.md uses: headings, fenced code,
// tables, lists, blockquotes, hr, bold, inline code, links.
// ---------------------------------------------------------------------------
const escapeHtml = (s) => s.replace(/&(?![a-zA-Z]+;|#\d+;)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAll = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inline(text) {
  const codes = [];
  // Unicode Private Use Area as the placeholder sentinel: it cannot occur in
  // real markdown, and unlike a NUL it keeps this file plain text for grep,
  // git diff and editors. Written as escapes so the source stays ASCII.
  const SENTINEL = '\uE000';
  let out = text.replace(/`([^`]+)`/g, (_, code) => {
    codes.push(`<code>${escapeAll(code)}</code>`);
    return `${SENTINEL}${codes.length - 1}${SENTINEL}`;
  });
  out = escapeHtml(out)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
      // Cross-doc links: foo.md -> foo.html, keeping anchors.
      const fixed = href.replace(/^([a-z-]+)\.md(#[^)]*)?$/, '$1.html$2');
      const external = /^https?:/.test(fixed);
      return `<a href="${fixed}"${external ? ' rel="noopener"' : ''}>${label}</a>`;
    });
  return out.replace(new RegExp(`${SENTINEL}(\\d+)${SENTINEL}`, 'g'), (_, i) => codes[Number(i)]);
}

export function markdownToHtml(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let i = 0;
  const usedIds = new Set();

  const slug = (text) => {
    let id = text.toLowerCase().replace(/`/g, '').replace(/[^a-z0-9 -]/g, '').trim().replace(/\s+/g, '-');
    while (usedIds.has(id)) id += '-x';
    usedIds.add(id);
    return id;
  };

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      const buf = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i += 1;
      out.push(`<pre><code${lang ? ` class="language-${lang}"` : ''}>${escapeAll(buf.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2];
      const id = slug(text);
      out.push(`<h${level} id="${id}">${inline(text)}<a class="anchor" href="#${id}" aria-hidden="true">#</a></h${level}>`);
      i += 1;
      continue;
    }
    if (/^\|/.test(line) && /^\|[\s:|-]+\|$/.test(lines[i + 1] ?? '')) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = (row) => row.replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim()));
      const head = cells(rows[0]);
      const body = rows.slice(2).map(cells);
      out.push('<table><thead><tr>' + head.map((c) => `<th>${c}</th>`).join('') + '</tr></thead><tbody>'
        + body.map((r) => '<tr>' + r.map((c) => `<td>${c}</td>`).join('') + '</tr>').join('')
        + '</tbody></table>');
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) { out.push('<hr>'); i += 1; continue; }
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote><p>${inline(buf.join(' '))}</p></blockquote>`);
      continue;
    }
    const listMatch = /^(\s*)([-*]|\d+\.)\s+/.exec(line);
    if (listMatch) {
      const ordered = /\d/.test(listMatch[2]);
      const items = [];
      while (i < lines.length) {
        const m = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (m) { items.push(m[3]); i += 1; continue; }
        // continuation lines are indented
        if (/^\s{2,}\S/.test(lines[i]) && items.length) { items[items.length - 1] += ' ' + lines[i].trim(); i += 1; continue; }
        break;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>` + items.map((it) => `<li>${inline(it)}</li>`).join('') + `</${tag}>`);
      continue;
    }
    if (line.trim() === '') { i += 1; continue; }
    const buf = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() !== '' && !/^(#|```|\||>|\s*([-*]|\d+\.)\s|(-{3,})$)/.test(lines[i])) {
      buf.push(lines[i++]);
    }
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Page chrome
// ---------------------------------------------------------------------------
const CSS = readFileSync(join(ROOT, 'tools', 'site.css'), 'utf8');

function page({ title, description, body, path, isDocs }) {
  const rel = isDocs ? '../' : '';
  const canonical = `${BASE_URL}/${path}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeAll(title)}</title>
<meta name="description" content="${escapeAll(description)}">
<link rel="canonical" href="${canonical}">
<link rel="icon" type="image/svg+xml" href="${rel}favicon.svg">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeAll(title)}">
<meta property="og:description" content="${escapeAll(description)}">
<meta property="og:image" content="${BASE_URL}/og-card.svg">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'SoftwareApplication',
    name: 'agentdoctor', applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Linux, macOS, Windows', softwareVersion: VERSION,
    description: 'A linter for AI coding-agent configuration: permissions, hooks, MCP servers, skills and memory files.',
    license: 'https://opensource.org/license/mit', url: BASE_URL,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  })}</script>
<style>${CSS}</style>
</head>
<body${isDocs ? ' class="docs"' : ''}>
${body}
<script>
for (const pre of document.querySelectorAll('pre')) {
  const b = document.createElement('button');
  b.className = 'copy'; b.textContent = 'copy'; b.setAttribute('aria-label', 'Copy code');
  b.addEventListener('click', () => {
    navigator.clipboard.writeText(pre.querySelector('code').innerText);
    b.textContent = 'copied'; setTimeout(() => { b.textContent = 'copy'; }, 1200);
  });
  pre.appendChild(b);
}
</script>
</body>
</html>`;
}

const LOGO_INLINE = `<span class="mark" aria-hidden="true"><svg viewBox="0 0 128 128" width="30" height="30"><rect width="128" height="128" rx="28" fill="#0F172A"/><polyline points="30,46 48,64 30,82" fill="none" stroke="#34D399" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/><path d="M58 64 H67 L74 47 L86 83 L93 64 H101" fill="none" stroke="#34D399" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/><circle cx="108" cy="64" r="5.5" fill="#34D399"/></svg></span>`;

function header(rel) {
  return `<header class="top"><a class="brand" href="${rel}index.html">${LOGO_INLINE}<span>agent<em>doctor</em></span></a>
<nav><a href="${rel}docs/getting-started.html">Docs</a><a href="${rel}docs/rules.html">Rules</a><a href="${rel}llms.txt">llms.txt</a><a href="https://github.com/jqntn/agentdoctor" rel="noopener">GitHub</a></nav></header>`;
}

const FOOTER = `<footer><p>MIT licensed. Zero dependencies. No telemetry - this site has no analytics either.</p>
<p><a href="https://github.com/jqntn/agentdoctor" rel="noopener">GitHub</a> &middot; <a href="https://www.npmjs.com/package/@jqntn/agentdoctor" rel="noopener">npm</a> &middot; <a href="llms.txt">llms.txt</a> &middot; <a href="llms-full.txt">llms-full.txt</a></p>
<p class="badges"><a href="https://openhunts.com" target="_blank" title="OpenHunts Club">
  <img alt="OpenHunts Club Member" height="105" src="https://cdn.openhunts.com/badges/club.webp" style="width: 195px; height: auto;" width="486">
</a></p></footer>`;

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'docs'), { recursive: true });
mkdirSync(join(OUT, 'schemas'), { recursive: true });

// Assets
cpSync(join(ROOT, 'assets', 'favicon.svg'), join(OUT, 'favicon.svg'));
cpSync(join(ROOT, 'assets', 'og-card.svg'), join(OUT, 'og-card.svg'));
cpSync(join(ROOT, 'assets', 'logo-dark.svg'), join(OUT, 'logo-dark.svg'));
cpSync(join(ROOT, 'assets', 'logo-light.svg'), join(OUT, 'logo-light.svg'));
for (const f of readdirSync(join(ROOT, 'schemas'))) {
  cpSync(join(ROOT, 'schemas', f), join(OUT, 'schemas', f));
}

// Docs pages + raw markdown mirrors
const sidebar = (active) => `<aside><nav aria-label="Documentation">${DOCS.map(([slugName, label]) =>
  `<a href="${slugName}.html"${slugName === active ? ' class="active" aria-current="page"' : ''}>${label}</a>`).join('')}
<a class="raw" href="../llms.txt">llms.txt</a></nav></aside>`;

for (const [name, label] of DOCS) {
  const md = readFileSync(join(ROOT, 'docs', `${name}.md`), 'utf8');
  writeFileSync(join(OUT, 'docs', `${name}.md`), md);
  const description = (md.split('\n').find((l) => l.trim() && !l.startsWith('#')) ?? label)
    .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').slice(0, 155);
  const body = `${header('../')}<div class="layout">${sidebar(name)}<main><article>${markdownToHtml(md)}</article>
<p class="rawlink"><a href="${name}.md">View this page as markdown</a></p></main></div>${FOOTER.replace(/href="llms/g, 'href="../llms')}`;
  writeFileSync(join(OUT, 'docs', `${name}.html`), page({
    title: `${label} - agentdoctor`, description, body, path: `docs/${name}.html`, isDocs: true,
  }));
}

// Landing page
const count = (cat) => allRules.filter((r) => r.category === cat).length;
const DEMO = escapeAll(readFileSync(join(ROOT, 'tools', 'demo-output.txt'), 'utf8'));

const landingBody = `${header('')}
<section class="hero">
  <h1>Your agent&#8217;s config fails <em>silently</em>.<br>This does not.</h1>
  <p class="sub">agentdoctor lints AI coding-agent configuration &mdash; permissions, hooks, MCP servers,
  skills, memory files &mdash; and reports what is broken, dangerous, or expensive, with line numbers
  and fixes. Zero dependencies. No telemetry. MIT.</p>
  <div class="cta">
    <pre class="install"><code>npx @jqntn/agentdoctor</code></pre>
    <a class="btn" href="docs/getting-started.html">Get started</a>
    <a class="btn ghost" href="https://github.com/jqntn/agentdoctor" rel="noopener">Star on GitHub</a>
  </div>
</section>

<section class="terminal-wrap" aria-label="Example output">
  <div class="terminal"><div class="dots"><i class="r"></i><i class="y"></i><i class="g"></i></div><pre>${DEMO}</pre></div>
</section>

<section class="why">
  <h2>Nothing validates this config. The failures don&#8217;t error &mdash; they just don&#8217;t work.</h2>
  <div class="grid3">
    <div class="card"><h3><code>"SubAgentStop"</code></h3><p>One capital letter off. Valid JSON. The hook <strong>never fires</strong>, and nothing tells you.</p></div>
    <div class="card"><h3><code>"bash(curl:*)"</code></h3><p>A deny rule naming a tool that doesn&#8217;t exist <strong>blocks nothing</strong> &mdash; while looking exactly like a guardrail.</p></div>
    <div class="card"><h3><code>"Bash(*)"</code></h3><p>In an allow list, every command the model proposes <strong>runs without asking you</strong>. Including the ones you haven&#8217;t seen.</p></div>
  </div>
</section>

<section class="features">
  <h2>What it checks</h2>
  <p class="lede">The bar for a rule is that it catches a failure that actually happens
  <em>and</em> stays quiet on legitimate config &mdash; a correctly configured project reports
  nothing, asserted by a fixture in the test suite. False positives are treated as more severe
  than missed findings, because a linter that cries wolf gets uninstalled and then catches
  nothing at all. ${allRules.length} rules today, each with a test.</p>
  <div class="grid3">
    <div class="card"><h3>Security <span class="n">${count('security')}</span></h3><p>Pre-approved destructive commands, <code>curl | sh</code> hooks, committed credentials (always redacted), unpinned MCP packages, loader-hijacking env vars, world-writable config.</p></div>
    <div class="card"><h3>Correctness <span class="n">${count('correctness')}</span></h3><p>Invalid JSON that silently voids permission rules, misspelled keys and hook events with did-you-mean, dead deny rules, malformed hooks, duplicate agents.</p></div>
    <div class="card"><h3>Cost <span class="n">${count('cost')}</span></h3><p>Memory files priced in tokens and dollars &mdash; with stated caching assumptions &mdash; duplicated instructions, pasted code blocks, vague skill descriptions.</p></div>
    <div class="card"><h3>Hygiene <span class="n">${count('hygiene')}</span></h3><p>Ungitignored local settings, machine-specific paths in committed config, shadowed settings, empty skills.</p></div>
    <div class="card"><h3>Policy <span class="n">${count('policy')}</span></h3><p>Commit one <code>agentdoctor.policy.json</code> and every repo is held to it: required denies, forbidden allows, approved MCP servers, context budgets.</p></div>
    <div class="card"><h3>CI-native</h3><p>SARIF annotations on the PR diff, exit-code gating, and content-anchored baselines that survive unrelated edits.</p></div>
  </div>
</section>

<section class="agents">
  <h2>Built for agents, audited by agents</h2>
  <p>Deterministic, non-interactive, machine-readable end to end: <code>--json</code> with a
  shipped <a href="schemas/report.schema.json">JSON Schema</a>, <code>--explain</code> for every
  rule, secrets redacted in every format so findings are safe in model context. This site serves
  <a href="llms.txt">llms.txt</a> and every docs page as raw markdown. A ready-made
  <a href="docs/agents.html">Claude Code skill</a> turns findings into fixes.</p>
  <pre><code># the agentic fix loop
agentdoctor . --no-user --json     # findings, sorted most-severe-first
#   edit finding.file at finding.line (configPath names the exact key)
agentdoctor . --no-user --quiet    # exit 0 = verified fixed</code></pre>
</section>

<section class="grade-sec">
  <h2>Every audit ends in a grade</h2>
  <div class="grade-row" role="img" aria-label="Grades A+ through F">
    <span class="g gA">A+</span><span class="g gA">A</span><span class="g gB">B</span><span class="g gC">C</span><span class="g gD">D</span><span class="g gF">F</span>
  </div>
  <p><code>A+</code> zero findings &middot; <code>A</code> info only &middot; <code>B</code>/<code>C</code> warnings &middot; <code>D</code>/<code>F</code> errors.
  The formula fits in a sentence, because a grade nobody can explain is a grade nobody trusts.
  <code>--share</code> prints a paste-ready score card and <code>--badge</code> a README badge &mdash;
  both carry rule ids and counts only, never messages or paths, so they are safe to post from private repos.</p>
  <pre><code>npx @jqntn/agentdoctor --init-ci      # gate every PR: SARIF annotations + exit code
npx @jqntn/agentdoctor --init-skill   # let Claude Code audit and fix config itself
npx @jqntn/agentdoctor --badge        # show your grade in the README</code></pre>
</section>

<section class="quickstart">
  <h2>Sixty seconds to a verdict</h2>
  <pre><code>npx @jqntn/agentdoctor                    # audit this project + ~/.claude
npx @jqntn/agentdoctor --only security    # one category
npx @jqntn/agentdoctor --explain security/hook-remote-code
npx @jqntn/agentdoctor --init-policy      # start a team standard</code></pre>
  <p><a class="btn" href="docs/getting-started.html">Read the docs</a></p>
</section>
${FOOTER}`;

writeFileSync(join(OUT, 'index.html'), page({
  title: 'agentdoctor - lint your AI coding agent configuration',
  description: `A linter for AI coding-agent configuration: ${allRules.length} rules across permissions, hooks, MCP servers, skills and memory files. Zero dependencies, no telemetry, MIT.`,
  body: landingBody, path: '', isDocs: false,
}));

// llms.txt / llms-full.txt
const llms = [`# agentdoctor`, '',
  `> A linter for AI coding-agent configuration (.claude settings, hooks, permissions, MCP servers, skills, subagents, memory files). ${allRules.length} rules across ${CATEGORIES.join(', ')}. Zero dependencies, no network calls, MIT. CLI: \`npx @jqntn/agentdoctor\`; machine-readable via \`--json\` (schema: ${BASE_URL}/schemas/report.schema.json), \`--sarif\`, \`--list-rules --json\`, \`--explain <rule-id>\`. Exit codes: 0 clean, 1 errors, 2 usage.`, '',
  '## For agents: audit and adopt', '',
  'To audit a project: run `npx @jqntn/agentdoctor . --no-user --json`. Findings are sorted most-severe-first; each has `file`, `line`, `configPath` (the exact config key), `snippet` (the offending value, secrets redacted), and `help` (the fix). Apply fixes by editing the file at that location, then verify with `npx @jqntn/agentdoctor . --no-user --quiet` (exit 0 = clean). Suppress an intentional finding with an `agentdoctor-disable <rule-id>` comment in that file; never delete a deny rule to silence a finding.', '',
  'To install permanently (each command writes one file, refuses to overwrite, safe unattended):', '',
  '- `npx @jqntn/agentdoctor --init-ci` - GitHub Actions workflow: SARIF PR annotations + error gate',
  '- `npx @jqntn/agentdoctor --init-skill` - installs the config-audit skill (audit-and-fix workflow + per-rule fix recipes) into this project',
  '- Claude Code plugin (global): `/plugin marketplace add jqntn/agentdoctor` then `/plugin install agentdoctor` - adds the skill everywhere, invokable as /agentdoctor:config-audit',
  '- `npx @jqntn/agentdoctor --init-agents` - adds a marked audit section to AGENTS.md, read by OpenAI Codex, Cursor, Gemini CLI and other coding agents',
  '- `npx @jqntn/agentdoctor --write-baseline .agentdoctor-baseline.json` - only if findings exist today', '',
  '## Docs', '',
  ...DOCS.map(([name, label]) => `- [${label}](${BASE_URL}/docs/${name}.md)`),
  '', '## Optional', '',
  `- [Full documentation in one file](${BASE_URL}/llms-full.txt)`,
  `- [Policy file JSON Schema](${BASE_URL}/schemas/policy.schema.json)`,
  `- [Report JSON Schema](${BASE_URL}/schemas/report.schema.json)`,
  `- [Repository](https://github.com/jqntn/agentdoctor)`, ''].join('\n');
writeFileSync(join(OUT, 'llms.txt'), llms);

const full = DOCS.map(([name]) => readFileSync(join(ROOT, 'docs', `${name}.md`), 'utf8')).join('\n\n---\n\n');
writeFileSync(join(OUT, 'llms-full.txt'), `${llms}\n---\n\n${full}`);

// robots + sitemap
writeFileSync(join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${BASE_URL}/sitemap.xml\n`);
writeFileSync(join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
  + [`${BASE_URL}/`, ...DOCS.map(([n]) => `${BASE_URL}/docs/${n}.html`)]
    .map((u) => `  <url><loc>${u}</loc></url>`).join('\n') + '\n</urlset>\n');
writeFileSync(join(OUT, '.nojekyll'), '');

console.log(`site built: ${readdirSync(OUT).length} entries in site/, ${DOCS.length} doc pages, ${allRules.length} rules`);
