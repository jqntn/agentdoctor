import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonWithPositions, parseFrontmatter, JsonSyntaxError } from '../src/parse.js';

test('records the position of nested values', () => {
  const source = ['{', '  "permissions": {', '    "allow": ["Bash(*)", "Read(**)"]', '  }', '}'].join('\n');
  const { value, positions } = parseJsonWithPositions(source);
  assert.deepEqual(value, { permissions: { allow: ['Bash(*)', 'Read(**)'] } });
  assert.deepEqual(positions.get('permissions.allow[0]'), { line: 3, column: 15 });
  assert.deepEqual(positions.get('permissions.allow[1]'), { line: 3, column: 26 });
  assert.equal(positions.get('permissions key').line, 2);
});

test('tracks positions across multiple lines', () => {
  const source = ['{', '  "a": 1,', '  "b": {', '    "c": true', '  }', '}'].join('\n');
  const { positions } = parseJsonWithPositions(source);
  assert.equal(positions.get('a').line, 2);
  assert.equal(positions.get('b.c').line, 4);
});

test('parses all JSON scalar types', () => {
  const { value } = parseJsonWithPositions('{"s":"x","n":-1.5e3,"t":true,"f":false,"z":null,"a":[],"o":{}}');
  assert.deepEqual(value, { s: 'x', n: -1500, t: true, f: false, z: null, a: [], o: {} });
});

test('handles escape sequences', () => {
  const { value } = parseJsonWithPositions('{"a":"line\\nbreak\\ttab\\"quote\\\\slash\\u0041"}');
  assert.equal(value.a, 'line\nbreak\ttab"quote\\slashA');
});

test('tolerates trailing commas and comments, which hand-edited config often has', () => {
  assert.deepEqual(parseJsonWithPositions('{"a":1,}').value, { a: 1 });
  assert.deepEqual(parseJsonWithPositions('[1,2,]').value, [1, 2]);
  assert.deepEqual(parseJsonWithPositions('{\n// note\n"a":1\n}').value, { a: 1 });
  assert.deepEqual(parseJsonWithPositions('{/* note */"a":1}').value, { a: 1 });
});

test('reports syntax errors with a line and column', () => {
  assert.throws(() => parseJsonWithPositions('{"a": }'), (error) => {
    assert.ok(error instanceof JsonSyntaxError);
    assert.equal(error.line, 1);
    assert.equal(error.column, 7);
    return true;
  });
  assert.throws(() => parseJsonWithPositions('{\n  "a": 1\n  "b": 2\n}'), (error) => {
    assert.equal(error.line, 3);
    return true;
  });
  assert.throws(() => parseJsonWithPositions(''), /empty/i);
  assert.throws(() => parseJsonWithPositions('{"a":1} trailing'), /trailing/i);
  assert.throws(() => parseJsonWithPositions('{"a":"unterminated'), /Unterminated/);
});

test('parses frontmatter into scalars and lists', () => {
  const input = ['---', 'name: test-agent', 'description: Does a thing', 'tools: [Read, Edit]', 'model: sonnet', 'enabled: true', 'count: 3', '---', 'Body text'].join('\n');
  const { frontmatter, body, frontmatterLines } = parseFrontmatter(input);
  assert.equal(frontmatter.name, 'test-agent');
  assert.deepEqual(frontmatter.tools, ['Read', 'Edit']);
  assert.equal(frontmatter.enabled, true);
  assert.equal(frontmatter.count, 3);
  assert.equal(body.trim(), 'Body text');
  assert.equal(frontmatterLines, 8);
});

test('records frontmatter key line numbers for precise findings', () => {
  const input = ['---', 'name: a', 'description: b', '---', ''].join('\n');
  const { frontmatter } = parseFrontmatter(input);
  assert.equal(frontmatter.__lines.name, 2);
  assert.equal(frontmatter.__lines.description, 3);
});

test('parses dash lists', () => {
  const input = ['---', 'tools:', '  - Read', '  - Grep', '---', ''].join('\n');
  const { frontmatter } = parseFrontmatter(input);
  assert.deepEqual(frontmatter.tools, ['Read', 'Grep']);
});

test('returns null frontmatter when there is none', () => {
  assert.equal(parseFrontmatter('just a body').frontmatter, null);
  assert.equal(parseFrontmatter('---\nunterminated: true\n').frontmatter, null);
});

test('strips quotes from frontmatter values', () => {
  const { frontmatter } = parseFrontmatter('---\nname: "quoted"\nother: \'single\'\n---\n');
  assert.equal(frontmatter.name, 'quoted');
  assert.equal(frontmatter.other, 'single');
});
