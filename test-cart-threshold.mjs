import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {runInNewContext} from 'node:vm';

const html = readFileSync(new URL('./cart-threshold.html', import.meta.url), 'utf8');
const core = html.match(/<script id="cart-threshold-core">([\s\S]*?)<\/script>/)[1];
const {compareCart, cartMoney} = runInNewContext(core + '\n({compareCart, cartMoney})');
const defaults = {current: '270', threshold: '300', reduction: '40', extra: '30'};
const compare = changes => compareCart({...defaults, ...changes});

test('crossing the threshold can reduce the total actually paid', () => {
  const result = compare();
  assert.equal(result.before, 27000);
  assert.equal(result.after, 26000);
  assert.equal(result.difference, -1000);
  assert.equal(result.gapBefore, 3000);
  assert.equal(result.gapAfter, 0);
});

test('larger extras can leave spending equal or higher despite the discount', () => {
  assert.equal(compare({extra: '40'}).difference, 0);
  assert.equal(compare({extra: '55'}).difference, 1500);
});

test('current qualifying order gets the same discount before adding items', () => {
  const result = compare({current: '300', extra: '30'});
  assert.equal(result.before, 26000);
  assert.equal(result.after, 29000);
  assert.equal(result.difference, 3000);
  assert.equal(result.gapBefore, 0);
});

test('a partial top-up does not unlock the discount', () => {
  const result = compare({extra: '29.99'});
  assert.equal(result.afterDiscount, 0);
  assert.equal(result.gapAfter, 1);
  assert.equal(result.difference, 2999);
});

test('zero items, zero discount and a full discount behave consistently', () => {
  assert.equal(compare({current: '0', extra: '0'}).after, 0);
  assert.equal(compare({reduction: '0'}).difference, 3000);
  assert.equal(compare({reduction: '300'}).after, 0);
  assert.equal(compare({extra: '0'}).difference, 0);
});

test('uses integer cents across decimal thresholds and maximum amounts', () => {
  const result = compare({current: '0.10', threshold: '0.30', reduction: '0.20', extra: '0.20'});
  assert.equal(result.before, 10);
  assert.equal(result.after, 10);
  assert.equal(result.difference, 0);
  assert.equal(cartMoney(result.after), '0.10');
  const max = compare({current: '1000000', threshold: '1000000', reduction: '1', extra: '1000000'});
  assert.equal(max.after, 199999900);
  assert.equal(cartMoney(max.after), '1999999.00');
});

test('rejects malformed, excessive and incompatible coupon inputs', () => {
  for (const current of ['', '-1', '1e3', '1,000', '$10', '0.001', '1000000.01']) {
    assert.throws(() => compare({current}), /当前金额/);
  }
  assert.throws(() => compare({threshold: '0'}), /须大于 0/);
  assert.throws(() => compare({reduction: '300.01'}), /不能大于/);
});

test('spending difference equals extra items less newly unlocked discount', () => {
  for (let cents = 0; cents <= 50000; cents += 199) {
    const result = compare({current: cartMoney(cents), extra: '30'});
    assert.equal(result.difference, 3000 - result.afterDiscount + result.beforeDiscount);
    assert.ok(result.before >= 0 && result.after >= 0);
    assert.equal(result.afterDiscount > 0, cents + 3000 >= 30000);
  }
});
