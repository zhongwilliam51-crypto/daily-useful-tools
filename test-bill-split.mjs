import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
const html = readFileSync(new URL('./bill-split.html', import.meta.url), 'utf8');
const source = html.match(/<script id="bill-split-core">([\s\S]*?)<\/script>/)[1];
const { splitBill, parseBillCents, billMoney } = runInNewContext(source + '\n({ splitBill, parseBillCents, billMoney })');
const people = (...weights) => weights.map((weight, index) => ({ name: 'P' + index, weight: String(weight) }));

test('splits an equal three-person bill without losing a cent', () => {
  const r = splitBill('128.00', people(1, 1, 1), 0);
  assert.equal(r.allocations.map(p => p.cents).join(','), '4267,4267,4266');
  assert.equal(r.received, 8533n); assert.equal(r.transfers.length, 2);
});
test('weighted shares allocate largest fractional remainders first', () => {
  const r = splitBill('1.00', people(1, 2, 3), 1);
  assert.equal(r.allocations.map(p => p.cents).join(','), '17,33,50');
  assert.equal(r.payer.name, 'P1'); assert.equal(r.received, 67n);
});
test('ties use input order and never reorder the displayed participants', () => {
  const r = splitBill('0.02', people(1, 1, 1), 2);
  assert.equal(r.allocations.map(p => p.cents).join(','), '1,1,0');
  assert.equal(r.allocations.map(p => p.name).join(','), 'P0,P1,P2');
});
test('very small bills omit zero transfers and can need no transfer at all', () => {
  const r = splitBill('0.01', people(1, 1, 1), 0);
  assert.equal(r.transfers.length, 0); assert.equal(r.received, 0n);
  assert.equal(splitBill('0.01', people(1, 1, 1), 2).transfers.length, 1);
});
test('handles exact divisions, decimal parsing and two-digit formatting', () => {
  assert.equal(parseBillCents(' 001.20 '), 120n);
  assert.equal(parseBillCents('1.2'), 120n);
  assert.equal(splitBill('30', people(1, 1, 1), 1).allocations[0].cents, 1000n);
  assert.equal(billMoney(1n), '0.01'); assert.equal(billMoney(100n), '1.00');
});
test('rejects empty, negative, zero, exponent, signed and excessive-precision totals', () => {
  for (const bad of ['', '-1', '0', '1.001', '1e2', 'NaN', 'Infinity', '1,000', '+1', '.5', null, '1000000.01']) assert.throws(() => parseBillCents(bad));
});
test('enforces people limits, valid payer and integer share weights', () => {
  assert.throws(() => splitBill('1', [], 0));
  assert.throws(() => splitBill('1', people(1), 0));
  assert.throws(() => splitBill('1', people(...Array(21).fill(1)), 0));
  for (const payer of [-1, 2, 0.5, '0', null]) assert.throws(() => splitBill('1', people(1, 1), payer));
  for (const weight of [0, -1, 1.5, 1001, '', '1e2', null]) assert.throws(() => splitBill('1', people(1, weight), 0));
});
test('requires distinguishable names including fallback-name collisions', () => {
  for (const names of [[' Alice ', 'alice'], ['成员 2', '']]) assert.throws(() => splitBill('1', names.map(name => ({name, weight:'1'})), 0), /重复/);
  assert.throws(() => splitBill('1', [{name:'bad\nname',weight:'1'}, {name:'ok',weight:'1'}], 0));
  assert.throws(() => splitBill('1', [{name:'x'.repeat(31),weight:'1'}, {name:'ok',weight:'1'}], 0));
});
test('supports unnamed people, Unicode and object-like names as plain strings', () => {
  const r = splitBill('1', [{name:'',weight:'1'}, {name:'__proto__',weight:'1'}, {name:'🍎 小陈',weight:'1'}], 0);
  assert.equal(r.allocations[0].name, '成员 1'); assert.equal(r.transfers[1].from, '🍎 小陈');
});
test('rejects incomplete member records', () => {
  for (const record of [null, 123, {}]) assert.throws(() => splitBill('1', [record, {name:'B',weight:'1'}], 0));
});
test('supports maximum amount, 20 people and 1000 shares', () => {
  const r = splitBill('1000000.00', people(...Array(20).fill(1000)), 19);
  assert.equal(r.cents, 100000000n); assert.equal(r.received, 95000000n);
});
test('500 varied bills conserve total cents and settlement amount', () => {
  let seed = 23;
  const next = () => (seed = (seed * 48271) % 2147483647);
  for (let i = 0; i < 500; i++) {
    const count = 2 + next() % 19, total = BigInt(1 + next() % 100000000);
    const members = people(...Array.from({length:count}, () => 1 + next() % 1000));
    const r = splitBill(billMoney(total), members, next() % count);
    assert.equal(r.allocations.reduce((sum,p) => sum+p.cents, 0n), total);
    assert.equal(r.transfers.reduce((sum,t) => sum+t.cents, 0n), r.received);
    assert.equal(r.received+r.payer.cents, total);
    const weightSum = members.reduce((sum,p) => sum+BigInt(p.weight), 0n);
    for (const p of r.allocations) {
      const floor = total*BigInt(p.weight)/weightSum;
      assert.ok(p.cents===floor || p.cents===floor+1n);
    }
  }
});
