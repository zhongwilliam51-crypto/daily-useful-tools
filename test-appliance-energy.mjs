import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {runInNewContext} from 'node:vm';

const html = readFileSync(new URL('./appliance-energy.html', import.meta.url), 'utf8');
const core = html.match(/<script id="appliance-energy-core">([\s\S]*?)<\/script>/)[1];
const {estimateEnergy, formatEnergy, formatCost} = runInNewContext(core + '\n({estimateEnergy, formatEnergy, formatCost})');
const defaults = {watts: '120', hours: '2', minutes: '30', days: '30', rate: '1.20'};
const estimate = changes => estimateEnergy({...defaults, ...changes});

test('converts watts and hours plus minutes to daily and period energy', () => {
  const result = estimate();
  assert.equal(result.dailyKwh, 0.3);
  assert.equal(result.totalKwh, 9);
  assert.equal(result.days, 30);
  assert.equal(formatCost(result.cost), '10.80');
});

test('a 1000 W appliance running for one hour uses one kWh', () => {
  const result = estimate({watts: '1000', hours: '1', minutes: '0', days: '1', rate: ''});
  assert.equal(result.dailyKwh, 1);
  assert.equal(result.totalKwh, 1);
  assert.equal(result.cost, null);
});

test('blank and zero electricity prices have distinct results', () => {
  assert.equal(estimate({rate: '  '}).cost, null);
  assert.equal(estimate({rate: '0.0000'}).cost, 0);
  assert.equal(formatCost(0), '0.00');
});

test('accepts decimal comma and calculates short usage in Wh', () => {
  const result = estimate({watts: ' 0,1 ', hours: '0', minutes: '1', days: '1', rate: '0,0001'});
  assert.ok(result.totalKwh > 0);
  assert.equal(formatEnergy(result.totalKwh), '0.0017 Wh');
  assert.equal(formatCost(result.cost), '小于 0.01');
});

test('period cost is based on unrounded total energy', () => {
  const result = estimate({watts: '5', hours: '0', minutes: '1', days: '60', rate: '2'});
  assert.equal(result.totalKwh, 0.005);
  assert.equal(result.cost, 0.01);
  assert.equal(formatCost(result.cost), '0.01');
});

test('accepts zero use and the maximum valid daily schedule', () => {
  const idle = estimate({hours: '0', minutes: '0'});
  assert.equal(idle.totalKwh, 0);
  assert.equal(idle.cost, 0);
  assert.equal(formatEnergy(idle.dailyKwh), '0 kWh');
  const max = estimate({watts: '10000', hours: '24', minutes: '0', days: '366', rate: '100'});
  assert.equal(max.dailyKwh, 240);
  assert.equal(max.totalKwh, 87840);
  assert.equal(max.cost, 8784000);
});

test('rejects invalid power and prices instead of guessing units', () => {
  for (const watts of ['', '-1', 'NaN', '0.01', '1e3', '120 W', '10,000', '10000.1']) {
    assert.throws(() => estimate({watts}), /功率/);
  }
  for (const rate of ['-0.01', '$1', '1e1', '0.00001', '100.0001']) {
    assert.throws(() => estimate({rate}), /每度单价/);
  }
});

test('rejects invalid durations and period lengths', () => {
  assert.throws(() => estimate({hours: '24', minutes: '1'}), /不能超过 24 小时/);
  assert.throws(() => estimate({hours: '1.5'}), /小时/);
  assert.throws(() => estimate({minutes: '60'}), /分钟/);
  for (const days of ['', '0', '367', '30.5']) {
    assert.throws(() => estimate({days}), /使用天数/);
  }
});
