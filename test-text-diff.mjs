import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {runInNewContext} from 'node:vm';

const html = readFileSync(new URL('./text-diff.html', import.meta.url), 'utf8');
const core = html.match(/<script id="text-diff-core">([\s\S]*?)<\/script>/)[1];
const {compareText: compare, showWhitespace} = runInNewContext(core + '\n({compareText, showWhitespace})');
const plain = value => JSON.parse(JSON.stringify(value));
const reconstruct = (result, side) => result.chunks.filter(c => c.kind !== (side === 'before' ? 'add' : 'delete')).map(c => c.text).join('');

test('distinguishes insertions, deletions and replacement with surrounding context', () => {
  const result = compare('abc', 'axc');
  assert.deepEqual(plain(result.chunks), [
    {kind: 'keep', text: 'a'}, {kind: 'delete', text: 'b'},
    {kind: 'add', text: 'x'}, {kind: 'keep', text: 'c'},
  ]);
  assert.equal(result.added, 1);
  assert.equal(result.deleted, 1);
  assert.equal(result.kept, 2);
  assert.equal(compare('ac', 'abc').added, 1);
  assert.equal(compare('abc', 'ac').deleted, 1);
});

test('supports empty sides and identical content without manufacturing changes', () => {
  assert.equal(compare('', '').chunks.length, 0);
  assert.deepEqual(plain(compare('', '新增').chunks), [{kind: 'add', text: '新增'}]);
  assert.deepEqual(plain(compare('删除', '').chunks), [{kind: 'delete', text: '删除'}]);
  const same = compare('中文 A\nB', '中文 A\nB');
  assert.equal(same.added + same.deleted, 0);
  assert.equal(same.kept, same.beforeCount);
});

test('keeps complex emoji and combining marks intact as complete graphemes', () => {
  const before = '👩🏽‍💻e\u0301🇭🇰家';
  const after = '👩🏽‍💻e\u0301🇯🇵家';
  const result = compare(before, after);
  assert.equal(result.beforeCount, 4);
  assert.equal(result.afterCount, 4);
  assert.deepEqual(plain(result.chunks), [
    {kind: 'keep', text: '👩🏽‍💻e\u0301'}, {kind: 'delete', text: '🇭🇰'},
    {kind: 'add', text: '🇯🇵'}, {kind: 'keep', text: '家'},
  ]);
  assert.equal(compare('é', 'e\u0301').kept, 0);
});

test('preserves spaces, tabs and case while normalizing only line endings', () => {
  const result = compare(' A\tB\r\nC\r', ' a\tB\nC\n');
  assert.equal(result.added, 1);
  assert.equal(result.deleted, 1);
  assert.equal(reconstruct(result, 'before'), ' A\tB\nC\n');
  assert.equal(reconstruct(result, 'after'), ' a\tB\nC\n');
  assert.equal(compare('word ', 'word').deleted, 1);
  assert.equal(showWhitespace(' a\tb\nc\u00a0'), '·a⇥b↵\nc\u00a0');
});

test('repeated and reordered text remains reconstructible without assuming move semantics', () => {
  for (const [before, after] of [['ABAB', 'BABA'], ['甲乙甲', '甲甲乙'], ['first second', 'second first']]) {
    const result = compare(before, after);
    assert.equal(reconstruct(result, 'before'), before);
    assert.equal(reconstruct(result, 'after'), after);
    assert.ok(result.added > 0 && result.deleted > 0);
    assert.deepEqual(plain(compare(before, after)), plain(result));
  }
});

test('treats markup as literal text and retains all original characters', () => {
  const before = '<script>alert("a")</script> & <b>x</b>';
  const after = '<script>alert("b")</script> & <b>x</b>';
  const result = compare(before, after);
  assert.equal(reconstruct(result, 'before'), before);
  assert.equal(reconstruct(result, 'after'), after);
  assert.equal(result.added + result.deleted, 2);
});

test('enforces grapheme and raw-size caps and reports unsupported segmentation', () => {
  assert.equal(compare('字'.repeat(1500), '字'.repeat(1500)).kept, 1500);
  assert.equal(compare('👩🏽‍💻'.repeat(1500), '').deleted, 1500);
  assert.throws(() => compare('字'.repeat(1501), ''), /1,500/);
  assert.throws(() => compare('', '字'.repeat(1501)), /1,500/);
  assert.throws(() => compare('A'.repeat(20001), ''), /20,000/);
  assert.throws(() => compare('', 'A'.repeat(20001)), /20,000/);
  const longCluster = 'a' + '\u0301'.repeat(19999);
  assert.equal(compare(longCluster, '').beforeCount, 1);
  const unavailable = runInNewContext(core + '\ncompareText', {Intl: {}});
  assert.throws(() => unavailable('a', 'b'), /不支持/);
});

function subsequences(tokens) {
  const result = new Map();
  for (let mask = 0; mask < 2 ** tokens.length; mask += 1) {
    const selected = tokens.filter((_, i) => mask & 2 ** i);
    result.set(selected.join(''), selected.length);
  }
  return result;
}

test('200 short pairs match exhaustive subsequence costs and reconstruct both versions', () => {
  const alphabet = ['甲', '乙', 'A', '😀'];
  let state = 17;
  const next = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state; };
  for (let seed = 0; seed < 200; seed += 1) {
    const a = Array.from({length: next() % 8}, () => alphabet[(next() >>> 8) % alphabet.length]);
    const b = Array.from({length: next() % 8}, () => alphabet[(next() >>> 8) % alphabet.length]);
    const left = subsequences(a), right = subsequences(b);
    let longest = 0;
    for (const [value, count] of left) if (right.has(value)) longest = Math.max(longest, count);
    const result = compare(a.join(''), b.join(''));
    assert.equal(result.added + result.deleted, a.length + b.length - 2 * longest);
    assert.equal(result.kept, longest);
    assert.equal(result.kept + result.deleted, result.beforeCount);
    assert.equal(result.kept + result.added, result.afterCount);
    assert.equal(reconstruct(result, 'before'), a.join(''));
    assert.equal(reconstruct(result, 'after'), b.join(''));
    for (let i = 0; i < result.chunks.length; i += 1) {
      assert.ok(result.chunks[i].text.length > 0);
      if (i) assert.notEqual(result.chunks[i - 1].kind, result.chunks[i].kind);
    }
  }
});
