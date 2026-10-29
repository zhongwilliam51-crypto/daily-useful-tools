import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
const html=readFileSync(new URL('./transfer-time.html',import.meta.url),'utf8');
const core=html.match(/<script id="transfer-time-core">([\s\S]*?)<\/script>/)[1];
const {estimateTransfer,transferQuantity,transferDuration,transferDecimal}=runInNewContext(core+'\n({estimateTransfer,transferQuantity,transferDuration,transferDecimal})');
const calc=(size='10',sizeUnit='GB',speed='100',speedUnit='Mbps',percent='100')=>estimateTransfer(size,sizeUnit,speed,speedUnit,percent);

test('10 GB at 100 Mbps takes 800 seconds and equals 12.5 MB/s',()=>{
  const r=calc();assert.equal(r.seconds,800n);assert.equal(r.duration,'13 分钟 20 秒');assert.equal(r.effectiveMBps,'12.5');
});
test('a user-selected 80 percent scenario increases time to 1000 seconds',()=>{
  const r=calc('10','GB','100','Mbps','80');assert.equal(r.seconds,1000n);assert.equal(r.idealSeconds,800n);assert.equal(r.effectiveMBps,'10');
});
test('bits and bytes per second differ by a factor of eight',()=>{
  assert.equal(calc('100','MB','1','Mbps').seconds,800n);
  assert.equal(calc('100','MB','1','MB/s').seconds,100n);
  assert.equal(calc('1','GB','1','Gbps').seconds,8n);
});
test('decimal and binary capacity units remain distinct',()=>{
  assert.equal(calc('1','GB','1','MB/s').seconds,1000n);
  assert.equal(calc('1','GiB','1','MiB/s').seconds,1024n);
  assert.equal(calc('1','TB','1','MB/s').seconds,1000000n);
  assert.equal(calc('1','TiB','1','MiB/s').seconds,1048576n);
});
test('supports decimal and binary kilobyte transfer rates',()=>{
  assert.equal(calc('1','MB','1000','KB/s').seconds,1n);
  assert.equal(calc('1','MiB','1024','KiB/s').seconds,1n);
  assert.equal(calc('1','MiB','1000','KB/s').seconds,2n);
});
test('rounds up fractional seconds without ever displaying a positive transfer as zero',()=>{
  assert.equal(calc('0.001','MB','1000000','Gbps').seconds,1n);
  assert.equal(calc('1','MB','3','MB/s').seconds,1n);
  assert.equal(calc('10','MB','3','MB/s').seconds,4n);
});
test('parses three decimal places, leading decimal points and trimmed numbers exactly',()=>{
  assert.equal(transferQuantity(' .125 ','大小'),125n);
  assert.equal(transferQuantity('0001.2','大小'),1200n);
  assert.equal(calc(' 1.25 ','MB',' .5 ','MB/s').seconds,3n);
});
test('rejects zero, negative, nonfinite, exponent and excessive-precision quantities',()=>{
  for(const value of ['',null,'0','-1','+1','1e3','NaN','Infinity','1,000','1.0001','1.','1000000.001','1000001']){
    assert.throws(()=>calc(value));assert.throws(()=>calc('1','MB',value));
  }
});
test('requires an integer percentage from 1 through 100',()=>{
  for(const value of ['',null,'0','101','1.5','-1','1e2','+1'])assert.throws(()=>calc('1','MB','1','MB/s',value));
  assert.equal(calc('1','MB','1','MB/s','1').seconds,100n);
  assert.equal(calc('1','MB','1','MB/s',' 100 ').seconds,1n);
});
test('rejects unknown and object-like unit names',()=>{
  for(const unit of ['mb','Mbit','constructor','__proto__','',null]){
    assert.throws(()=>calc('1',unit));assert.throws(()=>calc('1','MB','1',unit));
  }
});
test('keeps very large durations exact using integer arithmetic',()=>{
  const r=calc('1000000','TiB','0.001','KB/s','1');
  assert.equal(r.seconds,109951162777600000000n);
  assert.ok(r.seconds>BigInt(Number.MAX_SAFE_INTEGER));assert.match(r.duration,/天/);
});
test('formats durations across second, minute, hour and day boundaries',()=>{
  for(const [n,text] of [[0n,'0 秒'],[1n,'1 秒'],[60n,'1 分钟'],[3600n,'1 小时'],[86400n,'1 天'],[90061n,'1 天 1 小时 1 分钟 1 秒']])assert.equal(transferDuration(n),text);
});
test('formats effective speed without showing a tiny positive rate as zero',()=>{
  assert.equal(transferDecimal(1n,100000n),'<0.001');assert.equal(transferDecimal(1n,8n),'0.125');
  assert.equal(transferDecimal(1n,3n),'0.333');assert.equal(transferDecimal(1n,16n),'0.063');
  assert.equal(calc('1','MB','0.001','KB/s','1').effectiveMBps,'<0.001');
});
test('copy output states input units, scenario, rounding and estimation limits',()=>{
  const r=calc('10','GB','100','Mbps','80');
  for(const phrase of ['10 GB','100 Mbps','80%','16 分钟 40 秒','100%','向上取整到秒','假设速度恒定'])assert.ok(r.text.includes(phrase));
});
test('500 varied scenarios use the smallest whole second that covers transfer time',()=>{
  for(let i=1;i<=500;i++){
    const size=1+i*37%10000,speed=1+i*19%10000,percent=1+i%100;
    const r=calc(String(size),'GB',String(speed),'Mbps',String(percent));
    const n=BigInt(size)*1000000000n*8n*100n,d=BigInt(speed)*1000000n*BigInt(percent);
    assert.ok(r.seconds*d>=n);assert.ok((r.seconds-1n)*d<n);assert.ok(r.seconds>=r.idealSeconds);
  }
});
