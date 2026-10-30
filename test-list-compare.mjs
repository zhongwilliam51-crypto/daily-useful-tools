import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
const html=readFileSync(new URL('./list-compare.html',import.meta.url),'utf8');
const core=html.match(/<script id="list-compare-core">([\s\S]*?)<\/script>/)[1];
const {compareChecklists:compare}=runInNewContext(core+'\n({compareChecklists})');
const array=value=>Array.from(value);

test('packing example identifies missing, extra and shared items in their source order',()=>{
 const r=compare('牙刷\n牙膏\n充电器\n水杯\nUSB 线','牙刷\n充电器\nusb 线\n纸巾\n牙刷');
 assert.deepEqual(array(r.missing),['牙膏','水杯']);assert.deepEqual(array(r.extra),['纸巾']);assert.deepEqual(array(r.common),['牙刷','充电器','USB 线']);
 assert.equal(r.expectedCount,5);assert.equal(r.actualCount,4);assert.equal(r.actualDuplicates,1);
});
test('trims outer whitespace, skips blank lines and accepts CRLF, LF and CR',()=>{
 const r=compare(' 牛奶 \r\n\t\r燕麦\n香蕉\n','\t牛奶\t\n\n香蕉\r纸巾\r');
 assert.deepEqual(array(r.missing),['燕麦']);assert.deepEqual(array(r.extra),['纸巾']);assert.deepEqual(array(r.common),['牛奶','香蕉']);
});
test('duplicates are merged without changing the first spelling or original order',()=>{
 const r=compare('B\nb\nA\nB','a\na\nC');
 assert.equal(r.expectedDuplicates,2);assert.equal(r.actualDuplicates,1);
 assert.deepEqual(array(r.missing),['B']);assert.deepEqual(array(r.common),['A']);assert.deepEqual(array(r.extra),['C']);
});
test('case-sensitive mode keeps differently cased names distinct',()=>{
 const r=compare('USB\nusb','usb',false);assert.deepEqual(array(r.missing),['USB']);assert.deepEqual(array(r.common),['usb']);assert.equal(r.expectedDuplicates,0);
});
test('case folding only applies to ASCII A to Z',()=>{
 const r=compare('Ä\nΣ\nABC','ä\nσ\nabc');assert.deepEqual(array(r.missing),['Ä','Σ']);assert.deepEqual(array(r.extra),['ä','σ']);assert.deepEqual(array(r.common),['ABC']);
});
test('does not normalize Unicode, full-width text, internal spaces or quantity suffixes',()=>{
 const a=['é','Ａ','USB 线','牛奶 ×2','1. 牙刷','繁體'];const b=['e\u0301','A','USB  线','牛奶','牙刷','繁体'];
 const r=compare(a.join('\n'),b.join('\n'));assert.equal(r.common.length,0);assert.deepEqual(array(r.missing),a);assert.deepEqual(array(r.extra),b);
});
test('one empty side is allowed, but two empty sides are rejected',()=>{
 assert.deepEqual(array(compare('牙刷\n牙膏','').missing),['牙刷','牙膏']);assert.deepEqual(array(compare('','纸巾').extra),['纸巾']);
 for(const a of ['',' \r\n\t'])assert.throws(()=>compare(a,'\r\n'),/至少/);
});
test('identical item sets produce no differences even when order or counts differ',()=>{
 const r=compare('甲\n乙\n甲','乙\n甲');assert.equal(r.missing.length,0);assert.equal(r.extra.length,0);assert.deepEqual(array(r.common),['甲','乙']);assert.equal(r.expectedDuplicates,1);
});
test('accepts 1000 nonempty lines but rejects a 1001st even when it is a duplicate',()=>{
 const text=Array.from({length:1000},(_,i)=>'项目'+i).join('\n');assert.equal(compare(text,'').expectedCount,1000);
 assert.throws(()=>compare(text+'\n项目0',''),/1,000/);assert.throws(()=>compare('',text+'\n项目0'),/实际清单.*1,000/);
});
test('checks original input length before skipping whitespace, never silently truncates',()=>{
 assert.equal(compare(' '.repeat(99999)+'a','').expectedCount,1);
 assert.throws(()=>compare(' '.repeat(100000)+'a',''),/100,000/);assert.throws(()=>compare('a',' '.repeat(100001)),/实际清单.*100,000/);
});
test('per-item limit counts Unicode code points and reports the original line number',()=>{
 assert.equal(compare('😀'.repeat(200),'').expectedCount,1);
 assert.throws(()=>compare('\n\n'+'😀'.repeat(201),''),/第 3 行.*200/);assert.throws(()=>compare('','x'.repeat(201)),/实际清单第 1 行/);
});
test('special object names and HTML-like content are treated as ordinary names',()=>{
 const r=compare('__proto__\nconstructor\n<img src=x onerror=alert(1)>','CONSTRUCTOR\n<img src=x onerror=alert(1)>');
 assert.deepEqual(array(r.missing),['__proto__']);assert.deepEqual(array(r.common),['constructor','<img src=x onerror=alert(1)>']);
});
test('requires string lists and a boolean comparison option',()=>{
 for(const value of [null,undefined,42,{},['a']]){assert.throws(()=>compare(value,'a'));assert.throws(()=>compare('a',value));}
 for(const value of [null,'false',0,1,{}])assert.throws(()=>compare('a','a',value),/规则/);
});
test('copied report includes directions, counts, duplicates, rules and empty sections',()=>{
 const r=compare('A\nA','a',false);for(const phrase of ['基准 1 项','实际 1 项','共有 0 项','基准 1 行','区分大小写','不核对数量','缺少（1 项）\nA','多出（1 项）\na','共有（0 项）\n（无）'])assert.ok(r.text.includes(phrase),phrase);
});
test('500 varied checklists preserve set partitions and reverse missing/extra on swap',()=>{
 for(let n=1;n<=500;n++){
  const a=Array.from({length:1+n%31},(_,i)=>'item'+((i*7+n)%43));const b=Array.from({length:1+n%29},(_,i)=>'ITEM'+((i*5+n*3)%47));
  const r=compare(a.concat(a.slice(0,n%5)).join('\n'),b.join('\n'));const back=compare(b.join('\n'),a.join('\n'));const sa=new Set(a),sb=new Set(b.map(x=>x.toLowerCase()));
  assert.equal(r.missing.length+r.common.length,sa.size);assert.equal(r.extra.length+r.common.length,sb.size);
  assert.equal(r.missing.length,back.extra.length);assert.equal(r.extra.length,back.missing.length);assert.equal(r.common.length,back.common.length);
  for(const x of r.missing)assert.ok(sa.has(x)&&!sb.has(x));for(const x of r.common)assert.ok(sa.has(x)&&sb.has(x));for(const x of r.extra)assert.ok(sb.has(x.toLowerCase())&&!sa.has(x.toLowerCase()));
 }
});
