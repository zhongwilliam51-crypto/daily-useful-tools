import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {runInNewContext} from 'node:vm';

const html = readFileSync(new URL('./print-scale.html', import.meta.url), 'utf8');
const core = html.match(/<script id="print-scale-core">([\s\S]*?)<\/script>/)[1];
const calculate = runInNewContext(core + '\ncalculatePrintScale');
const defaults = {sourceWidth: '297', sourceHeight: '210', paperWidth: '148', paperHeight: '210', margin: '5', allowRotation: true};
const fit = changes => calculate({...defaults, ...changes});

test('compares the original and rotated scales with all four margins', () => {
  const result = fit();
  assert.equal(result.upright, 464);
  assert.equal(result.sideways, 657);
  assert.equal(result.rotated, true);
  assert.equal(result.scale, 657);
  assert.equal(result.printedWidth / 10, 137.97);
  assert.ok(Math.abs(result.printedHeight / 10 - 195.129) < 1e-10);
});

test('respects the direction lock', () => {
  const result = fit({allowRotation: false});
  assert.equal(result.rotated, false);
  assert.equal(result.scale, 464);
});

test('allows enlargement and prefers the original direction when tied', () => {
  const result = fit({sourceWidth: '100', sourceHeight: '100', paperWidth: '210', paperHeight: '220'});
  assert.equal(result.scale, 2000);
  assert.equal(result.rotated, false);
});

test('exact fit and decimal values are retained without losing a tenth of a percent', () => {
  const result = fit({sourceWidth: '138,1', sourceHeight: '200.1', paperWidth: '148.1', paperHeight: '210.1'});
  assert.equal(result.scale, 1000);
  assert.equal(result.rotated, false);
  assert.equal(result.printedWidth, result.usableWidth);
  assert.equal(result.printedHeight, result.usableHeight);
});

test('rounds down on a height-limited layout', () => {
  const result = fit({sourceWidth: '100', sourceHeight: '300', paperWidth: '120', paperHeight: '210', margin: '0', allowRotation: false});
  assert.equal(result.scale, 700);
  assert.equal(result.printedHeight, 2100);
  assert.equal(fit({sourceWidth: '100', sourceHeight: '300', paperWidth: '120', paperHeight: '209.9', margin: '0', allowRotation: false}).scale, 699);
});

test('rejects missing, ambiguous, out-of-range or invalid sizes', () => {
  for (const value of ['', '0', '-10', '2000.1', '1e2', '210mm', '1,000', '1.25', 'Infinity']) {
    assert.throws(() => fit({sourceWidth: value}), /原稿宽度/);
  }
  for (const value of ['-0.1', '500.1', '1.00']) {
    assert.throws(() => fit({margin: value}), /每边留白/);
  }
});

test('rejects exhausted paper space and unrepresentably small scales', () => {
  assert.throws(() => fit({paperWidth: '10', margin: '5'}), /留白占满/);
  assert.throws(() => fit({paperHeight: '9.9', margin: '5'}), /留白占满/);
  const tiny = {sourceWidth: '2000', sourceHeight: '2000', paperWidth: '20.1', paperHeight: '20.1', margin: '10'};
  assert.throws(() => fit(tiny), /小于 0.1%/);
  assert.equal(fit({...tiny, paperWidth: '22', paperHeight: '22'}).scale, 1);
});

test('chosen scales fit and the next tenth percent fails in either orientation', () => {
  for (let i = 1; i <= 250; i += 1) {
    const sw = 10 + i * 67 % 19001;
    const sh = 10 + i * 89 % 19001;
    const pw = 1000 + i * 73 % 15000;
    const ph = 1000 + i * 97 % 15000;
    const margin = i * 11 % 490;
    const result = calculate({
      sourceWidth: (sw / 10).toFixed(1), sourceHeight: (sh / 10).toFixed(1),
      paperWidth: (pw / 10).toFixed(1), paperHeight: (ph / 10).toFixed(1),
      margin: (margin / 10).toFixed(1), allowRotation: true,
    });
    const fits = (width, height, scale) =>
      BigInt(width) * BigInt(scale) <= BigInt(pw - 2 * margin) * 1000n &&
      BigInt(height) * BigInt(scale) <= BigInt(ph - 2 * margin) * 1000n;
    assert.ok(fits(sw, sh, result.upright));
    assert.ok(fits(sh, sw, result.sideways));
    assert.ok(!fits(sw, sh, result.scale + 1));
    assert.ok(!fits(sh, sw, result.scale + 1));
    assert.equal(result.scale, Math.max(result.upright, result.sideways));
  }
});
