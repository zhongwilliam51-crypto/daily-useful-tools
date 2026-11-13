import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {runInNewContext} from 'node:vm';

const html = readFileSync(new URL('./print-pages.html', import.meta.url), 'utf8');
const core = html.match(/<script id="print-pages-core">([\s\S]*?)<\/script>/)[1];
const arrange = runInNewContext(core + '\narrangePrintPages');
const run = (source, filter = 'all', total = '12') => arrange(total, source, filter);

test('deduplicates and combines sorted adjacent pages in the example', () => {
  const result = run('1, 3-5, 4, 8\n10-12');
  assert.equal(result.text, '1,3-5,8,10-12');
  assert.equal(result.count, 8);
  assert.equal(result.duplicates, 1);
});

test('keeps holes and supports repeated, nested and overlapping ranges', () => {
  const result = run('12, 3-6, 5-8, 6, 1, 12');
  assert.equal(result.text, '1,3-8,12');
  assert.equal(result.duplicates, 4);
  assert.equal(result.count, 8);
});

test('filters only within the selected pages and keeps parity gaps', () => {
  assert.equal(run('2-6,10-12', 'odd').text, '3,5,11');
  assert.equal(run('2-6,10-12', 'even').text, '2,4,6,10,12');
  const empty = run('1,3,5', 'even');
  assert.equal(empty.text, '');
  assert.equal(empty.count, 0);
  assert.equal(empty.uniqueCount, 3);
});

test('accepts Chinese punctuation, line endings, blanks and range separators', () => {
  assert.equal(run(' 12，3–5、4\r\n\n1,,8，10至11， ').text, '1,3-5,8,10-12');
  assert.equal(run('00001~00002').text, '1-2');
});

test('accepts exact single-page and maximum document boundaries', () => {
  assert.equal(run('1', 'all', '1').text, '1');
  assert.equal(run('1-10000', 'all', '10000').count, 10000);
  assert.equal(run('10000', 'even', '10000').text, '10000');
});

test('rejects reversed, incomplete and unsupported expressions', () => {
  for (const source of ['5-3', '3-', '-5', '1 2', '1.5', '1/2', '第3页']) {
    assert.throws(() => run(source), /第 1 项/);
  }
  assert.throws(() => run('1,13'), /第 2 项页码/);
  assert.throws(() => run('0'), /页码/);
});

test('validates total, filter, expression count and raw size caps', () => {
  for (const total of ['', '0', '10001', '12.0', '1e3']) assert.throws(() => run('1', 'all', total), /文件总页数/);
  assert.throws(() => run(',\n，'), /至少一个/);
  assert.throws(() => run('1', 'invalid'), /筛选方式/);
  assert.equal(run(Array(200).fill('1').join(',')).duplicates, 199);
  assert.throws(() => run(Array(201).fill('1').join(',')), /200 个/);
  assert.throws(() => run(' '.repeat(10001)), /10,000/);
});

test('ranges round-trip to the independently expanded selected pages', () => {
  for (let seed = 1; seed <= 150; seed += 1) {
    const expected = new Set();
    const expressions = [];
    for (let i = 0; i < 8; i += 1) {
      const a = 1 + (seed * 11 + i * 7) % 100;
      const b = Math.min(100, a + (seed + i) % 15);
      expressions.push(a + '-' + b);
      for (let p = a; p <= b; p += 1) expected.add(p);
    }
    for (const filter of ['all', 'odd', 'even']) {
      const result = run(expressions.join(','), filter, '100');
      const actual = [];
      for (const item of result.text.split(',').filter(Boolean)) {
        const [a, b = a] = item.split('-').map(Number);
        for (let p = a; p <= b; p += 1) actual.push(p);
      }
      const selected = [...expected].sort((a, b) => a - b).filter(p => filter === 'all' || (filter === 'odd' ? p % 2 === 1 : p % 2 === 0));
      assert.deepEqual(actual, selected);
      assert.equal(result.count, selected.length);
    }
  }
});

test('selects the full result while clipboard is pending and ignores stale completion', async () => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) {
      elements.set(id, {
        value: '', hidden: false, disabled: false, textContent: '', listeners: {},
        addEventListener(event, handler) { this.listeners[event] = handler; },
        setAttribute() {}, removeAttribute() {}, focus() {},
        select() { this.selectedText = this.value; },
      });
    }
    return elements.get(id);
  };
  let finishCopy;
  let requestedText;
  const uiScript = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)].at(-1)[1];
  runInNewContext(core + '\n' + uiScript, {
    document: {getElementById: element},
    navigator: {clipboard: {writeText(text) {
      requestedText = text;
      return new Promise(resolve => { finishCopy = resolve; });
    }}},
  });
  element('example').listeners.click();
  const copying = element('copy').listeners.click();
  assert.equal(requestedText, '1,3-5,8,10-12');
  assert.equal(element('output').selectedText, requestedText);
  assert.equal(element('copy-status').hidden, false);
  assert.match(element('copy-status').textContent, /手动复制/);
  element('settings').listeners.input();
  finishCopy();
  await copying;
  assert.equal(element('copy-status').hidden, true);
  assert.equal(element('copy').disabled, true);
});
