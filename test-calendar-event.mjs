import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
const html=readFileSync(new URL('./calendar-event.html',import.meta.url),'utf8');
const core=html.match(/<script id="calendar-event-core">([\s\S]*?)<\/script>/)[1];
const {makeCalendarEvent:make,calendarFold:fold,calendarDate:date,calendarEscape:escape}=runInNewContext(core+'\n({makeCalendarEvent,calendarFold,calendarDate,calendarEscape})',{Date,TextEncoder,crypto:webcrypto});
const options={uid:'example-001@daily-useful-tools.invalid',now:new Date('2026-11-01T12:00:00Z')};
const input=(extra={})=>({title:'小组讨论',location:'社区活动室',description:'带上笔记本。\n讨论安排。',allDay:false,startDate:'2026-11-02',endDate:'2026-11-02',startTime:'14:30',endTime:'15:30',...extra});
const calc=(extra={})=>make(input(extra),options);
const unfold=text=>text.replace(/\r\n[ \t]/g,'');

test('converts a fixed UTC+08:00 event to unambiguous UTC timestamps',()=>{
 const r=calc();assert.equal(r.start,'20261102T063000Z');assert.equal(r.end,'20261102T073000Z');assert.ok(r.ics.includes('DTSTAMP:20261101T120000Z\r\n'));assert.ok(r.rule.includes('UTC+08:00'));assert.ok(!r.ics.includes('TZID'));
});
test('handles midnight and year crossings without depending on the device timezone',()=>{
 const r=calc({startDate:'2026-12-31',endDate:'2027-01-01',startTime:'23:30',endTime:'00:30'});assert.equal(r.start,'20261231T153000Z');assert.equal(r.end,'20261231T163000Z');
 const early=calc({startDate:'2026-01-01',endDate:'2026-01-01',startTime:'00:00',endTime:'00:01'});assert.equal(early.start,'20251231T160000Z');assert.equal(early.end,'20251231T160100Z');
});
test('a one-day all-day event writes the following day as exclusive DTEND',()=>{
 const r=calc({allDay:true,startTime:'',endTime:''});assert.equal(r.start,'20261102');assert.equal(r.end,'20261103');assert.ok(r.ics.includes('DTSTART;VALUE=DATE:20261102\r\nDTEND;VALUE=DATE:20261103'));assert.ok(r.dates.includes('共 1 天'));assert.ok(r.rule.includes('包含结束日期'));
});
test('multi-day all-day events include the last day across leap day and month boundaries',()=>{
 const r=calc({allDay:true,startDate:'2024-02-28',endDate:'2024-03-01'});assert.equal(r.start,'20240228');assert.equal(r.end,'20240302');assert.ok(r.dates.includes('共 3 天'));
 assert.equal(calc({allDay:true,startDate:'2026-12-31',endDate:'2026-12-31'}).end,'20270101');
});
test('permits exact date limits and represents converted endpoints outside the input range correctly',()=>{
 assert.equal(calc({startDate:'1900-01-01',endDate:'1900-01-01',startTime:'00:00',endTime:'00:01'}).start,'18991231T160000Z');
 assert.equal(calc({allDay:true,startDate:'2100-12-31',endDate:'2100-12-31'}).end,'21010101');
});
test('rejects nonexistent, incomplete, out-of-range or normalized calendar dates',()=>{
 for(const value of ['2026-02-29','1900-02-29','2100-02-29','2026-04-31','2026-00-01','2026-13-01','2026-01-00','1899-12-31','2101-01-01','2026-1-01','',null]){assert.throws(()=>calc({startDate:value}));assert.throws(()=>calc({endDate:value}));}
 assert.ok(Number.isFinite(date('2000-02-29','日期')));
});
test('rejects invalid, equal and backwards times rather than assuming the next day',()=>{
 for(const value of ['24:00','12:60','9:00','12:30:00','-1:00','',null]){assert.throws(()=>calc({startTime:value}));assert.throws(()=>calc({endTime:value}));}
 assert.throws(()=>calc({endTime:'14:30'}),/晚于/);assert.throws(()=>calc({endTime:'14:00'}),/跨午夜/);assert.throws(()=>calc({endDate:'2026-11-01'}),/晚于/);
});
test('all-day mode ignores clock fields but validates date ordering and mode type',()=>{
 assert.doesNotThrow(()=>calc({allDay:true,startTime:null,endTime:'not a time'}));assert.throws(()=>calc({allDay:true,endDate:'2026-11-01'}),/早于/);
 for(const allDay of ['true',0,1,null,undefined])assert.throws(()=>calc({allDay}),/类型/);
});
test('escapes TEXT delimiters, backslashes and normalized newlines without escaping colons',()=>{
 assert.equal(escape('a,b;c\\d\nx:y'),'a\\,b\\;c\\\\d\\nx:y');
 const r=calc({title:'讨论,复盘;A\\B',description:'第一行\r\n第二行\r第三行:结束'});const text=unfold(r.ics);
 assert.ok(text.includes('SUMMARY:讨论\\,复盘\\;A\\\\B\r\n'));assert.ok(text.includes('DESCRIPTION:第一行\\n第二行\\n第三行:结束\r\n'));
});
test('folds every physical line to at most 75 UTF-8 bytes without splitting Unicode characters',()=>{
 const title='中😀'.repeat(40),description='甲,乙;😀\\'.repeat(200);const r=calc({title,description});
 for(const line of r.ics.split('\r\n')){assert.ok(Buffer.byteLength(line,'utf8')<=75);assert.ok(!line.includes('\ufffd'));}
 assert.ok(unfold(r.ics).includes('SUMMARY:'+escape(title)+'\r\n'));assert.ok(unfold(r.ics).includes('DESCRIPTION:'+escape(description)+'\r\n'));
 const exact='A'.repeat(75);assert.equal(fold(exact),exact);assert.equal(fold(exact+'B'),exact+'\r\n B');
});
test('prevents property injection through single-line fields and multiline notes',()=>{
 for(const field of ['title','location'])assert.throws(()=>calc({[field]:'ok\r\nBEGIN:VEVENT'}),/控制字符|换行/);
 const r=calc({description:'safe\nEND:VEVENT\nBEGIN:VEVENT\nSUMMARY:injected'});const lines=unfold(r.ics).split('\r\n');assert.equal(lines.filter(x=>x==='BEGIN:VEVENT').length,1);assert.equal(lines.filter(x=>x==='END:VEVENT').length,1);assert.ok(lines.some(x=>x.includes('safe\\nEND:VEVENT\\nBEGIN:VEVENT')));
});
test('bounds text by Unicode code points, rejects invalid Unicode and preserves literal markup',()=>{
 assert.equal(calc({title:'😀'.repeat(80)}).title.length,160);
 for(const extra of [{title:'x'.repeat(81)},{location:'x'.repeat(121)},{description:'x'.repeat(2001)},{title:' '},{title:null},{location:42},{description:null},{title:'bad\ud800'},{description:'bad\udfff'},{description:'a\u0000b'}])assert.throws(()=>calc(extra));
 assert.ok(unfold(calc({title:'<b>活动</b>'}).ics).includes('SUMMARY:<b>活动</b>'));
});
test('omits optional blank fields and includes exactly one event with required metadata',()=>{
 const r=calc({location:' ',description:'\r\n'});const text=unfold(r.ics);assert.ok(text.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));assert.ok(text.endsWith('END:VEVENT\r\nEND:VCALENDAR\r\n'));
 for(const key of ['UID','DTSTAMP','DTSTART','DTEND','SUMMARY'])assert.equal(text.split('\r\n').filter(x=>x.startsWith(key+':')).length,1,key);
 assert.ok(!text.includes('LOCATION:'));assert.ok(!text.includes('DESCRIPTION:'));assert.ok(!text.replace(/\r\n/g,'').includes('\n'));
});
test('validates event identity and timestamp metadata before serializing',()=>{
 for(const uid of ['',null,'bad\nSUMMARY:injected','x'.repeat(121)])assert.throws(()=>make(input(),{...options,uid}),/标识/);
 for(const now of [new Date(NaN),'2026-11-01',new Date('0000-01-01T00:00:00Z'),new Date('+010000-01-01T00:00:00Z')])assert.throws(()=>make(input(),{...options,now}),/设备时间/);
});
test('new generations have distinct random identifiers and missing randomness fails explicitly',()=>{
 assert.notEqual(make(input()).uid,make(input()).uid);
 const other=runInNewContext(core+'\n({makeCalendarEvent})',{Date,TextEncoder});assert.throws(()=>other.makeCalendarEvent(input()),/事件标识/);
});
test('download filename and copied information describe the actual event without enabling alerts or invitations',()=>{
 const r=calc();assert.equal(r.filename,'calendar-event-20261102.ics');for(const phrase of ['小组讨论','14:30','15:30','UTC+08:00','社区活动室','带上笔记本','未设置提醒或邀请'])assert.ok(r.text.includes(phrase));
 for(const name of ['VALARM','RRULE','ATTENDEE','ORGANIZER','METHOD:'])assert.ok(!r.ics.includes(name));
});
test('500 varied UTC timestamps round trip through an independent UTC+08:00 formatter',()=>{
 const fmt=new Intl.DateTimeFormat('sv-SE',{timeZone:'Etc/GMT-8',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 for(let i=0;i<500;i++){
  const day=new Date(Date.UTC(1900+i%201,i*7%12,1+i%27)).toISOString().slice(0,10),h=i*11%23,m=i*17%60;
  const hh=String(h).padStart(2,'0'),mm=String(m).padStart(2,'0');const r=calc({startDate:day,endDate:day,startTime:hh+':'+mm,endTime:String(h+1).padStart(2,'0')+':'+mm});
  const iso=r.start.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,'$1-$2-$3T$4:$5:$6Z');assert.equal(fmt.format(new Date(iso)),day+' '+hh+':'+mm);
 }
});
