import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
const html = readFileSync(new URL('./unit-price.html', import.meta.url), 'utf8');
const source = html.match(/<script id="unit-price-core">([\s\S]*?)<\/script>/)[1];
const { compareProducts, decimalValue } = runInNewContext(source + '\n({ compareProducts, decimalValue })');
const product = (name, price, quantity, unit = 'g', packs = '1') => ({ name, price, quantity, unit, packs });

test('compares 500g and 1kg by price per 100g', () => {
  const [group] = compareProducts([product('small', '18.90', '500'), product('large', '32.90', '1', 'kg')]);
  assert.equal(group.type, 'weight');
  assert.equal(group.items[0].name, 'large');
  assert.equal(group.items[0].unitPrice, 3.29);
  assert.equal(group.items[1].unitPrice, 3.78);
  assert.ok(Math.abs(group.savings - 12.962962962963) < 1e-9);
});
test('uses total paid for multipacks rather than charging per pack', () => {
  const [group] = compareProducts([product('four bottles', '20', '250', 'ml', '4'), product('one bottle', '12', '0.5', 'l')]);
  assert.equal(group.items[0].name, 'four bottles');
  assert.equal(group.items[0].unitPrice, 2);
  assert.equal(group.items[1].unitPrice, 2.4);
});
test('supports item counts and free extra same-size packs', () => {
  const [group] = compareProducts([product('bundle', '18', '6', 'item', '3'), product('single pack', '8', '6', 'item')]);
  assert.equal(group.items[0].unitPrice, 1);
  assert.equal(group.items[0].amount, 18000n);
});
test('keeps weight, volume and count separate', () => {
  const groups = compareProducts([product('flour', '10', '100'), product('milk', '10', '100', 'ml'), product('eggs', '10', '2', 'item')]);
  assert.equal(groups.length, 3);
  assert.equal(groups.map(g => g.type).join(','), 'weight,volume,count');
  assert.ok(groups.every(g => g.items.length === 1 && g.savings === 0));
});
test('marks exact ties across decimal quantities and converted units', () => {
  const [group] = compareProducts([product('A', '0.30', '0.3'), product('B', '1.00', '0.001', 'kg')]);
  assert.equal(group.tieCount, 2);
  assert.equal(group.savings, 0);
  assert.ok(group.items.every(item => item.lowest));
});
test('sorts using exact ratios before display rounding', () => {
  const [group] = compareProducts([product('slightly expensive', '100.00', '999.999'), product('cheaper', '100.00', '1000')]);
  assert.equal(group.items[0].name, 'cheaper');
  assert.equal(group.tieCount, 1);
});
test('refuses blank, zero, negatives, nonfinite, exponent and junk values', () => {
  for (const bad of ['', '0', '-1', 'NaN', 'Infinity', '1e2', '2.3x', '1,000', '+2']) {
    assert.throws(() => compareProducts([product('bad', bad, '100'), product('ok', '1', '100')]));
    assert.throws(() => compareProducts([product('bad', '1', bad), product('ok', '1', '100')]));
  }
});
test('refuses excessive decimal precision and fractional pieces or packs', () => {
  for (const bad of [product('x', '1.001', '100'), product('x', '1', '0.0001'), product('x', '1', '1.5', 'item'), product('x', '1', '100', 'g', '1.5')]) {
    assert.throws(() => compareProducts([bad, product('ok', '1', '100')]));
  }
});
test('enforces documented value bounds and batch limits', () => {
  for (const bad of [product('x', '1000000.01', '1'), product('x', '1', '1000000.001'), product('x', '1', '1', 'g', '10001')]) {
    assert.throws(() => compareProducts([bad, product('ok', '1', '1')]));
  }
  assert.throws(() => compareProducts([]));
  assert.throws(() => compareProducts([product('x', '1', '1')]));
  assert.throws(() => compareProducts(Array(9).fill(product('x', '1', '1'))));
  assert.equal(compareProducts(Array(8).fill(product('x', '1', '1')))[0].items.length, 8);
});
test('does not silently omit an invalid row or accept unknown units', () => {
  for (const unit of ['oz', '__proto__', 'toString', '']) {
    assert.throws(() => compareProducts([product('x', '1', '1', unit), product('ok', '1', '1')]));
  }
});
test('handles limits exactly with BigInt and tiny nonzero display values', () => {
  const [group] = compareProducts([product('bulk', '0.01', '1000000', 'kg', '10000'), product('normal', '1', '1')]);
  assert.equal(group.items[0].amount, 10000000000000000n);
  assert.ok(group.items[0].unitPrice > 0);
  assert.equal(decimalValue(' 001.20 ', 2, 1000000, 'price'), 120n);
});
test('provides fallback names and preserves stable order for ties', () => {
  const [group] = compareProducts([product('', '1', '1'), product('B', '2', '2')]);
  assert.equal(group.items[0].name, '商品 1');
  assert.equal(group.items[1].name, 'B');
});
