import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {runInNewContext} from 'node:vm';

const html = readFileSync(new URL('./hong-kong-time.html', import.meta.url), 'utf8');
const core = html.match(/<script id="hong-kong-time-core">([\s\S]*?)<\/script>/)[1];
const convert = runInNewContext(core + '\nconvertHongKongTime');
const get = (date, time, name) => convert(date, time).find(city => city.name === name);
const summary = moments => Array.from(moments, ({name, date, time, offsetMinutes, relative}) =>
  [name, date, time, offsetMinutes, relative]);

test('winter example shows six corresponding clocks and previous-day dates', () => {
  assert.deepEqual(summary(convert('2026-11-11', '09:00')), [
    ['伦敦', '2026-11-11', '01:00', 0, '同日'],
    ['纽约', '2026-11-10', '20:00', -300, '前一天'],
    ['洛杉矶', '2026-11-10', '17:00', -480, '前一天'],
    ['悉尼', '2026-11-11', '12:00', 660, '同日'],
    ['东京', '2026-11-11', '10:00', 540, '同日'],
    ['UTC', '2026-11-11', '01:00', 0, '同日'],
  ]);
});

test('summer uses the opposite northern and southern hemisphere offsets', () => {
  const result = convert('2026-07-01', '09:00');
  assert.deepEqual(Array.from(result, city => city.offsetMinutes), [60, -240, -420, 600, 540, 0]);
});

test('US spring transition skips from 01:59 to 03:00', () => {
  assert.equal(get('2026-03-08', '14:59', '纽约').time, '01:59');
  const after = get('2026-03-08', '15:00', '纽约');
  assert.equal(after.time, '03:00');
  assert.equal(after.offsetMinutes, -240);
});

test('US autumn repeated hour is distinguished by its UTC offset', () => {
  const first = get('2026-11-01', '13:30', '纽约');
  const second = get('2026-11-01', '14:30', '纽约');
  assert.equal(first.time, '01:30');
  assert.equal(second.time, '01:30');
  assert.equal(first.offsetMinutes, -240);
  assert.equal(second.offsetMinutes, -300);
});

test('London spring and Sydney spring boundaries convert minute by minute', () => {
  assert.equal(get('2026-03-29', '08:59', '伦敦').time, '00:59');
  assert.equal(get('2026-03-29', '09:00', '伦敦').time, '02:00');
  assert.equal(get('2026-10-04', '00:00', '悉尼').time, '03:00');
  assert.equal(get('2026-10-03', '23:59', '悉尼').time, '01:59');
});

test('midnight uses 00:00 and month, leap day and year boundaries have full dates', () => {
  const utc = get('2026-11-11', '08:00', 'UTC');
  assert.equal(utc.time, '00:00');
  assert.equal(utc.weekday, '周三');
  assert.equal(get('2024-03-01', '00:00', 'UTC').date, '2024-02-29');
  assert.equal(get('2026-01-01', '00:00', '纽约').date, '2025-12-31');
  const sydney = get('2026-12-31', '23:30', '悉尼');
  assert.equal(sydney.date, '2027-01-01');
  assert.equal(sydney.relative, '后一天');
});

test('accepts input range boundaries', () => {
  assert.equal(get('2000-01-01', '00:00', 'UTC').date, '1999-12-31');
  assert.equal(get('2099-12-31', '23:59', '东京').date, '2100-01-01');
});

test('rejects invalid dates and clocks without normalizing them silently', () => {
  for (const date of ['', '2026-2-01', '1999-12-31', '2100-01-01', '2026-02-29', '2024-04-31']) {
    assert.throws(() => convert(date, '12:00'), /日期/);
  }
  for (const time of ['', '9:00', '24:00', '12:60', '12:00:01']) {
    assert.throws(() => convert('2026-11-11', time), /时间/);
  }
});

test('unavailable time-zone support has an actionable error', () => {
  const unsupported = runInNewContext(core + '\nconvertHongKongTime', {
    Intl: {DateTimeFormat: function () {throw new Error('unsupported zone');}},
  });
  assert.throws(() => unsupported('2026-11-11', '09:00'), /无法读取所需时区数据/);
});
