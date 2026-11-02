import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
const html=readFileSync(new URL('./wifi-qr.html',import.meta.url),'utf8');
const library=html.match(/<script id="wifi-qr-library">([\s\S]*?)<\/script>/)[1];
const core=html.match(/<script id="wifi-qr-core">([\s\S]*?)<\/script>/)[1];
const {buildWifiPayload:payload,createWifiQR:qr,wifiEscape:escape}=runInNewContext(library+'\n'+core+'\n({buildWifiPayload,createWifiQR,wifiEscape})',{TextEncoder});
const input=(extra={})=>({ssid:'Example-Guest',password:'ExampleOnly123',security:'WPA',hidden:false,...extra});

test('builds the documented WIFI payload for a personal password network',()=>{
 assert.equal(payload(input()).payload,'WIFI:T:WPA;S:Example-Guest;P:ExampleOnly123;;');
});
test('open networks omit passwords even when an old password was supplied',()=>{
 const r=payload(input({security:'nopass',password:'DO-NOT-INCLUDE'}));assert.equal(r.payload,'WIFI:T:nopass;S:Example-Guest;;');assert.ok(!r.payload.includes('P:'));assert.ok(!r.payload.includes('DO-NOT-INCLUDE'));assert.ok(!Object.hasOwn(r,'password'));
});
test('escapes all WIFI separators and preserves Unicode without percent or HTML encoding',()=>{
 const r=payload(input({ssid:'客厅;A:B,"C"\\',password:'ab;cd:ef,"g"\\',hidden:true}));
 assert.equal(r.payload,'WIFI:T:WPA;S:客厅\\;A\\:B\\,\\"C\\"\\\\;P:ab\\;cd\\:ef\\,\\"g\\"\\\\;H:true;;');assert.ok(!r.payload.includes('%'));
});
test('preserves case and all spaces rather than trimming or normalizing',()=>{
 const r=payload(input({ssid:' Home Wifi ',password:' abcdEF12 '}));assert.equal(r.ssid,' Home Wifi ');assert.ok(r.payload.includes('S: Home Wifi ;P: abcdEF12 ;'));assert.equal(payload(input({ssid:' '})).ssidBytes,1);
});
test('quotes hexadecimal-looking text but keeps a 64-digit raw key unquoted',()=>{
 assert.equal(escape('ABCD'),'"ABCD"');assert.equal(escape('abcdef12'),'"abcdef12"');
 const r=payload(input({ssid:'1234',password:'abcdef12'}));assert.ok(r.payload.includes('S:"1234";P:"abcdef12";'));
 const key='a1'.repeat(32),raw=payload(input({password:key}));assert.equal(raw.rawKey,true);assert.ok(raw.payload.includes('P:'+key+';'));assert.ok(!raw.payload.includes('P:"'));
});
test('enforces 1 to 32 UTF-8 bytes for SSIDs including Chinese and emoji',()=>{
 for(const ssid of ['A'.repeat(32),'中'.repeat(10)+'ab','😀'.repeat(8)])assert.equal(payload(input({ssid})).ssidBytes,32);
 for(const ssid of ['','A'.repeat(33),'中'.repeat(11),'😀'.repeat(9)])assert.throws(()=>payload(input({ssid})),/1–32/);
});
test('bounds text passwords by encoded bytes and supports the exact raw-key case',()=>{
 for(const password of ['12345678','x'.repeat(63),'中文ab','😀'.repeat(15)+'abc','1'.repeat(64)])assert.doesNotThrow(()=>payload(input({password})));
 for(const password of ['','1234567','g'.repeat(64),'a'.repeat(65),'😀'.repeat(16)])assert.throws(()=>payload(input({password})),/密码/);
});
test('rejects unsupported modes, nonboolean hidden flags and invalid input types',()=>{
 for(const security of ['WEP','WPA2-EAP','WPA3','constructor','',null])assert.throws(()=>payload(input({security})),/类型/);
 for(const hidden of ['true',0,1,null])assert.throws(()=>payload(input({hidden})),/选项/);
 for(const value of [null,42,{},undefined]){assert.throws(()=>payload(input({ssid:value})));assert.throws(()=>payload(input({password:value})));}
});
test('rejects controls and unpaired surrogates instead of encoding altered credentials',()=>{
 for(const value of ['abc\n12345','abc\r12345','abc\t12345','abc\u000012345','abc\u007f12345','abc\u008512345','abc\ud80012345','abc\udfff12345']){assert.throws(()=>payload(input({ssid:value})));assert.throws(()=>payload(input({password:value})));}
});
test('bundles the exact pinned upstream encoder with its MIT license',()=>{
 assert.equal(createHash('sha256').update(library.slice(1,-1)).digest('hex'),'6a1116192ed1dd67fa1bf31e77f5817103d71c23bbac24c382e698b7668bdd01');
 assert.ok(library.includes('Copyright (c) Project Nayuki. (MIT License)'));assert.ok(library.includes('Permission is hereby granted'));assert.ok(!/<script[^>]+src=/i.test(html));assert.ok(html.includes("connect-src 'none'"));
});
test('creates a bounded medium-correction QR with a four-module border and integer pixels',()=>{
 const r=qr(input());assert.equal(r.qr.size,r.qr.version*4+17);assert.ok(r.qr.version>=1&&r.qr.version<=20);assert.equal(r.qr.errorCorrectionLevel.ordinal,1);assert.equal(r.border,4);assert.equal(r.scale,8);assert.equal(r.pixels,(r.qr.size+8)*8);assert.ok(r.qr.mask>=0&&r.qr.mask<=7);
});
test('finder modules are intact and repeated generation is deterministic',()=>{
 const a=qr(input()),b=qr(input());assert.equal(a.qr.size,b.qr.size);
 for(let y=0;y<a.qr.size;y++)for(let x=0;x<a.qr.size;x++)assert.equal(a.qr.getModule(x,y),b.qr.getModule(x,y));
 for(let y=0;y<7;y++)for(let x=0;x<7;x++){const dark=x===0||x===6||y===0||y===6||(x>=2&&x<=4&&y>=2&&y<=4);assert.equal(a.qr.getModule(x,y),dark);}
});
test('maximum heavily escaped and Unicode credentials still fit without truncation',()=>{
 for(const extra of [{ssid:';'.repeat(32),password:':'.repeat(63),hidden:true},{ssid:'😀'.repeat(8),password:'😀'.repeat(15)+'abc'},{ssid:'a'.repeat(32),password:'F'.repeat(64)}]){const r=qr(input(extra));assert.equal(r.payload,payload(input(extra)).payload);assert.ok(r.qr.version<=20);}
});
test('200 varied payloads preserve field boundaries and distinguish hidden/open settings',()=>{
 for(let n=1;n<=200;n++){
  const a=input({ssid:'网络-'+n,password:'Password-'+n,hidden:n%2===0,security:n%3===0?'nopass':'WPA'}),r=payload(a);
  assert.ok(r.payload.startsWith('WIFI:T:'+a.security+';S:'+a.ssid+';'));assert.equal(r.payload.includes('H:true;'),a.hidden);assert.equal(r.payload.includes('P:'),a.security==='WPA');assert.ok(r.payload.endsWith(';;'));
 }
});

