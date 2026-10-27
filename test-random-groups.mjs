import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
const html = readFileSync(new URL('./random-groups.html', import.meta.url), 'utf8');
const core = html.match(/<script id="random-groups-core">([\s\S]*?)<\/script>/)[1];
const { groupNames, groupRandomIndex, randomGroups } = runInNewContext(core + '\n({ groupNames, groupRandomIndex, randomGroups })');
const roster = n => Array.from({length:n},(_,i)=>'成员 '+(i+1)).join('\n');
const keepOrder = bound => bound-1;

test('splits eight members into balanced groups of 3, 3 and 2', () => {
  const r=randomGroups(roster(8),'3',keepOrder);
  assert.equal(r.total,8); assert.equal(r.groups.map(x=>x.length).join(','),'3,3,2');
  assert.equal(r.groups.flat().join('\n'),roster(8));
});
test('supports exact divisions and one-member groups', () => {
  assert.equal(randomGroups(roster(6),'2',keepOrder).groups.map(x=>x.length).join(','),'3,3');
  assert.equal(randomGroups(roster(2),'2',keepOrder).groups.map(x=>x.length).join(','),'1,1');
});
test('ignores blank lines and trims names across newline conventions', () => {
  assert.equal(groupNames(' 小林 \r\n\r\n阿杰\r小陈\n\n').join(','),'小林,阿杰,小陈');
});
test('rejects duplicate names, including English case and surrounding spaces', () => {
  for(const raw of ['小林\n小林',' Alice \nalice','A\nB\n A ']) assert.throws(()=>groupNames(raw),/重复/);
  assert.match(randomGroups('小林 1\n小林 2','2',keepOrder).text,/小林 2/);
});
test('handles literal HTML, object-like keys, emoji and distinct Unicode spellings', () => {
  const names=['<img src=x>','__proto__','🍎 小陈','é','e\u0301'];
  const r=randomGroups(names.join('\n'),'2',keepOrder);
  assert.equal(r.groups.flat().join('|'),names.join('|')); assert.equal(r.total,5);
});
test('bounds members and input size without silently truncating', () => {
  assert.equal(groupNames(roster(200)).length,200);
  for(const raw of ['', 'Only one', '\n\n', roster(201), 'x'.repeat(20001), null, 123]) assert.throws(()=>groupNames(raw));
});
test('counts Unicode code points for the 40-character name limit and rejects controls', () => {
  assert.equal(groupNames('🍎'.repeat(40)+'\nB').length,2);
  for(const raw of ['🍎'.repeat(41)+'\nB','A\tB\nC','A\u0000B\nC','A\u007fB\nC']) assert.throws(()=>groupNames(raw));
});
test('validates group counts against both the allowed range and member count', () => {
  for(const count of ['',null,'0','1','4','51','2.5','-2','2e0','+2']) assert.throws(()=>randomGroups(roster(3),count,keepOrder));
  assert.equal(randomGroups(roster(50),'50',keepOrder).groups.length,50);
  assert.equal(randomGroups(roster(3),' 02 ',keepOrder).groups.length,2);
});
test('uses every Fisher-Yates swap and can reach all six three-person permutations', () => {
  const outcomes=new Set();
  for(let j3=0;j3<3;j3++) for(let j2=0;j2<2;j2++) {
    const choices=[j3,j2], bounds=[];
    const r=randomGroups('A\nB\nC','2',bound=>{bounds.push(bound);return choices.shift();});
    assert.equal(bounds.join(','),'3,2'); outcomes.add(r.groups.flat().join(''));
  }
  assert.equal(outcomes.size,6);
});
test('fails closed on absent or invalid random indices', () => {
  assert.throws(()=>randomGroups(roster(3),'2',undefined),/随机源/);
  for(const index of [-1,3,0.5,NaN,'0',undefined]) assert.throws(()=>randomGroups(roster(3),'2',()=>index),/随机源/);
});
test('rejection sampling discards the biased tail of the uint32 range', () => {
  const values=[4294967295,4]; let calls=0;
  assert.equal(groupRandomIndex(3,()=>{calls++;return values.shift();}),1); assert.equal(calls,2);
  assert.equal(groupRandomIndex(3,()=>4294967294),2);
  assert.equal(groupRandomIndex(2,()=>4294967295),1);
});
test('bounds random input values and terminates a broken repeating source', () => {
  for(const bound of [0,-1,201,1.5,'3']) assert.throws(()=>groupRandomIndex(bound,()=>0));
  for(const word of [-1,4294967296,1.5,NaN,undefined]) assert.throws(()=>groupRandomIndex(3,()=>word));
  let calls=0; assert.throws(()=>groupRandomIndex(3,()=>{calls++;return 4294967295;}),/不可用/); assert.equal(calls,128);
  assert.equal(groupRandomIndex(1,()=>4294967295),0);
});
test('copy text contains a complete roster and labeled group sizes', () => {
  const r=randomGroups('A\nB\nC\nD\nE','2',keepOrder);
  assert.equal(r.text,'随机分组 · 5 人 / 2 组\n\n第 1 组（3 人）\nA\nB\nC\n\n第 2 组（2 人）\nD\nE');
});
test('500 varied rosters preserve membership exactly and differ by at most one member', () => {
  let seed=27; const next=bound=>{seed=seed*48271%2147483647;return seed%bound;};
  for(let i=0;i<500;i++) {
    const n=2+i%199, count=2+i%Math.min(49,n-1), original=roster(n);
    const r=randomGroups(original,String(count),next), all=r.groups.flat(), sizes=r.groups.map(x=>x.length);
    assert.equal(all.length,n); assert.equal(new Set(all).size,n);
    assert.equal([...all].sort().join('\n'),original.split('\n').sort().join('\n'));
    assert.equal(r.groups.length,count); assert.ok(Math.max(...sizes)-Math.min(...sizes)<=1); assert.ok(Math.min(...sizes)>0);
  }
});
