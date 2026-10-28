import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
const html=readFileSync(new URL('./time-total.html',import.meta.url),'utf8');
const core=html.match(/<script id="time-total-core">([\s\S]*?)<\/script>/)[1];
const {parseClock,timeClock,timeDuration,totalTime}=runInNewContext(core+'\n({parseClock,timeClock,timeDuration,totalTime})');

test('adds fragmented sessions without counting breaks',()=>{
  const r=totalTime('09:00-11:30\n13:00-14:15\n15:00-16:00');
  assert.equal(r.total,285);assert.equal(r.decimal,'4.75');assert.equal(r.span,420);assert.equal(r.gaps,135);
});
test('sorts sessions chronologically and keeps source line numbers',()=>{
  const r=totalTime('15:00-16:00\n09:00-10:00\n13:00-14:00');
  assert.equal(r.segments.map(s=>s.line).join(','),'2,3,1');assert.equal(r.start,540);assert.equal(r.end,960);
});
test('accepts adjacent sessions with no double counting',()=>{
  const r=totalTime('09:00-10:00\n10:00-11:00');assert.equal(r.total,120);assert.equal(r.gaps,0);
});
test('supports one minute and a full calendar day including 24:00',()=>{
  assert.equal(totalTime('23:59-24:00').total,1);
  const r=totalTime('00:00-24:00');assert.equal(r.total,1440);assert.equal(r.decimal,'24.00');assert.equal(r.gaps,0);
});
test('accepts single-digit hours and normalizes display',()=>{
  const r=totalTime(' 9:00 - 9:05 ');assert.equal(r.total,5);assert.match(r.text,/09:00–09:05/);
});
test('supports documented separators and newline conventions',()=>{
  for(const separator of ['-','–','—','~','～','至'])assert.equal(totalTime('9:00 '+separator+' 10:00').total,60);
  const r=totalTime('09:00-10:00\r\n\r\n11:00-12:00\r13:00-14:00\n');assert.equal(r.total,180);assert.equal(r.segments.length,3);
});
test('rejects partial, nested and duplicate overlaps instead of merging',()=>{
  for(const raw of ['09:00-11:00\n10:00-12:00','09:00-12:00\n10:00-11:00','09:00-10:00\n09:00-10:00','10:00-11:00\n09:00-10:30'])assert.throws(()=>totalTime(raw),/重叠/);
});
test('rejects backwards, midnight-crossing and zero-length sessions',()=>{
  for(const raw of ['23:00-01:00','10:00-09:00','09:00-09:00'])assert.throws(()=>totalTime(raw),/结束时间须晚于/);
});
test('rejects invalid clocks, labels, seconds and extra intervals on one line',()=>{
  for(const raw of ['9:0-10:00','09:60-10:00','24:00-24:00','09:00-24:01','99:00-99:10','-1:00-10:00','学习 09:00-10:00','09:00:00-10:00:00','09:00-10:00,11:00-12:00','09:00','09:00-10:00休息'])assert.throws(()=>totalTime(raw),raw);
});
test('bounds raw text and segment count without silently truncating',()=>{
  const raw=Array.from({length:100},(_,i)=>timeClock(i)+'-'+timeClock(i+1)).join('\n');assert.equal(totalTime(raw).total,100);
  assert.throws(()=>totalTime(raw+'\n02:00-02:01'),/100/);
  assert.equal(totalTime(' '.repeat(9989)+'00:00-00:01').total,1);
  assert.throws(()=>totalTime(' '.repeat(9990)+'00:00-00:01'),/10,000/);
});
test('rejects empty input and invalid types with useful source line errors',()=>{
  for(const raw of ['', '\n \r\n',null,123,[]])assert.throws(()=>totalTime(raw));
  assert.throws(()=>totalTime('\n09:00-10:00\ninvalid'),/第 3 行/);
  assert.throws(()=>totalTime('\n09:00-10:30\n10:00-11:00'),/第 2 行与第 3 行/);
});
test('formats durations and decimal-hour rounding while retaining exact minutes',()=>{
  for(const [minutes,display] of [[0,'0 分钟'],[1,'1 分钟'],[60,'1 小时'],[61,'1 小时 1 分钟'],[1440,'24 小时']])assert.equal(timeDuration(minutes),display);
  const r=totalTime('09:00-09:01');assert.equal(r.total,1);assert.equal(r.decimal,'0.02');assert.match(r.text,/十进制约/);
});
test('counts gaps only within the first-to-last span',()=>{
  const r=totalTime('10:00-11:00\n13:00-14:00');assert.equal(r.total,120);assert.equal(r.gaps,120);assert.equal(r.span,240);
  assert.match(r.text,/期间间隔：2 小时/);assert.match(r.text,/范围：10:00–14:00/);
});
test('clock parsing gives exact integer minutes and confines 24:00 to endpoints',()=>{
  assert.equal(parseClock('0:00'),0);assert.equal(parseClock('23:59'),1439);assert.equal(parseClock('24:00',true),1440);
  assert.throws(()=>parseClock('24:00'));assert.throws(()=>parseClock(null));assert.equal(timeClock(1440),'24:00');
});
test('500 varied schedules reconcile sum, span and gaps independent of input order',()=>{
  let seed=28;const next=()=>seed=seed*48271%2147483647;
  for(let i=0;i<500;i++){
    const n=1+next()%30;let cursor=next()%120,total=0,gaps=0;const rows=[];
    for(let j=0;j<n;j++){
      const gap=next()%8;if(j>0)gaps+=gap;cursor+=gap;const length=1+next()%20;
      rows.push(timeClock(cursor)+'-'+timeClock(cursor+length));cursor+=length;total+=length;
    }
    const r=totalTime(rows.reverse().join('\n'));assert.equal(r.total,total);assert.equal(r.gaps,gaps);assert.equal(r.span,total+gaps);assert.equal(r.segments.length,n);
  }
});
