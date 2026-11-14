import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {runInNewContext} from 'node:vm';

const html = readFileSync(new URL('./group-settle.html', import.meta.url), 'utf8');
const core = html.match(/<script id="group-settle-core">([\s\S]*?)<\/script>/)[1];
const settle = runInNewContext(core + '\nsettleGroup');
const plain = value => JSON.parse(JSON.stringify(value));

test('multiple payers settle without repaying already covered shares', () => {
  const result = settle('小林 360\n小周 180\n小陈 0');
  assert.equal(result.total, 54000);
  assert.deepEqual(plain(result.people.map(p => p.share)), [18000, 18000, 18000]);
  assert.deepEqual(plain(result.transfers), [{from: 2, to: 0, amount: 18000}]);
  assert.match(result.text, /小陈 → 小林：180\.00/);
});

test('a debtor can pay several creditors with positive transfers', () => {
  const result = settle('A 100\nB 80\nC 0\nD 20');
  assert.deepEqual(plain(result.transfers), [
    {from: 2, to: 0, amount: 5000}, {from: 3, to: 1, amount: 3000},
  ]);
  const split = settle('A 101\nB 100\nC 0');
  assert.deepEqual(plain(split.transfers), [
    {from: 2, to: 0, amount: 3400}, {from: 2, to: 1, amount: 3300},
  ]);
});

test('allocates integer cents and assigns remainder in input order', () => {
  const result = settle('A 10\nB 0\nC 0');
  assert.deepEqual(plain(result.people.map(p => p.share)), [334, 333, 333]);
  assert.equal(result.remainder, 1);
  assert.match(result.text, /前 1 人各多承担 0\.01/);
  const tiny = settle('A 0\nB 0\nC 0.02');
  assert.deepEqual(plain(tiny.people.map(p => p.share)), [1, 1, 0]);
  assert.equal(tiny.transfers.length, 2);
  assert.equal(settle('A 0.1\nB 0.2').total, 30);
});

test('zero expenses and equally paid groups need no transfers', () => {
  for (const source of ['A 0\nB 0', 'A 12.34\nB 12.34']) {
    const result = settle(source);
    assert.equal(result.transfers.length, 0);
    assert.match(result.text, /无需转账/);
  }
});

test('accepts spaces in names, blank lines, CRLF and normalized Unicode', () => {
  const result = settle('  Alex Lee  10.5\r\n\r\n小周\t0\r');
  assert.equal(result.people[0].name, 'Alex Lee');
  assert.equal(result.people[0].paid, 1050);
  assert.throws(() => settle(' e\u0301 1\né 2'), /重复/);
  assert.throws(() => settle(' A 1\nA 2'), /重复/);
  assert.equal(settle('A 1\na 2').people.length, 2);
});

test('rejects incomplete, negative, formatted and overprecision amounts', () => {
  for (const amount of ['', '-1', '1.001', '1e2', '1,000', '$3', '.5', '2.', 'NaN', 'Infinity', '1000000.01']) {
    assert.throws(() => settle('A 0\nB ' + amount), /第 2 项/);
  }
  assert.throws(() => settle('A 1\n2'), /第 2 项/);
  assert.throws(() => settle('A 1\nB ' + '9'.repeat(300)), /金额/);
  assert.equal(settle('A 000001.20\nB 0').total, 120);
});

test('validates names, controls, participants and maximum amounts', () => {
  assert.throws(() => settle('A 1'), /2–30/);
  assert.throws(() => settle(Array.from({length: 31}, (_, i) => `P${i} 0`).join('\n')), /2–30/);
  assert.throws(() => settle(' '.repeat(10001)), /10,000/);
  assert.throws(() => settle('A 0\n' + '字'.repeat(41) + ' 0'), /姓名/);
  assert.equal(settle('A 0\n' + '😀'.repeat(40) + ' 0').people.length, 2);
  for (const invalid of ['x\u0000', 'x\u202e', 'x\u2028', 'x\ud800']) {
    assert.throws(() => settle('A 0\n' + invalid + 'Y 0'), /姓名/);
  }
  const max = settle(Array.from({length: 30}, (_, i) => `P${i} 1000000`).join('\n'));
  assert.equal(max.total, 3000000000);
  assert.equal(max.transfers.length, 0);
});

test('500 accounts leave each participant paying exactly their share', () => {
  for (let seed = 1; seed <= 500; seed += 1) {
    const count = 2 + seed % 29;
    const cents = Array.from({length: count}, (_, i) => (seed * 7919 + i * 1523) % 100000001);
    const source = cents.map((paid, i) => `P${i} ${Math.floor(paid / 100)}.${String(paid % 100).padStart(2, '0')}`).join('\n');
    const result = settle(source);
    const total = cents.reduce((a, b) => a + b, 0);
    assert.equal(result.total, total);
    assert.equal(result.people.reduce((sum, p) => sum + p.share, 0), total);
    const net = [...cents];
    for (const t of result.transfers) {
      assert.ok(Number.isInteger(t.amount) && t.amount > 0);
      assert.notEqual(t.from, t.to);
      assert.ok(result.people[t.from].paid < result.people[t.from].share);
      assert.ok(result.people[t.to].paid > result.people[t.to].share);
      net[t.from] += t.amount;
      net[t.to] -= t.amount;
    }
    const sortedShares = net.slice().sort((a, b) => a - b);
    assert.ok(sortedShares.at(-1) - sortedShares[0] <= 1);
    assert.ok(result.transfers.length <= count - 1);
    assert.deepEqual(net, plain(result.people.map(p => p.share)));
    for (let i = 0; i < count; i += 1) {
      assert.equal(net[i], Math.floor(total / count) + (i < total % count ? 1 : 0));
    }
  }
});

test('copy selects full output while pending and input clears stale results', async () => {
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
  let resolveCopy;
  const ui = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)].at(-1)[1];
  runInNewContext(core + '\n' + ui, {
    document: {getElementById: element},
    navigator: {clipboard: {writeText() { return new Promise(resolve => { resolveCopy = resolve; }); }}},
  });
  element('example').listeners.click();
  const copying = element('copy').listeners.click();
  assert.equal(element('output').selectedText, element('output').value);
  assert.match(element('copy-status').textContent, /手动复制/);
  element('settings').listeners.input();
  assert.equal(element('output').value, '');
  assert.equal(element('copy').disabled, true);
  resolveCopy();
  await copying;
  assert.equal(element('copy-status').hidden, true);
});
