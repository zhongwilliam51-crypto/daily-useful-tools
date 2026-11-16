import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {runInNewContext} from 'node:vm';

const html = readFileSync(new URL('./subtitle-shift.html', import.meta.url), 'utf8');
const core = html.match(/<script id="subtitle-shift-core">([\s\S]*?)<\/script>/)[1];
const api = runInNewContext(core + '\n({shiftSubtitles, decodeSrtFile, formatSrtTime})', {TextDecoder});
const cue = (start, end, body = '正文', number = 1) => `${number}\n${start} --> ${end}\n${body}`;
const shift = (source, seconds = '1.5', direction = 'later') => api.shiftSubtitles(source, seconds, direction);

test('moves start and end with exact milliseconds across seconds and hours', () => {
  const result = shift(cue('00:59:59,750', '01:00:02,125'), '0.501');
  assert.match(result.text, /01:00:00,251 --> 01:00:02,626/);
  assert.equal(result.offset, 501);
  assert.equal(shift(cue('00:00:02,000', '00:00:04,000')).text,
    '1\r\n00:00:03,500 --> 00:00:05,500\r\n正文\r\n\r\n');
});

test('clips crossing cues at zero, drops cues ending at zero and reindexes', () => {
  const source = [cue('00:00:00,000', '00:00:01,000'), cue('00:00:01,000', '00:00:03,000', '留住'), cue('00:00:04,000', '00:00:05,000', '后一条')].join('\n\n');
  const result = shift(source, '1', 'earlier');
  assert.equal(result.original, 3);
  assert.equal(result.count, 2);
  assert.equal(result.removed, 1);
  assert.equal(result.clipped, 0);
  const partial = shift(source, '1.5', 'earlier');
  assert.equal(partial.clipped, 1);
  assert.match(partial.text, /^1\r\n00:00:00,000 --> 00:00:01,500/);
  assert.match(partial.text, /\r\n2\r\n00:00:02,500/);
  assert.equal(shift(source, '10', 'earlier').text, '');
});

test('preserves body, order and overlapping cues while normalizing encoding and numbering', () => {
  const source = '\uFEFF' + cue('00:00:02,000', '00:00:04,000', '  <i>中文 😀</i>  \nSecond line.\t', 7) + '\n\n' + cue('00:00:01,000', '00:00:03,000', '较早的条目仍放在后面', 3);
  const result = shift(source.replace(/\n/g, '\r'), '0');
  assert.match(result.text, /^1\r\n00:00:02,000/);
  assert.ok(result.text.includes('  <i>中文 😀</i>  \r\nSecond line.\t'));
  assert.match(result.text, /\r\n2\r\n00:00:01,000/);
  assert.ok(!result.text.startsWith('\uFEFF'));
  assert.ok(!/(?<!\r)\n/.test(result.text));
});

test('rejects malformed or unsupported blocks and identifies the cue', () => {
  for (const invalid of [
    cue('00:60:00,000', '00:61:00,000'), cue('0:00:00,000', '00:00:01,000'),
    cue('00:00:00.000', '00:00:01.000'), cue('00:00:02,000', '00:00:02,000'),
    cue('00:00:03,000', '00:00:02,000'), '1\n00:00:00,000 --> 00:00:01,000',
    '1\n00:00:00,000 --> 00:00:01,000 X1:1\ntext', 'WEBVTT\n\n00:00.000 --> 00:01.000\ntext',
  ]) assert.throws(() => shift(invalid), /第 1 条/);
  assert.throws(() => shift(cue('00:00:00,000', '00:00:01,000') + '\n\nwrong'), /第 2 条/);
  assert.throws(() => shift(' \n\n'), /至少/);
  assert.throws(() => shift(cue('00:00:00,000', '00:00:01,000', '\ud800')), /Unicode/);
});

