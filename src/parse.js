/**
 * Tolerant JSON parsing that records the source position of every value.
 *
 * Findings are only actionable if they point at a line, so the whole rule
 * engine is built on top of position-aware parses rather than JSON.parse.
 */

const WHITESPACE = new Set([' ', '\t', '\n', '\r']);

class JsonSyntaxError extends Error {
  constructor(message, line, column) {
    super(`${message} (line ${line}, column ${column})`);
    this.name = 'JsonSyntaxError';
    this.line = line;
    this.column = column;
  }
}

/**
 * @param {string} text
 * @returns {{ value: unknown, positions: Map<string, {line:number, column:number}> }}
 */
export function parseJsonWithPositions(text) {
  const positions = new Map();
  let i = 0;
  let line = 1;
  let lineStart = 0;

  const column = () => i - lineStart + 1;
  const here = () => ({ line, column: column() });

  const fail = (msg) => {
    throw new JsonSyntaxError(msg, line, column());
  };

  function advance(n = 1) {
    for (let k = 0; k < n; k += 1) {
      if (text[i] === '\n') {
        line += 1;
        lineStart = i + 1;
      }
      i += 1;
    }
  }

  function skipWhitespace() {
    while (i < text.length) {
      const ch = text[i];
      if (WHITESPACE.has(ch)) {
        advance();
        continue;
      }
      // Comments are invalid JSON but common in hand-edited config; skip them
      // so a stray comment yields real findings instead of one parse error.
      if (ch === '/' && text[i + 1] === '/') {
        while (i < text.length && text[i] !== '\n') advance();
        continue;
      }
      if (ch === '/' && text[i + 1] === '*') {
        advance(2);
        while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) advance();
        advance(2);
        continue;
      }
      return;
    }
  }

  function parseString() {
    if (text[i] !== '"') fail('Expected a string');
    advance();
    let out = '';
    while (i < text.length && text[i] !== '"') {
      if (text[i] === '\\') {
        advance();
        const esc = text[i];
        if (esc === undefined) fail('Unterminated escape sequence');
        if (esc === 'u') {
          const hex = text.slice(i + 1, i + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('Invalid unicode escape');
          out += String.fromCharCode(parseInt(hex, 16));
          advance(5);
          continue;
        }
        const simple = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
        if (!(esc in simple)) fail('Invalid escape character \\' + esc);
        out += simple[esc];
        advance();
        continue;
      }
      out += text[i];
      advance();
    }
    if (text[i] !== '"') fail('Unterminated string');
    advance();
    return out;
  }

  function parseNumber() {
    const start = i;
    if (text[i] === '-') advance();
    while (i < text.length && /[0-9]/.test(text[i])) advance();
    if (text[i] === '.') {
      advance();
      while (i < text.length && /[0-9]/.test(text[i])) advance();
    }
    if (text[i] === 'e' || text[i] === 'E') {
      advance();
      if (text[i] === '+' || text[i] === '-') advance();
      while (i < text.length && /[0-9]/.test(text[i])) advance();
    }
    const raw = text.slice(start, i);
    const num = Number(raw);
    if (raw === '' || !Number.isFinite(num)) fail('Invalid number "' + raw + '"');
    return num;
  }

  function parseLiteral() {
    for (const [word, value] of [['true', true], ['false', false], ['null', null]]) {
      if (text.startsWith(word, i)) {
        advance(word.length);
        return value;
      }
    }
    return fail('Unexpected token "' + (text[i] ?? 'EOF') + '"');
  }

  function parseValue(path) {
    skipWhitespace();
    positions.set(path, here());
    const ch = text[i];
    if (ch === '{') return parseObject(path);
    if (ch === '[') return parseArray(path);
    if (ch === '"') return parseString();
    if (ch === '-' || (ch >= '0' && ch <= '9')) return parseNumber();
    return parseLiteral();
  }

  function parseObject(path) {
    advance(); // {
    const out = {};
    skipWhitespace();
    if (text[i] === '}') {
      advance();
      return out;
    }
    for (;;) {
      skipWhitespace();
      const keyPos = here();
      const key = parseString();
      const childPath = path ? path + '.' + key : key;
      positions.set(childPath + ' key', keyPos);
      skipWhitespace();
      if (text[i] !== ':') fail('Expected ":" after key "' + key + '"');
      advance();
      out[key] = parseValue(childPath);
      skipWhitespace();
      if (text[i] === ',') {
        advance();
        skipWhitespace();
        if (text[i] === '}') { advance(); return out; } // tolerate trailing comma
        continue;
      }
      if (text[i] === '}') {
        advance();
        return out;
      }
      fail('Expected "," or "}" in object');
    }
  }

  function parseArray(path) {
    advance(); // [
    const out = [];
    skipWhitespace();
    if (text[i] === ']') {
      advance();
      return out;
    }
    for (;;) {
      out.push(parseValue(path + '[' + out.length + ']'));
      skipWhitespace();
      if (text[i] === ',') {
        advance();
        skipWhitespace();
        if (text[i] === ']') { advance(); return out; } // tolerate trailing comma
        continue;
      }
      if (text[i] === ']') {
        advance();
        return out;
      }
      fail('Expected "," or "]" in array');
    }
  }

  skipWhitespace();
  if (i >= text.length) throw new JsonSyntaxError('File is empty', 1, 1);
  const value = parseValue('');
  skipWhitespace();
  if (i < text.length) fail('Unexpected trailing content after top-level value');
  return { value, positions };
}

