import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
const html=readFileSync(new URL('./leave-plan.html',import.meta.url),'utf8');
const core=html.match(/<script id="leave-plan-core">([\s\S]*?)<\/script>/)[1];
const {makeLeavePlan:plan,leaveSteps:steps,leaveMoment:moment}=runInNewContext(core+'\n({makeLeavePlan,leaveSteps,leaveMoment})');
const calc=(date='2026-11-04',time='09:00',travel='35',buffer='10',raw='洗漱 20\n早餐 15\n收包 10')=>plan(date,time,travel,buffer,raw);
const arr=x=>Array.from(x);

test('everyday example starts preparation at 07:30, leaves at 08:15 and arrives early at 08:50',()=>{
 const r=calc();assert.equal(r.beginText,'2026-11-04 07:30');assert.equal(r.departureText,'2026-11-04 08:15');assert.equal(r.earlyText,'2026-11-04 08:50');assert.equal(r.targetText,'2026-11-04 09:00');assert.equal(r.prep,45);assert.equal(r.totalMinutes,90);
});
test('retains step order, duplicates, source line numbers and individual time intervals',()=>{
 const r=calc('2026-11-04','09:00','0','0','收包 5\n\n洗漱 20\n收包 10');assert.deepEqual(arr(r.steps.map(s=>s.name)),['收包','洗漱','收包']);assert.deepEqual(arr(r.steps.map(s=>s.line)),[1,3,4]);assert.deepEqual(arr(r.stages.map(s=>moment(s.start))),['2026-11-04 08:25','2026-11-04 08:30','2026-11-04 08:50']);
});
test('crossing midnight produces explicit previous-day times',()=>{
 const r=calc('2026-11-04','00:20');assert.equal(r.beginText,'2026-11-03 22:50');assert.equal(r.departureText,'2026-11-03 23:35');assert.equal(r.earlyText,'2026-11-04 00:10');
});
test('handles year crossings and Gregorian leap days',()=>{
 assert.equal(calc('2027-01-01','00:20').beginText,'2026-12-31 22:50');
 assert.equal(calc('2024-03-01','00:00','30','0','').departureText,'2024-02-29 23:30');
 assert.equal(calc('2000-03-01','00:00','30','0','').departureText,'2000-02-29 23:30');
 assert.equal(calc('2100-03-01','00:00','30','0','').departureText,'2100-02-28 23:30');
});
test('all-zero travel and buffer with no preparation returns the target without artificial stages',()=>{
 const r=calc('2026-11-04','09:00','0','0',' \n\t');assert.equal(r.begin,r.target);assert.equal(r.departure,r.target);assert.equal(r.earlyArrival,r.target);assert.equal(r.stages.length,0);assert.equal(r.totalMinutes,0);
});
test('omits only zero-duration road or buffer stages and preserves a continuous plan',()=>{
 const a=calc('2026-11-04','09:00','35','10','');assert.equal(a.begin,a.departure);assert.deepEqual(arr(a.stages.map(s=>s.kind)),['travel','buffer']);
 const b=calc('2026-11-04','09:00','0','10','准备 5');assert.deepEqual(arr(b.stages.map(s=>s.kind)),['prepare','buffer']);assert.equal(b.stages[0].end,b.stages[1].start);
 assert.deepEqual(arr(calc('2026-11-04','09:00','35','0','').stages.map(s=>s.kind)),['travel']);
});
test('permits exact date boundaries and rejects a preparation result below the lower bound',()=>{
 assert.equal(calc('1900-01-01','00:00','0','0','').beginText,'1900-01-01 00:00');assert.equal(calc('2100-12-31','23:59','0','0','').beginText,'2100-12-31 23:59');
 assert.throws(()=>calc('1900-01-01','00:00','1','0',''),/早于/);assert.throws(()=>calc('1900-01-01','00:00','0','0','准备 1'),/早于/);
});
test('rejects invalid, incomplete and normalized dates or unsupported clocks',()=>{
 for(const d of ['2026-02-29','1900-02-29','2100-02-29','2026-04-31','2026-00-01','2026-13-01','2026-01-00','1899-12-31','2101-01-01','2026-1-01','',null])assert.throws(()=>calc(d));
 for(const t of ['24:00','12:60','9:00','09:00:00','09:00Z','',null])assert.throws(()=>calc('2026-11-04',t));
});
test('accepts trimmed integral minute values and exact route/buffer limits',()=>{
 const r=calc('2026-11-04','09:00',' 0035 ',' 0010 ');assert.equal(r.travel,35);assert.equal(r.buffer,10);
 const max=calc('2026-11-04','09:00','1440','240','');assert.equal(max.totalMinutes,1680);assert.equal(max.beginText,'2026-11-03 05:00');
});
test('rejects missing, negative, fractional, exponent and excessive minute inputs',()=>{
 for(const raw of ['',null,35,'-1','+1','1.0','0.5','1e2','NaN','Infinity','10000']){assert.throws(()=>calc('2026-11-04','09:00',raw));assert.throws(()=>calc('2026-11-04','09:00','35',raw));}
 assert.throws(()=>calc('2026-11-04','09:00','1441'));assert.throws(()=>calc('2026-11-04','09:00','35','241'));
});
test('parses spaces, tabs, multiword names and all common newline conventions',()=>{
 const r=steps('  洗漱  20 \r\n\r检查 门窗\t5\nTake a bag 10\r');assert.deepEqual(arr(r.map(s=>s.name)),['洗漱','检查 门窗','Take a bag']);assert.deepEqual(arr(r.map(s=>s.minutes)),[20,5,10]);
});
test('requires complete positive preparation durations and reports original lines',()=>{
 for(const raw of ['洗漱','洗漱 0','洗漱 -1','洗漱 1.5','洗漱 1e2','洗漱 241','洗漱 20分钟','洗漱：20','20'])assert.throws(()=>steps(raw));
 assert.throws(()=>steps('\n洗漱 20\n\n坏行'),/第 4 行/);assert.throws(()=>steps(null),/逐行文字/);
});
test('supports eight maximum-length steps without discarding any and rejects a ninth',()=>{
 const raw=Array.from({length:8},(_,i)=>'步骤'+i+' 240').join('\n');const r=calc('2026-11-04','09:00','1440','240',raw);assert.equal(r.prep,1920);assert.equal(r.totalMinutes,3600);assert.equal(r.stages.length,10);assert.equal(r.beginText,'2026-11-01 21:00');
 assert.throws(()=>steps(raw+'\n第九步 1'),/最多 8/);
});
test('bounds original text and Unicode code points without truncating, and rejects controls or invalid Unicode',()=>{
 assert.equal(steps(' '.repeat(1997)+'x 1').length,1);assert.throws(()=>steps(' '.repeat(1998)+'x 1'),/2,000/);
 assert.equal(steps('😀'.repeat(40)+' 1')[0].name.length,80);assert.throws(()=>steps('😀'.repeat(41)+' 1'),/40/);
 for(const raw of ['坏\u0000名 1','坏\u0085名 1','坏\ud800名 1'])assert.throws(()=>steps(raw),/不支持/);
 assert.equal(steps('<b>准备</b> 1')[0].name,'<b>准备</b>');
});
test('copied report contains full dates, every stage, assumptions and early arrival',()=>{
 const r=calc('2026-11-04','00:20');for(const phrase of ['固定 UTC+08:00','2026-11-03 22:50','2026-11-03 23:35','2026-11-04 00:10','2026-11-04 00:20','洗漱','早餐','收包','路程','提前到达 / 机动','自行估计','未读取路况'])assert.ok(r.text.includes(phrase),phrase);
});
test('500 varied plans conserve minutes and form contiguous positive stages in input order',()=>{
 for(let i=0;i<500;i++){
  const date=new Date(Date.UTC(1901+i%199,i*7%12,1+i%27)).toISOString().slice(0,10),time=String(i%24).padStart(2,'0')+':'+String(i*13%60).padStart(2,'0');
  const durations=Array.from({length:i%9},(_,n)=>1+(n*41+i*19)%240),travel=i*17%1441,buffer=i*11%241;
  const r=calc(date,time,String(travel),String(buffer),durations.map((n,j)=>'步骤'+j+' '+n).join('\n'));
  assert.equal((r.target-r.begin)/60000,durations.reduce((a,b)=>a+b,0)+travel+buffer);assert.ok(r.begin<=r.departure&&r.departure<=r.earlyArrival&&r.earlyArrival<=r.target);
  let cursor=r.begin;for(const stage of r.stages){assert.equal(stage.start,cursor);assert.ok(stage.end>stage.start);assert.equal(stage.end-stage.start,stage.minutes*60000);cursor=stage.end;}assert.equal(cursor,r.target);
  assert.deepEqual(arr(r.stages.filter(s=>s.kind==='prepare').map(s=>s.minutes)),durations);assert.equal(r.targetText,date+' '+time);
 }
});