function uiHarness(){
 const elements=new Map();
 for(const m of html.matchAll(/<(?:input|select|canvas|button|p|div)[^>]*\bid="([^"]+)"[^>]*>/g))elements.set(m[1],{value:'',checked:false,disabled:/\bdisabled\b/.test(m[0]),hidden:/\bhidden\b/.test(m[0]),type:'password',listeners:{},addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}});
 const canvas=elements.get('qr');canvas.getContext=()=>({fillStyle:'',fillRect(){}});let callback=null,downloads=0;canvas.toBlob=cb=>{callback=cb;};
 const document={getElementById:id=>elements.get(id),addEventListener(){},body:{append(){}},createElement:()=>({click(){downloads++;},remove(){}})};
 const scripts=Array.from(html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g),m=>m[1]).join('\n');
 runInNewContext(scripts,{TextEncoder,document,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},Blob});
 return {get:id=>elements.get(id),emit:(id,type)=>(elements.get(id).listeners[type]||[]).forEach(fn=>fn({})),export:blob=>callback(blob),downloads:()=>downloads};
}
test('switching to an open network clears the password and disables stale downloads',()=>{
 const ui=uiHarness();ui.emit('example','click');assert.equal(ui.get('result').hidden,false);ui.get('security').value='nopass';ui.emit('security','change');assert.equal(ui.get('password').value,'');assert.equal(ui.get('password').disabled,true);assert.equal(ui.get('show-password').checked,false);assert.equal(ui.get('result').hidden,true);assert.equal(ui.get('download').disabled,true);
});
test('changing credentials while PNG export is pending prevents an old download',()=>{
 const ui=uiHarness();ui.emit('example','click');ui.emit('download','click');assert.equal(ui.get('download').disabled,true);ui.get('ssid').value='Changed';ui.emit('ssid','input');ui.export(new Blob(['synthetic']));assert.equal(ui.downloads(),0);assert.equal(ui.get('result').hidden,true);assert.equal(ui.get('download').disabled,true);assert.equal(ui.get('qr').width,0);
});
test('null PNG export reports failure while password visibility leaves the current QR usable',()=>{
 const ui=uiHarness();ui.emit('example','click');ui.get('show-password').checked=true;ui.emit('show-password','change');assert.equal(ui.get('password').type,'text');assert.equal(ui.get('result').hidden,false);
 ui.emit('download','click');ui.export(null);assert.equal(ui.downloads(),0);assert.equal(ui.get('download').disabled,false);assert.ok(ui.get('status').textContent.includes('导出失败'));ui.emit('clear','click');assert.equal(ui.get('password').value,'');assert.equal(ui.get('result').hidden,true);
});