/**
 * Splits YAML-ish frontmatter off a markdown file. Agent and skill definitions
 * carry their config in frontmatter, so this is the entry point for both.
 *
 * @param {string} text
 * @returns {{ frontmatter: Record<string, unknown>|null, frontmatterLines: number, body: string, raw: string|null }}
 */
export function parseFrontmatter(text) {
  const normalized = text.replace(/^\uFEFF/, '');
  if (!/^---\r?\n/.test(normalized)) {
    return { frontmatter: null, frontmatterLines: 0, body: normalized, raw: null };
  }
  const lines = normalized.split(/\r?\n/);
  let end = -1;
  for (let n = 1; n < lines.length; n += 1) {
    if (lines[n].trim() === '---') {
      end = n;
      break;
    }
  }
  if (end === -1) {
    return { frontmatter: null, frontmatterLines: 0, body: normalized, raw: null };
  }
  const raw = lines.slice(1, end);
  return {
    frontmatter: parseSimpleYaml(raw),
    frontmatterLines: end + 1,
    body: lines.slice(end + 1).join('\n'),
    raw: raw.join('\n'),
  };
}

/**
 * Deliberately small YAML subset: scalars, inline lists, dash lists and one
 * level of nesting. That covers every documented agent/skill frontmatter field
 * without taking on a YAML dependency in a security tool.
 */
export function parseSimpleYaml(lines) {
  const root = {};
  const lineOf = {};
  let currentKey = null;
  let listTarget = null;
  let nested = null;
  let nestedIndent = 0;

  lines.forEach((rawLine, index) => {
    const line = rawLine.replace(/\s+$/, '');
    if (!line.trim() || line.trim().startsWith('#')) return;
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();

    if (trimmed.startsWith('- ')) {
      const item = stripQuotes(trimmed.slice(2).trim());
      if (nested && listTarget && nested[listTarget] !== undefined) {
        if (!Array.isArray(nested[listTarget])) nested[listTarget] = [];
        nested[listTarget].push(item);
      } else if (currentKey) {
        if (!Array.isArray(root[currentKey])) root[currentKey] = [];
        root[currentKey].push(item);
      }
      return;
    }

    const match = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(trimmed);
    if (!match) return;
    const key = match[1];
    const rest = match[2];

    if (indent > 0 && nested && indent >= nestedIndent) {
      nested[key] = rest === '' ? {} : coerceScalar(rest);
      listTarget = rest === '' ? key : null;
      return;
    }

    lineOf[key] = index + 2; // +1 for the opening ---, +1 for 1-based lines
    if (rest === '') {
      root[key] = {};
      nested = root[key];
      nestedIndent = indent + 1;
      currentKey = key;
      listTarget = null;
      return;
    }
    root[key] = coerceScalar(rest);
    nested = null;
    currentKey = key;
    listTarget = null;
  });

  Object.defineProperty(root, '__lines', { value: lineOf, enumerable: false });
  return root;
}

function stripQuotes(value) {
  if (value.length >= 2 && ((value[0] === '"' && value.at(-1) === '"') || (value[0] === "'" && value.at(-1) === "'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function coerceScalar(rest) {
  const value = stripQuotes(rest.trim());
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((part) => stripQuotes(part.trim()));
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value !== '' && !Number.isNaN(Number(value)) && /^-?[0-9.]+$/.test(value)) return Number(value);
  return value;
}

export { JsonSyntaxError };
