import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
const html=readFileSync(new URL('./stage-timer.html',import.meta.url),'utf8');
const core=html.match(/<script id="stage-timer-core">([\s\S]*?)<\/script>/)[1];
const ui=html.match(/<script id="stage-timer-ui">([\s\S]*?)<\/script>/)[1];
const api=runInNewContext(core+'\n({parseTimerStages,createStageTimer,tickStageTimer,pauseStageTimer,resumeStageTimer,stageTimerView,formatStageTime})');
const {parseTimerStages:parse,createStageTimer:create,tickStageTimer:tick,pauseStageTimer:pause,resumeStageTimer:resume,stageTimerView:view,formatStageTime:format}=api;
const fixture=()=>parse('开场 | 2\n正文 | 3\n总结 | 1');
test('parses trimmed names, repeated stages, Unicode and mixed newlines in original order',()=>{
 const s=parse('\n  练习😀 | 0001\r\n练习😀 | 60\r总结 | 3600\n');
 assert.deepEqual(Array.from(s,i=>i.name),['练习😀','练习😀','总结']);assert.deepEqual(Array.from(s,i=>i.durationMs),[1000,60000,3600000]);
});
test('rejects invalid formats, names, seconds and oversized raw inputs with line positions',()=>{
 for(const text of ['','一 | 1','一 | 0\n二 | 1','一 | -1\n二 | 1','一 | 1.5\n二 | 1','一 | 1e2\n二 | 1','一 | 3601\n二 | 1','一：1\n二 | 1','一 | 1 | 2\n二 | 1',' | 1\n二 | 1','a'.repeat(41)+' | 1\n二 | 1','a\u202eb | 1\n二 | 1','a\u0000b | 1\n二 | 1','a\ud800b | 1\n二 | 1','a'.repeat(6001)])assert.throws(()=>parse(text));
 assert.throws(()=>parse('\n一 | 1\n二 | 0'),/第 3 行/);
 assert.equal(parse('😀'.repeat(40)+' | 1\n二 | 1')[0].name.length,80);
});
test('accepts exact stage and total limits and rejects the first over-limit value',()=>{
 assert.equal(parse(Array(12).fill('阶段 | 1').join('\n')).length,12);
 assert.throws(()=>parse(Array(13).fill('阶段 | 1').join('\n')));
 const steps=parse(Array(4).fill('阶段 | 3600').join('\n'));assert.equal(create(steps,0).totalMs,14400000);
 assert.throws(()=>parse(Array(4).fill('阶段 | 3600').join('\n')+'\n多一秒 | 1'),/4 小时/);
});
test('switches stages exactly at boundaries and clamps completion after late callbacks',()=>{
 const s=create(fixture(),10000);assert.equal(view(tick(s,11999)).index,0);
 const next=tick(s,12000);assert.equal(view(next).index,1);assert.equal(view(next).phaseRemainingMs,3000);
 assert.equal(view(tick(s,15000)).index,2);
 const done=tick(s,9999999);assert.equal(done.mode,'done');assert.equal(done.elapsedMs,6000);assert.equal(view(done).phaseRemainingMs,0);assert.equal(view(done).totalRemainingMs,0);assert.equal(view(done).progress,1000);
});
test('uses elapsed timestamps instead of callback counts and never regresses after a clock rollback',()=>{
 let s=create(fixture(),10000);s=tick(s,10500);s=tick(s,10400);assert.equal(s.elapsedMs,500);
 s=tick(s,10600);assert.equal(s.elapsedMs,600);
 assert.equal(tick(create(fixture(),10000),15432).elapsedMs,5432);
 assert.throws(()=>tick(s,NaN));assert.throws(()=>create(fixture(),Infinity));assert.throws(()=>create(fixture(),-1));
});
test('pause captures the current fraction and resume excludes all paused time',()=>{
 let s=pause(create(fixture(),1000),1750);assert.equal(s.mode,'paused');assert.equal(s.elapsedMs,750);
 s=tick(s,50000);assert.equal(s.elapsedMs,750);s=resume(s,50000);s=tick(s,51250);
 assert.equal(s.elapsedMs,2000);assert.equal(view(s).index,1);
 assert.equal(pause(create(fixture(),0),6000).mode,'done');
});
test('keeps created sessions independent from subsequent input edits',()=>{
 const steps=fixture(),s=create(steps,0);steps[0].durationMs=5000;steps[0].name='修改';
 assert.equal(s.steps[0].durationMs,2000);assert.equal(s.steps[0].name,'开场');assert.equal(s.totalMs,6000);
 for(const steps of [[],[{name:'a',durationMs:1000}],[{name:'a',durationMs:0},{name:'b',durationMs:1000}]])assert.throws(()=>create(steps,0));
});
test('remaining display rounds upward so an active fraction never reads zero',()=>{
 assert.equal(format(0),'00:00');assert.equal(format(1),'00:01');assert.equal(format(1001),'00:02');assert.equal(format(60001),'01:01');assert.equal(format(14400000),'240:00');assert.throws(()=>format(-1));
});
test('400 timelines match an independent boundary search and remaining-time invariant',()=>{
 for(let k=1;k<=400;k++){
  const steps=Array.from({length:2+k%10},(_,i)=>({name:String(i),durationMs:1000+(k*173+i*83)%7000}));
  const total=steps.reduce((a,s)=>a+s.durationMs,0),elapsed=(k*4567)%(total+10000);
  const s=tick(create(steps,10000),10000+elapsed),v=view(s),clamped=Math.min(total,elapsed);
  assert.equal(v.totalRemainingMs,total-clamped);assert.equal(s.elapsedMs,clamped);
  if(clamped<total){let end=0;const index=steps.findIndex(step=>(end+=step.durationMs)>clamped);assert.equal(v.index,index);assert.equal(v.phaseRemainingMs,end-clamped);}else assert.equal(s.mode,'done');
 }
});
function harness(){
 let now=1000,seq=0;const timers=new Map(),nodes=new Map(),events={},windowEvents={};
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',className:'',children:[],attrs:{},listeners:{},addEventListener(t,fn){this.listeners[t]=fn;},replaceChildren(){this.children=[];},append(...items){this.children.push(...items);},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];}});return nodes.get(id);};
 node('stages').value='开场 | 2\n正文 | 3\n总结 | 1';let created=0;
 const doc={title:'base',hidden:false,getElementById:node,createElement:()=>node('created'+created++),addEventListener(t,fn){events[t]=fn;}};
 const context={document:doc,window:{addEventListener(t,fn){windowEvents[t]=fn;}},Date:{now:()=>now},setTimeout(fn){const id=++seq;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);}};
 runInNewContext(core+'\n'+ui,context);
 return {node,doc,events,windowEvents,timers,setNow(v){now=v;},fire(){const [id,fn]=timers.entries().next().value;timers.delete(id);fn();}};
}
test('UI pause, resume and reset preserve exact elapsed time and clean scheduled callbacks',()=>{
 const h=harness();h.node('toggle').listeners.click();assert.equal(h.timers.size,1);assert.equal(h.node('clock').textContent,'00:02');
 h.setNow(1750);h.node('toggle').listeners.click();assert.equal(h.node('toggle').textContent,'继续');assert.equal(h.timers.size,0);
 h.setNow(50000);h.node('toggle').listeners.click();h.setNow(51250);h.fire();assert.equal(h.node('phase').textContent,'正文');assert.equal(h.node('clock').textContent,'00:03');
 h.node('reset').listeners.click();assert.equal(h.node('clock').textContent,'00:00');assert.equal(h.timers.size,0);assert.match(h.node('stages').value,/开场/);assert.equal(h.doc.title,'base');
});
test('editing invalidates queued ticks and stage names are rendered as literal text',()=>{
 const h=harness();h.node('stages').value='<b>开场</b> | 2\n总结 | 1';h.node('toggle').listeners.click();const old=[...h.timers.values()][0];assert.equal(h.node('phase').textContent,'<b>开场</b>');
 h.node('stages').listeners.input();h.setNow(99999);old();assert.equal(h.node('phase').textContent,'准备好就开始');assert.equal(h.node('plan').children.length,0);assert.equal(h.timers.size,0);
 h.node('stages').value='错误输入';h.node('toggle').listeners.click();assert.equal(h.timers.size,0);assert.equal(h.node('toggle').textContent,'开始');
});
test('returning from hidden or page cache catches up once and does not duplicate timers',()=>{
 const h=harness();h.node('toggle').listeners.click();h.doc.hidden=true;h.setNow(1500);h.events.visibilitychange();assert.equal(h.timers.size,0);
 h.setNow(6200);h.doc.hidden=false;h.events.visibilitychange();assert.equal(h.node('phase').textContent,'总结');assert.equal(h.node('clock').textContent,'00:01');assert.equal(h.timers.size,1);
 h.windowEvents.pagehide();assert.equal(h.timers.size,0);h.setNow(99999);h.windowEvents.pageshow({persisted:true});assert.equal(h.node('phase').textContent,'全部完成');assert.equal(h.node('progress').value,1000);assert.equal(h.node('toggle').textContent,'重新开始');assert.equal(h.timers.size,0);
 h.node('toggle').listeners.click();assert.equal(h.node('phase').textContent,'开场');assert.equal(h.node('clock').textContent,'00:02');assert.equal(h.timers.size,1);
});
test('all runtime code is embedded and no network or persistent data APIs are used',()=>{
 assert.ok(html.includes("connect-src 'none'"));assert.ok(!/<script[^>]+src=/i.test(html));assert.ok(!/\b(?:fetch|XMLHttpRequest|localStorage|Notification|AudioContext)\b/.test(core+ui));
});
