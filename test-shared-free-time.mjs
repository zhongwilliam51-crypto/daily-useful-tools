import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {runInNewContext} from 'node:vm';

const html = readFileSync(new URL('./shared-free-time.html', import.meta.url), 'utf8');
const core = html.match(/<script id="shared-free-time-core">([\s\S]*?)<\/script>/)[1];
const {findSharedFreeTime: find, timeClock} = runInNewContext(core + '\n({findSharedFreeTime, timeClock})');
const describe = result => Array.from(result.slots, ({start, end, minutes}) => [timeClock(start), timeClock(end), minutes]);

test('finds both shared windows in chronological order', () => {
  const result = find('14:00-16:00\n9:00-11:30', '15:00-17:00\n10:30-12:00', '45');
  assert.deepEqual(describe(result), [['10:30', '11:30', 60], ['15:00', '16:00', 60]]);
  assert.equal(result.longest, 60);
});

test('merges overlapping, repeated and touching intervals before filtering', () => {
  const result = find('10:30-11:30\n9:00-10:00\n10:00-11:00\n9:00-10:00\n9:30-9:45', '9:30-10:15\n10:15-11:30', '120');
  assert.deepEqual(describe(result), [['09:30', '11:30', 120]]);
});

test('distinguishes no overlap from a too-short overlap', () => {
  const touching = find('9:00-10:00', '10:00-11:00', '1');
  assert.deepEqual(describe(touching), []);
  assert.equal(touching.longest, 0);
  const short = find('9:00-10:00', '9:59-11:00', '2');
  assert.deepEqual(describe(short), []);
  assert.equal(short.longest, 1);
});

test('handles full-day boundaries and inclusive duration limits', () => {
  assert.deepEqual(describe(find('00:00-24:00', '0:00 至 24:00', '1440')), [['00:00', '24:00', 1440]]);
  assert.deepEqual(describe(find('23:59–24:00', '22:00～24:00', '1')), [['23:59', '24:00', 1]]);
});

test('accepts the documented separators and ignores blank lines', () => {
  for (const separator of ['-', '–', '—', '~', '～', '至']) {
    assert.deepEqual(describe(find('\r\n  9:00 ' + separator + ' 10:00 \r\n', '9:30-10:30', ' 30 ')), [['09:30', '10:00', 30]]);
  }
});

test('rejects invalid clocks, reversed and zero spans with side and line', () => {
  for (const range of ['24:00-24:00', '10:00-24:01', '9:60-10:00', '23:00-1:00', '9:00-9:00', '09:00']) {
    assert.throws(() => find('9:00-10:00', '\n' + range, '1'), /对方第 2 行/);
  }
  assert.throws(() => find(' ', '9:00-10:00', '1'), /请填写我方/);
});

test('enforces positive integer duration and input caps', () => {
  for (const minimum of ['', '0', '1.5', '-1', '1441', '1e2']) {
    assert.throws(() => find('9:00-10:00', '9:00-10:00', minimum), /整数分钟/);
  }
  const row = '9:00-10:00';
  assert.equal(find(Array(100).fill(row).join('\n'), row, '1').slots.length, 1);
  assert.throws(() => find(Array(101).fill(row).join('\n'), row, '1'), /100 段/);
  assert.throws(() => find(' '.repeat(10001), row, '1'), /输入过长/);
});

test('matches independent minute-by-minute intersection over 150 mixed schedules', () => {
  let seed = 73;
  const next = max => {
    seed = (seed * 16807) % 2147483647;
    return seed % max;
  };
  for (let round = 0; round < 150; round += 1) {
    const makeSchedule = () => {
      const minutes = Array(1440).fill(false);
      const rows = [];
      for (let i = 0; i < 1 + round % 13; i += 1) {
        const start = next(1440);
        const end = Math.min(1440, start + 1 + next(240));
        rows.push(timeClock(start) + '-' + timeClock(end));
        minutes.fill(true, start, end);
      }
      return {text: rows.join('\n'), minutes};
    };
    const left = makeSchedule();
    const right = makeSchedule();
    const threshold = 1 + next(200);
    const expected = [];
    let longest = 0;
    for (let minute = 0; minute < 1440;) {
      if (!(left.minutes[minute] && right.minutes[minute])) {
        minute += 1;
        continue;
      }
      const start = minute;
      while (left.minutes[minute] && right.minutes[minute]) minute += 1;
      const length = minute - start;
      if (length >= threshold) expected.push([timeClock(start), timeClock(minute), length]);
      longest = Math.max(longest, length);
    }
    const actual = find(left.text, right.text, String(threshold));
    assert.deepEqual(describe(actual), expected);
    assert.equal(actual.longest, longest);
  }
});
