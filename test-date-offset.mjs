import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
const html = readFileSync(new URL('./date-offset.html', import.meta.url), 'utf8');
const core = html.match(/<script id="date-offset-core">([\s\S]*?)<\/script>/)[1];
const { calculateOffset, parseOffsetDate, offsetDateText, offsetWeekdayText } = runInNewContext(core + '\n({ calculateOffset, parseOffsetDate, offsetDateText, offsetWeekdayText })');
const calc = (start, count, direction = 'after', mode = 'calendar') => calculateOffset(start, count, direction, mode);

test('adds calendar days, excluding the start day', () => {
  const r = calc('2026-10-26', '10');
  assert.equal(r.result, '2026-11-05'); assert.equal(r.weekday, '星期四'); assert.equal(r.calendarDays, 10); assert.equal(r.skipped, 0);
});
test('subtracts days across month and year boundaries', () => {
  assert.equal(calc('2027-01-01','1','before').result,'2026-12-31');
  assert.equal(calc('2026-03-01','1','before').result,'2026-02-28');
  assert.equal(calc('2026-12-31','1').result,'2027-01-01');
});
test('counts only Monday through Friday, skipping weekends', () => {
  const r = calc('2026-10-26','10','after','weekdays');
  assert.equal(r.result,'2026-11-09'); assert.equal(r.weekday,'星期一'); assert.equal(r.calendarDays,14); assert.equal(r.skipped,4);
  assert.equal(calc('2026-10-30','1','after','weekdays').result,'2026-11-02');
  assert.equal(calc('2026-11-02','1','before','weekdays').result,'2026-10-30');
});
test('weekend starting dates move to the next or previous counted weekday', () => {
  for (const start of ['2026-10-31','2026-11-01']) {
    assert.equal(calc(start,'1','after','weekdays').result,'2026-11-02');
    assert.equal(calc(start,'1','before','weekdays').result,'2026-10-30');
  }
});
test('zero leaves every date unchanged including weekends', () => {
  for(const mode of ['calendar','weekdays']) for(const direction of ['after','before']) {
    const r=calc('2026-11-01','0',direction,mode);
    assert.equal(r.result,'2026-11-01'); assert.equal(r.calendarDays,0); assert.equal(r.skipped,0);
  }
});
test('handles Gregorian leap-year rules including century exceptions', () => {
  assert.equal(calc('2024-02-28','1').result,'2024-02-29');
  assert.equal(calc('2000-02-28','1').result,'2000-02-29');
  assert.equal(calc('1900-02-28','1').result,'1900-03-01');
  assert.equal(calc('2100-02-28','1').result,'2100-03-01');
  for(const date of ['1900-02-29','2100-02-29','2026-02-29']) assert.throws(()=>parseOffsetDate(date));
});
test('rejects invalid, incomplete, normalized or out-of-range dates', () => {
  for(const date of ['',null,123,'2026-2-01','2026-02-30','2026-04-31','2026-13-01','2026-00-01','2026-01-00','2026-01-32','1899-12-31','2101-01-01','2026-10-26T00:00:00Z',' 2026-10-26 ']) assert.throws(()=>parseOffsetDate(date),String(date));
});
test('rejects negative, fractional, exponent, nonfinite and excessive counts', () => {
  for(const count of ['',null,'-1','1.5','1e2','NaN','Infinity','1,000','+1','36501','100000']) assert.throws(()=>calc('2026-10-26',count));
  assert.equal(calc('2026-10-26',' 001 ').result,'2026-10-27');
});
test('rejects unknown directions and count modes', () => {
  for(const direction of ['',null,'future']) assert.throws(()=>calc('2026-10-26','1',direction));
  for(const mode of ['',null,'holidays']) assert.throws(()=>calc('2026-10-26','1','after',mode));
});
test('permits exact range edges and refuses overflow for both count modes', () => {
  assert.equal(calc('1900-01-01','0').result,'1900-01-01');
  assert.equal(calc('2100-12-31','0').result,'2100-12-31');
  for(const mode of ['calendar','weekdays']) {
    assert.throws(()=>calc('1900-01-01','1','before',mode),/超出/);
    assert.throws(()=>calc('2100-12-31','1','after',mode),/超出/);
  }
});
test('supports the maximum count without truncation', () => {
  const r=calc('1900-01-01','36500'); assert.equal(r.calendarDays,36500);
  const w=calc('1900-01-01','36500','after','weekdays');
  assert.equal(w.calendarDays,51100); assert.equal(w.skipped,14600);
});
test('uses calendar dates consistently through daylight-saving transitions', () => {
  for(const date of ['2026-03-07','2026-10-31','2026-03-28']) {
    const r=calc(date,'2'); assert.equal(parseOffsetDate(r.result)-parseOffsetDate(date),2);
  }
});
test('formats weekdays correctly before and after the Unix epoch', () => {
  assert.equal(offsetWeekdayText(parseOffsetDate('1900-01-01')),'星期一');
  assert.equal(offsetWeekdayText(parseOffsetDate('1969-12-31')),'星期三');
  assert.equal(offsetWeekdayText(parseOffsetDate('1970-01-01')),'星期四');
  assert.equal(offsetDateText(parseOffsetDate('2000-02-29')),'2000-02-29');
});
test('copy text explains start exclusion and the limits of weekday counting', () => {
  const r=calc('2026-10-26','10','after','weekdays');
  assert.match(r.text,/2026-11-09（星期一）/); assert.match(r.text,/未扣除公众假期或调休/); assert.match(r.text,/不计起始日/); assert.match(r.text,/跳过 4 个周末日/);
});
test('500 varied offsets are reversible and reconcile skipped days', () => {
  for(let i=0;i<500;i++) {
    const startDay=parseOffsetDate('2000-01-01')+i*37, start=offsetDateText(startDay), count=String(i%61);
    const direction=i%2?'after':'before', reverse=i%2?'before':'after';
    const r=calc(start,count,direction);
    assert.equal(calc(r.result,count,reverse).result,start);
    const w=calc(start,count,direction,'weekdays');
    assert.equal(w.calendarDays,Number(count)+w.skipped);
    if(Number(count)>0) assert.ok(!['星期六','星期日'].includes(w.weekday));
    if(!['星期六','星期日'].includes(offsetWeekdayText(startDay))) assert.equal(calc(w.result,count,reverse,'weekdays').result,start);
  }
});