test('validates offset and upper timestamp boundaries without partial output', () => {
  const source = cue('00:00:02,000', '00:00:03,000');
  for (const seconds of ['', '-1', '1e3', '0.0001', '3,600', '3600.001', '3601']) assert.throws(() => shift(source, seconds), /秒数/);
  assert.throws(() => shift(source, '1', 'invalid'), /方向/);
  assert.equal(shift(source, '3600').offset, 3600000);
  assert.match(shift(cue('99:59:59,000', '99:59:59,998'), '0.001').text, /99:59:59,999/);
  assert.throws(() => shift(cue('99:59:59,000', '99:59:59,999'), '0.001'), /超出/);
});

test('enforces text and cue caps and accepts their exact boundaries', () => {
  const line = cue('00:00:01,000', '00:00:02,000');
  assert.equal(shift(Array(5000).fill(line).join('\n\n')).count, 5000);
  assert.throws(() => shift(Array(5001).fill(line).join('\n\n')), /5,000/);
  assert.equal(shift(line + 'A'.repeat(1000000 - line.length)).count, 1);
  assert.throws(() => shift('A'.repeat(1000001)), /1,000,000/);
});

test('reads UTF-8 with BOM but rejects invalid encoding, oversized files and failed reads', async () => {
  const bytes = new TextEncoder().encode('\uFEFF中文 😀');
  assert.equal(await api.decodeSrtFile({size: bytes.length, arrayBuffer: async () => bytes.buffer}), '中文 😀');
  await assert.rejects(api.decodeSrtFile({size: 2097153, arrayBuffer() { throw Error('must not read'); }}), /2 MiB/);
  await assert.rejects(api.decodeSrtFile({size: 2, arrayBuffer: async () => new Uint8Array([0xff, 0xff]).buffer}), /UTF-8/);
  await assert.rejects(api.decodeSrtFile({size: 1, arrayBuffer: async () => { throw Error('read failed'); }}), /无法读取/);
});

test('300 round trips retain times, duration and all body characters', () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const start = 5000000 + seed * 7919;
    const end = start + 1 + seed * 13;
    const source = cue(api.formatSrtTime(start), api.formatSrtTime(end), `正文${seed} 😀\n  line 2  `);
    const offset = (seed * 997) % 3600000;
    const seconds = (offset / 1000).toFixed(3);
    const shifted = shift(source, seconds);
    assert.ok(shifted.text.includes(api.formatSrtTime(start + offset) + ' --> ' + api.formatSrtTime(end + offset)));
    const restored = shift(shifted.text, seconds, 'earlier');
    assert.equal(restored.text, shift(source, '0').text);
    assert.equal(restored.clipped, 0);
    assert.equal(restored.removed, 0);
  }
});

test('new input and examples cancel pending reads, and copy uses safe selection', async () => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', files: [], hidden: false, disabled: false, textContent: '', listeners: {},
      addEventListener(event, handler) { this.listeners[event] = handler; },
      setAttribute() {}, removeAttribute() {}, focus() {}, select() { this.selected = this.value; },
    });
    return elements.get(id);
  };
  let finishRead, finishCopy;
  const ui = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)].at(-1)[1];
  runInNewContext(core + '\n' + ui, {
    document: {getElementById: element}, TextDecoder,
    navigator: {clipboard: {writeText() { return new Promise(resolve => { finishCopy = resolve; }); }}},
  });
  element('file').files = [{size: 1, arrayBuffer: () => new Promise(resolve => { finishRead = resolve; })}];
  const reading = element('file').listeners.change();
  element('example').listeners.click();
  assert.match(element('output').value, /00:00:03,500/);
  finishRead(new TextEncoder().encode('old file').buffer);
  await reading;
  assert.ok(!element('source').value.includes('old file'));
  const copying = element('copy').listeners.click();
  assert.equal(element('output').selected, element('output').value);
  assert.match(element('copy-status').textContent, /手动复制/);
  element('settings').listeners.input();
  finishCopy(); await copying;
  assert.equal(element('copy-status').hidden, true);
  assert.equal(element('download').disabled, true);
});
