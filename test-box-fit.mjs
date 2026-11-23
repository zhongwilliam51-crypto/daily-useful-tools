import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {runInNewContext} from 'node:vm';

const html = readFileSync(new URL('./box-fit.html', import.meta.url), 'utf8');
const core = html.match(/<script id="box-fit-core">([\s\S]*?)<\/script>/)[1];
const {checkBoxFit: fit, cm} = runInNewContext(core + '\n({checkBoxFit,cm})');
const plain = value => JSON.parse(JSON.stringify(value));

test('finds the single useful rotation in the packing example', () => {
  const result = fit(['30','20','10'], ['25','35','15'], '1', true);
  assert.equal(result.orientations.length, 6);
  assert.equal(result.fitCount, 1);
  const direction = result.orientations.find(o => o.fits);
  assert.deepEqual(plain(direction.order), [1,0,2]);
  assert.deepEqual(plain(direction.slack), [30,30,30]);
  assert.match(result.text, /20\.0 \/ 30\.0 \/ 10\.0/);
  assert.equal(fit(['30','20','10'], ['25','35','15'], '1', false).fitCount, 0);
});

test('counts exact contact as a fit and never rounds a shortage into a fit', () => {
  assert.equal(fit(['0.3','0.3','0.3'], ['0.5','0.5','0.5'], '0.1', true).fitCount, 1);
  const short = fit(['10.1','10','10'], ['10','10','10'], '0', true);
  assert.equal(short.fitCount, 0);
  assert.ok(short.orientations.every(o => o.slack.includes(-1)));
  assert.equal(cm(-1), '-0.1');
  assert.equal(cm(0), '0.0');
  assert.equal(cm(123), '12.3');
});

test('deduplicates rotations with equal edges while keeping relevant orientations', () => {
  assert.equal(fit(['10','10','10'], ['20','20','20'], '0', true).orientations.length, 1);
  const twoEqual = fit(['10','10','20'], ['30','30','30'], '0', true);
  assert.equal(twoEqual.orientations.length, 3);
  assert.equal(twoEqual.fitCount, 3);
  assert.equal(fit(['10','20','30'], ['40','40','40'], '0', true).fitCount, 6);
});

test('uses per-wall clearance on every axis and rejects exhausted internal space', () => {
  const result = fit(['1','2','3'], ['10','20','30'], '1.5', false);
  assert.deepEqual(plain(result.usable), [70,170,270]);
  assert.deepEqual(plain(result.orientations[0].slack), [60,150,240]);
  assert.throws(() => fit(['1','1','1'], ['2','10','10'], '1', true), /用尽/);
  assert.throws(() => fit(['1','1','1'], ['1','10','10'], '1', true), /用尽/);
});

test('does not mistake enough volume for a feasible three-edge fit', () => {
  const result = fit(['20','20','1'], ['30','10','10'], '0', true);
  assert.equal(result.fitCount, 0);
  assert.ok(20 * 20 * 1 < 30 * 10 * 10);
});

test('checks input formats, dimension limits and option types', () => {
  for (const value of ['', '0', '-1', '500.1', '1.01', '1e2', '1,5', '10cm', '.5']) {
    assert.throws(() => fit([value,'1','1'], ['20','20','20'], '0', true), /物品长/);
  }
  for (const value of ['-0.1','10.1','1.01','']) {
    assert.throws(() => fit(['1','1','1'], ['20','20','20'], value, true), /空隙/);
  }
  assert.throws(() => fit(['1','1'], ['2','2','2'], '0', true), /三个/);
  assert.throws(() => fit(['1','1','1'], ['2','2','2'], '0', 'yes'), /旋转/);
  assert.equal(fit([' 500 ','500','500'], ['500','500','500'], '0', true).fitCount, 1);
  assert.equal(fit(['0.1','0.1','0.1'], ['20.1','20.1','20.1'], '10', true).fitCount, 1);
});

test('500 dimension sets agree with an independent sorted-axis feasibility check', () => {
  let state = 23;
  const next = () => {state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state;};
  const asCm = value => `${Math.floor(value / 10)}.${value % 10}`;
  for (let trial = 0; trial < 500; trial += 1) {
    const item = Array.from({length:3}, () => 1 + next() % 4500);
    const gap = next() % 101;
    const box = Array.from({length:3}, () => 201 + next() % 4800);
    const usable = box.map(value => value - 2 * gap);
    const sortedItem = item.slice().sort((a,b) => a-b);
    const sortedUsable = usable.slice().sort((a,b) => a-b);
    const expected = sortedItem.every((value,i) => value <= sortedUsable[i]);
    const result = fit(item.map(asCm), box.map(asCm), asCm(gap), true);
    assert.equal(result.fitCount > 0, expected);
    const seen = new Set();
    for (const o of result.orientations) {
      assert.equal(new Set(o.order).size, 3);
      assert.equal(seen.has(o.size.join(',')), false); seen.add(o.size.join(','));
      assert.deepEqual(plain(o.size).slice().sort((a,b) => a-b), sortedItem);
      assert.deepEqual(plain(o.slack), usable.map((value,i) => value - o.size[i]));
      assert.equal(o.fits, o.slack.every(value => value >= 0));
    }
    const fixed = fit(item.map(asCm), box.map(asCm), asCm(gap), false);
    assert.equal(fixed.fitCount === 1, item.every((value,i) => value <= usable[i]));
  }
});
