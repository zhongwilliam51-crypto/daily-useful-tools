import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {runInNewContext} from 'node:vm';

const html = readFileSync(new URL('./unwrap-text.html', import.meta.url), 'utf8');
const core = html.match(/<script id="unwrap-text-core">([\s\S]*?)<\/script>/)[1];
const unwrap = runInNewContext(core + '\nunwrapText');

test('joins Chinese wrapped lines without inserting spaces and preserves paragraphs', () => {
  const result = unwrap('复制来的正文经常因为排版\n出现多余的换行，读起来\n不太连贯。\n\n空行分隔的段落\n会保留下来。', 'direct');
  assert.equal(result.text, '复制来的正文经常因为排版出现多余的换行，读起来不太连贯。\n\n空行分隔的段落会保留下来。');
  assert.equal(result.nonempty, 5);
  assert.equal(result.paragraphs, 2);
  assert.equal(result.removed, 3);
});

test('space mode preserves English word boundaries and punctuation', () => {
  assert.equal(unwrap('Meet me\nat noon.\nBring water!', 'space').text, 'Meet me at noon. Bring water!');
  assert.equal(unwrap('Hello\n世界', 'space').text, 'Hello 世界');
  assert.equal(unwrap('Hello\n世界', 'direct').text, 'Hello世界');
});

test('normalizes CRLF, CR and LF and collapses only paragraph separators', () => {
  const result = unwrap('\r\n  A\rB\n\t \n\nC\r\nD\r\n\r\n', 'space');
  assert.equal(result.text, 'A B\n\nC D');
  assert.equal(result.paragraphs, 2);
  assert.equal(result.removed, 2);
});

test('trims each line while retaining internal spaces, tabs and Unicode', () => {
  const text = '  A  B\tC  \n\t👩🏽‍💻 e\u0301 中文\u00a0\n\n　第二段　';
  assert.equal(unwrap(text, 'space').text, 'A  B\tC 👩🏽‍💻 e\u0301 中文\n\n第二段');
  assert.equal(unwrap('单行保留！', 'direct').removed, 0);
});

test('does not silently repair hyphenation or interpret markup', () => {
  assert.equal(unwrap('well-\nknown\n\n<script>alert(1)</script>', 'space').text,
    'well- known\n\n<script>alert(1)</script>');
  assert.equal(unwrap('hy-\nphen', 'direct').text, 'hy-phen');
  assert.equal(unwrap('1. item\n2. item', 'space').text, '1. item 2. item');
});

test('rejects empty content, unsupported modes and over-limit input', () => {
  for (const source of ['', '\n\t\r\n　 ']) assert.throws(() => unwrap(source, 'direct'), /至少/);
  assert.throws(() => unwrap('A', 'auto'), /连接方式/);
  assert.throws(() => unwrap('A'.repeat(100001), 'direct'), /100,000/);
  assert.throws(() => unwrap('😀'.repeat(50001), 'direct'), /100,000/);
  assert.throws(() => unwrap('A\n'.repeat(5000), 'direct'), /5,000/);
});

test('accepts exact text and line limits, including CRLF logical lines', () => {
  assert.equal(unwrap('A'.repeat(100000), 'space').text.length, 100000);
  assert.equal(unwrap('😀'.repeat(50000), 'direct').text.length, 100000);
  const result = unwrap(Array(5000).fill('A').join('\r\n'), 'space');
  assert.equal(result.nonempty, 5000);
  assert.equal(result.removed, 4999);
  assert.equal(result.text, Array(5000).fill('A').join(' '));
});

test('300 generated paragraphs preserve line text, order, separation and counts', () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const paragraphs = Array.from({length: 1 + seed % 8}, (_, p) =>
      Array.from({length: 1 + (seed + p) % 7}, (_, l) => `段${p} line ${l} 😀 e\u0301  x`));
    const eol = ['\n', '\r\n', '\r'][seed % 3];
    const source = eol + paragraphs.map(lines => lines.map(line => '  ' + line + '\t').join(eol)).join(eol.repeat(2 + seed % 3)) + eol;
    for (const mode of ['direct', 'space']) {
      const result = unwrap(source, mode);
      const expected = paragraphs.map(lines => lines.join(mode === 'space' ? ' ' : '')).join('\n\n');
      assert.equal(result.text, expected);
      assert.equal(result.paragraphs, paragraphs.length);
      const lines = paragraphs.reduce((sum, p) => sum + p.length, 0);
      assert.equal(result.nonempty, lines);
      assert.equal(result.removed, lines - paragraphs.length);
      assert.equal(unwrap(result.text, mode).text, expected);
    }
  }
});

test('selects complete output during copy and invalidates it on input changes', async () => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', hidden: false, disabled: false, textContent: '', listeners: {},
      addEventListener(event, handler) { this.listeners[event] = handler; },
      setAttribute() {}, removeAttribute() {}, focus() {},
      select() { this.selectedText = this.value; },
    });
    return elements.get(id);
  };
  let completeCopy;
  const ui = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)].at(-1)[1];
  runInNewContext(core + '\n' + ui, {
    document: {getElementById: element},
    navigator: {clipboard: {writeText() { return new Promise(resolve => { completeCopy = resolve; }); }}},
  });
  element('example').listeners.click();
  const copying = element('copy').listeners.click();
  assert.equal(element('output').selectedText, element('output').value);
  assert.match(element('copy-status').textContent, /手动复制/);
  assert.equal(element('copy-status').hidden, false);
  element('settings').listeners.input();
  assert.equal(element('output').value, '');
  assert.equal(element('metrics').hidden, true);
  assert.equal(element('copy').disabled, true);
  completeCopy();
  await copying;
  assert.equal(element('copy-status').hidden, true);
});
