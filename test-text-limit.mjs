import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {runInNewContext} from 'node:vm';

const html = readFileSync(new URL('./text-limit.html', import.meta.url), 'utf8');
const core = html.match(/<script id="text-limit-core">([\s\S]*?)<\/script>/)[1];
const fit = runInNewContext(core + '\nfitText', {TextEncoder});
const emoji = '👩🏽‍💻';

test('a Chinese, ASCII and emoji mix has three distinct counts', () => {
  const {original, result} = fit('中a🙂', '3', 'characters');
  assert.deepEqual({...original}, {characters: 3, bytes: 8, units: 4});
  assert.equal(result, '中a🙂');
});

test('the example keeps only the prefix before the oversize emoji', () => {
  const {original, kept, result} = fit('周末见！' + emoji + '\n带上相机。', '20', 'bytes');
  assert.equal(result, '周末见！');
  assert.deepEqual({...original}, {characters: 11, bytes: 43, units: 17});
  assert.deepEqual({...kept}, {characters: 4, bytes: 12, units: 4});
});

test('exact byte and UTF-16 boundaries retain the whole grapheme', () => {
  assert.equal(fit('A' + emoji + 'B', '16', 'bytes').result, 'A' + emoji);
  assert.equal(fit('A' + emoji + 'B', '15', 'bytes').result, 'A');
  assert.equal(fit('A' + emoji + 'B', '8', 'units').result, 'A' + emoji);
  assert.equal(fit('A' + emoji + 'B', '7', 'units').result, 'A');
});

test('keeps flags, combining marks, keycaps and family emoji intact', () => {
  const clusters = ['🇭🇰', 'e\u0301', '1️⃣', '👨‍👩‍👦', '✈️'];
  const source = clusters.join('');
  for (let count = 0; count <= clusters.length; count += 1) {
    assert.equal(fit(source, String(count), 'characters').result, clusters.slice(0, count).join(''));
  }
});

test('preserves leading spaces, LF, trailing spaces and decomposed accents', () => {
  const source = ' \ne\u0301  ';
  assert.equal(fit(source, ' 005 ', 'characters').result, source);
  assert.equal(fit(source, '3', 'bytes').result, ' \n');
});

test('empty source, zero budget and an over-budget first grapheme', () => {
  assert.equal(fit('', '0', 'bytes').result, '');
  assert.equal(fit('中a', '0', 'characters').result, '');
  assert.equal(fit('中a', '2', 'bytes').result, '');
});

test('rejects missing, signed, fractional, exponential and excessive limits', () => {
  for (const limit of ['', ' ', '-1', '+1', '1.5', '1e2', '1,000', '100001', '１２']) {
    assert.throws(() => fit('test', limit, 'bytes'), /整数上限/);
  }
  assert.throws(() => fit('test', '8', 'words'), /计数方式/);
});

test('accepts the exact maximum and rejects oversized source without truncation', () => {
  const source = '🙂'.repeat(10000);
  assert.equal(fit(source, '100000', 'bytes').result, source);
  assert.throws(() => fit(source + 'a', '100000', 'bytes'), /分段处理/);
});

test('missing grapheme support fails explicitly', () => {
  const withoutSegmenter = runInNewContext(core + '\nfitText', {Intl: {}, TextEncoder});
  assert.throws(() => withoutSegmenter('a', '1', 'bytes'), /不支持完整字符分割/);
});

test('retains the longest grapheme prefix for every budget in a mixed sample', () => {
  const clusters = ['中', ' ', emoji, '\n', '🇭🇰', 'e\u0301', 'z'];
  const lengths = {
    characters: () => 1,
    bytes: text => Buffer.byteLength(text),
    units: text => text.length,
  };
  for (const [unit, size] of Object.entries(lengths)) {
    const total = clusters.reduce((sum, cluster) => sum + size(cluster), 0);
    for (let budget = 0; budget <= total + 1; budget += 1) {
      let expected = '';
      let used = 0;
      for (const cluster of clusters) {
        if (used + size(cluster) > budget) break;
        used += size(cluster);
        expected += cluster;
      }
      const fitted = fit(clusters.join(''), String(budget), unit);
      assert.equal(fitted.result, expected);
      assert.equal(fitted.kept[unit], used);
    }
  }
});
