import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
const html = readFileSync(new URL('./list-cleaner.html', import.meta.url), 'utf8');
const source = html.match(/<script id="list-cleaner-core">([\s\S]*?)<\/script>/)[1];
const { cleanList } = runInNewContext(source + '\n({ cleanList })');

test('removes duplicates and blank lines, retaining first order', () => {
  const r = cleanList('燕麦\n牛奶\n燕麦\n\n 香蕉 \n牛奶\nbanana\nBanana');
  assert.equal(r.text, '燕麦\n牛奶\n香蕉\nbanana\nBanana');
  assert.equal(r.total, 8); assert.equal(r.kept, 5); assert.equal(r.duplicates, 2); assert.equal(r.blank, 1);
});
test('case folding is optional and preserves the first spelling', () => {
  assert.equal(cleanList('Alice\nalice\nALICE').kept, 3);
  const r = cleanList('Alice\nalice\nALICE', { ignoreCase: true });
  assert.equal(r.text, 'Alice'); assert.equal(r.duplicates, 2);
});
test('optional trimming changes keys and output, while internal spaces stay intact', () => {
  assert.equal(cleanList(' a \na\na  b\na b').text, 'a\na  b\na b');
  assert.equal(cleanList(' a \na\n  \t', { trim: false }).text, ' a \na');
});
test('handles Windows, Unix and old Mac line endings consistently', () => {
  const r = cleanList('a\r\nb\ra\n c \r\n');
  assert.equal(r.text, 'a\nb\nc'); assert.equal(r.total, 4);
});
test('terminal newline is a separator, additional empty lines still count', () => {
  assert.equal(cleanList('a\n').total, 1);
  assert.equal(cleanList('a\r\n').total, 1);
  assert.equal(cleanList('a\n\n').blank, 1);
  assert.equal(cleanList('\n').total, 1);
});
test('natural sorting is numeric and does not alter duplicate matching', () => {
  const r = cleanList('file10\nfile2\nfile1\nfile2', { order: 'natural' });
  assert.equal(r.text, 'file1\nfile2\nfile10'); assert.equal(r.duplicates, 1);
  assert.equal(cleanList('A\na', { order: 'natural' }).kept, 2);
});
test('does not parse commas, tabs, numbering or HTML', () => {
  const text = 'a,b\na\tb\n1. a\n<script>alert(1)</script>\na,b';
  assert.equal(cleanList(text).text, 'a,b\na\tb\n1. a\n<script>alert(1)</script>');
});
test('handles object-like keys, emoji and Chinese without collisions', () => {
  const r = cleanList('__proto__\nconstructor\n🍎\n张三\n🍎\n__proto__');
  assert.equal(r.text, '__proto__\nconstructor\n🍎\n张三'); assert.equal(r.duplicates, 2);
});
test('does not silently normalize Unicode variants', () => {
  assert.equal(cleanList('é\ne\u0301').kept, 2);
});
test('empty and whitespace-only input produces empty output', () => {
  assert.equal(cleanList('').total, 0);
  const r = cleanList(' \n\t\n　');
  assert.equal(r.text, ''); assert.equal(r.blank, 3); assert.equal(r.kept, 0);
});
test('enforces row and code-unit limits without partial output', () => {
  assert.equal(cleanList(Array(20000).fill('a').join('\n')).total, 20000);
  assert.throws(() => cleanList(Array(20001).fill('a').join('\n')), /20,000/);
  assert.equal(cleanList('x'.repeat(500000)).kept, 1);
  assert.throws(() => cleanList('x'.repeat(500001)), /500,000/);
});
test('rejects invalid types and unknown sorting modes', () => {
  assert.throws(() => cleanList(null));
  assert.throws(() => cleanList(123));
  assert.throws(() => cleanList('a', { order: 'wrong' }));
});
test('statistics reconcile and processing is idempotent', () => {
  for (const options of [{}, { trim: false }, { ignoreCase: true }, { order: 'natural' }]) {
    const r = cleanList(' A \nA\na\n \nb\nb\n', options);
    assert.equal(r.total, r.kept + r.duplicates + r.blank);
    assert.equal(cleanList(r.text, options).text, r.text);
  }
});
