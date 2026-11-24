import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {runInNewContext} from 'node:vm';

const html = readFileSync(new URL('./duty-roster.html', import.meta.url), 'utf8');
const core = html.match(/<script id="duty-roster-core">([\s\S]*?)<\/script>/)[1];
const roster = runInNewContext(core + '\nbuildRoster');
const plain = value => JSON.parse(JSON.stringify(value));
const run = (names = '小林\n小周\n小陈', start = '2026-11-30', interval = '7', count = '6') => roster(names, start, interval, count);

test('weekly example cycles in order across the year and counts each member', () => {
  const result = run();
  assert.deepEqual(plain(result.entries.map(e => e.name)), ['小林','小周','小陈','小林','小周','小陈']);
  assert.equal(result.entries.at(-1).date, '2027-01-04');
  assert.ok(result.entries.every(e => e.weekday === '星期一'));
  assert.deepEqual(plain(result.totals.map(p => p.count)), [2,2,2]);
  assert.match(result.text, /2027-01-04（星期一） 小陈/);
});

test('daily mode includes weekends and handles leap days', () => {
  const result = run('A\nB', '2028-02-28', '1', '4');
  assert.deepEqual(plain(result.entries.map(e => e.date)), ['2028-02-28','2028-02-29','2028-03-01','2028-03-02']);
  const weekend = run('A\nB', '2026-11-27', '1', '4');
  assert.deepEqual(plain(weekend.entries.map(e => e.weekday)), ['星期五','星期六','星期日','星期一']);
});

test('counts partial rotations including members who have not had a turn', () => {
  assert.deepEqual(plain(run(undefined, undefined, '1', '1').totals.map(p => p.count)), [1,0,0]);
  assert.deepEqual(plain(run(undefined, undefined, '1', '5').totals.map(p => p.count)), [2,2,1]);
  assert.equal(run('下一位\n前一位', undefined, '7', '1').entries[0].name, '下一位');
});

test('normalizes line endings and names while rejecting duplicates and controls', () => {
  const result = run('  Alex Lee\r\n\r\n小周  \r\n');
  assert.equal(result.entries[0].name, 'Alex Lee');
  assert.throws(() => run('e\u0301\né'), /重复/);
  assert.throws(() => run(' A \nA'), /重复/);
  assert.equal(run('A\na').totals.length, 2);
  for (const control of ['x\u0000y','x\u202ey','x\u2028y','x\ud800y']) assert.throws(() => run('A\n' + control), /控制字符/);
});

test('enforces participant, name, raw size and count limits', () => {
  assert.throws(() => run('A'), /2–30/);
  assert.throws(() => run(Array.from({length:31}, (_,i) => `P${i}`).join('\n')), /2–30/);
  assert.throws(() => run(' '.repeat(5001)), /5,000/);
  assert.throws(() => run('A\n' + '字'.repeat(41)), /40/);
  assert.equal(run('A\n' + '😀'.repeat(40)).totals.length, 2);
  const max = run(Array.from({length:30}, (_,i) => `P${i}`).join('\n'), '1900-01-01', '7', '100');
  assert.equal(max.entries.length, 100);
  for (const count of ['', '0','101','1.5','1e2','-1']) assert.throws(() => run(undefined, undefined, '7', count), /次数/);
  assert.throws(() => run(undefined, undefined, '2'), /每日或每周/);
});

test('rejects invalid calendar dates and reports result-range overflow', () => {
  for (const date of ['2026-02-29','1900-02-29','2100-02-29','2026-13-01','2026-04-31','2026-1-01','', '1899-12-31']) assert.throws(() => run(undefined, date), /日期/);
  assert.equal(run('A\nB', '2100-12-31', '1', '1').entries[0].date, '2100-12-31');
  assert.throws(() => run('A\nB', '2100-12-31', '1', '2'), /最后一次/);
  assert.equal(run('A\nB', '2000-02-29', '7', '1').entries[0].weekday, '星期二');
});

test('400 schedules match independent date stepping, member order and turn totals', () => {
  for (let seed = 1; seed <= 400; seed += 1) {
    const names = Array.from({length:2 + seed % 29}, (_,i) => `成员${i}`);
    const count = 1 + seed % 100, interval = seed % 2 ? 1 : 7;
    const first = new Date(Date.UTC(2000 + seed % 60, seed % 12, 1 + seed % 28));
    const start = first.toISOString().slice(0,10);
    const result = run(names.join('\n'), start, String(interval), String(count));
    const cursor = new Date(first);
    const totals = Array(names.length).fill(0);
    for (let i = 0; i < count; i += 1) {
      assert.equal(result.entries[i].date, cursor.toISOString().slice(0,10));
      assert.equal(result.entries[i].name, names[i % names.length]);
      assert.equal(result.entries[i].weekday, '星期' + '日一二三四五六'[cursor.getUTCDay()]);
      totals[i % names.length] += 1;
      cursor.setUTCDate(cursor.getUTCDate() + interval);
    }
    assert.deepEqual(plain(result.totals.map(p => p.count)), totals);
    assert.equal(totals.reduce((a,b) => a+b,0), count);
    assert.ok(Math.max(...totals) - Math.min(...totals) <= 1);
  }
});

test('download builds the full UTF-8 roster and pending copy cannot restore stale output', async () => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value:'', hidden:false, disabled:false, textContent:'', listeners:{},
      addEventListener(event, handler) {this.listeners[event] = handler;},
      setAttribute() {}, removeAttribute() {}, focus() {},
      select() {this.selected = this.value;},
    });
    return elements.get(id);
  };
  let artifact, timer, revoked, completeCopy;
  const anchor = {click() {this.clicked = true;}};
  const ui = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)].at(-1)[1];
  runInNewContext(core + '\n' + ui, {
    document:{getElementById:element, createElement:() => anchor}, Blob,
    URL:{createObjectURL(blob) {artifact = blob; return 'blob:test';}, revokeObjectURL(url) {revoked = url;}},
    setTimeout(callback) {timer = callback;},
    navigator:{clipboard:{writeText() {return new Promise(resolve => {completeCopy = resolve;});}}},
  });
  element('example').listeners.click();
  element('download').listeners.click();
  assert.equal(anchor.clicked, true);
  assert.equal(anchor.download, 'roster.txt');
  assert.equal(artifact.type, 'text/plain;charset=utf-8');
  assert.equal(await artifact.text(), run().text);
  timer(); assert.equal(revoked, 'blob:test');
  const pending = element('copy').listeners.click();
  assert.equal(element('output').selected, run().text);
  element('settings').listeners.input();
  completeCopy(); await pending;
  assert.equal(element('output').value, '');
  assert.equal(element('download').disabled, true);
  assert.equal(element('copy-status').hidden, true);
});
