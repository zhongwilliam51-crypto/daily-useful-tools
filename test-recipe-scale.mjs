import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
const html = readFileSync(new URL('./recipe-scale.html', import.meta.url), 'utf8');
const source = html.match(/<script id="recipe-scale-core">([\s\S]*?)<\/script>/)[1];
const { recipeAmount, recipeServing, recipeNumber, scaleRecipe } = runInNewContext(source + '\n({ recipeAmount, recipeServing, recipeNumber, scaleRecipe })');
const item = (amount, unit = 'g', name = '面粉') => ({name, amount, unit});

test('scales a real multi-ingredient recipe from 2 to 3 portions', () => {
  const result = scaleRecipe('2', '3', [item('200'),item('150','ml','牛奶'),item('1','个','鸡蛋'),item('1 1/2','汤匙','糖')]);
  assert.equal(result.items.map(x=>x.display).join(','),'300,225,1.5,2.25');
  assert.equal(result.items.map(x=>x.unit).join(','),'g,ml,个,汤匙');
  assert.equal(result.ratio,'1.5'); assert.match(result.text,/鸡蛋：1.5 个/);
});
test('reduces portions and preserves quantities at a one-to-one ratio', () => {
  assert.equal(scaleRecipe('8','2',[item('250')]).items[0].display,'62.5');
  assert.equal(scaleRecipe('7','7',[item('1/8')]).items[0].display,'0.125');
});
test('accepts decimals, leading decimals and trimmed input', () => {
  for (const raw of ['0.5','.5',' 00.500 ']) { const r=recipeAmount(raw); assert.equal(r.n*2n,r.d); }
  assert.equal(scaleRecipe(' 02 ','003',[item('0.001')]).items[0].display,'≈0.002');
});
test('accepts ordinary, improper and mixed fractions', () => {
  for (const raw of ['1/2','1 / 2']) { const r=recipeAmount(raw); assert.equal(r.n*2n,r.d); }
  const mixed=recipeAmount('1 1/2'); assert.equal(mixed.n,3n); assert.equal(mixed.d,2n);
  assert.equal(scaleRecipe(1,1,[item('3/2')]).items[0].display,'1.5');
});
test('accepts common Unicode fractions alone and after an integer', () => {
  for (const [raw,expected] of [['¼','0.25'],['½','0.5'],['¾','0.75'],['1½','1.5'],['1 ¼','1.25']]) assert.equal(scaleRecipe('1','1',[item(raw)]).items[0].display,expected);
});
test('marks rounded amounts, rounds half up, and never prints tiny amounts as zero', () => {
  assert.equal(recipeNumber(1n,3n),'≈0.333'); assert.equal(recipeNumber(2n,3n),'≈0.667');
  assert.equal(recipeNumber(1n,16n),'≈0.063'); assert.equal(recipeNumber(9999n,10000n),'≈1');
  assert.equal(recipeNumber(1n,1001n),'<0.001'); assert.equal(recipeNumber(1n,1000n),'0.001');
  assert.equal(scaleRecipe('100','1',[item('0.001')]).items[0].display,'<0.001');
});
test('rejects missing, zero, negative, exponent and malformed quantities', () => {
  for (const raw of ['',null,'0','0/2','-1','+1','1e3','1,000','NaN','Infinity','1.','1.0001','适量','1/0','1/1001','1/-2','1 2/2','1 0/2','1 1/2/3','1½½','9'.repeat(25)]) assert.throws(()=>recipeAmount(raw),String(raw));
});
test('checks amount and denominator boundaries exactly', () => {
  for (const raw of ['1000000','1000000.000','2000000/2','1000000 0/1']) {
    if(raw.includes(' 0/')) assert.throws(()=>recipeAmount(raw)); else { const r=recipeAmount(raw); assert.equal(r.n,1000000n*r.d); }
  }
  for (const raw of ['1000000.001','1000001','1000000 1/1000','2000001/2']) assert.throws(()=>recipeAmount(raw));
  assert.equal(recipeAmount('1/1000').d,1000n);
});
test('requires integer serving counts in range 1 through 100', () => {
  assert.equal(recipeServing('100'),100n);
  for(const raw of ['0','101','-1','1.5','1e2','',null,'1/2']) assert.throws(()=>recipeServing(raw));
});
test('skips fully empty rows but rejects partially filled ones', () => {
  assert.equal(scaleRecipe('1','2',[{name:' ',amount:'',unit:''},item('1')]).items.length,1);
  for(const row of [{name:'面粉',amount:'',unit:'g'},{name:'',amount:'1',unit:''},{name:'',amount:'',unit:'g'}]) assert.throws(()=>scaleRecipe('1','2',[row]));
  assert.throws(()=>scaleRecipe('1','2',[{name:'',amount:'',unit:''}]));
});
test('bounds rows and text, rejecting control characters', () => {
  for(const rows of [[],Array(21).fill(item('1')),null,[null]]) assert.throws(()=>scaleRecipe('1','2',rows));
  for(const row of [item('1','g','x'.repeat(41)),item('1','x'.repeat(13)),item('1','g','bad\nname'),item('1','g\u007f')]) assert.throws(()=>scaleRecipe('1','2',[row]));
  assert.equal(scaleRecipe('1','2',Array(20).fill(item('1'))).items.length,20);
});
test('keeps units, literal names and duplicate ingredient entries without conversion or merging', () => {
  const r=scaleRecipe('2','3',[item('1','杯','<img src=x>'),item('2','','糖'),item('3','汤匙','糖')]);
  assert.equal(r.items[0].name,'<img src=x>'); assert.equal(r.items[0].unit,'杯');
  assert.equal(r.items.length,3); assert.match(r.text,/糖：3\n糖：4.5 汤匙/);
});
test('large scaled outputs retain exact integer precision', () => {
  const r=scaleRecipe('1','100',[item('1000000')]);
  assert.equal(r.items[0].n,100000000n); assert.equal(r.items[0].display,'100000000');
});
test('400 varied ratios preserve rational quantities and stay within half a display unit when rounded', () => {
  for(let i=1;i<=400;i++) {
    const base=1+i%100, target=1+(i*17)%100, numerator=1+i*19%1000, denominator=1+i*7%1000;
    const r=scaleRecipe(String(base),String(target),[item(numerator+'/'+denominator)]).items[0];
    assert.equal(r.n*BigInt(denominator*base),r.d*BigInt(numerator*target));
    if(r.display!=='<0.001') {
      const shown=Number(r.display.replace('≈','')), exact=Number(r.n)/Number(r.d);
      assert.ok(Math.abs(shown-exact)<=0.000500001);
    }
  }
});
