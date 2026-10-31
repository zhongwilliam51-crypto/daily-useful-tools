import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {webcrypto, createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
const html=readFileSync(new URL('./file-checksum.html',import.meta.url),'utf8');
const core=html.match(/<script id="file-checksum-core">([\s\S]*?)<\/script>/)[1];
const {hashLocalFile:hash,checksumExpected:expected,checksumFileValid:valid,checksumSize:size}=runInNewContext(core+'\n({hashLocalFile,checksumExpected,checksumFileValid,checksumSize})',{ArrayBuffer,Uint8Array,crypto:webcrypto});
const file=(data,name='sample.bin')=>new File([data],name);
const ABC='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

test('computes the known SHA-256 of abc and matches an uppercase expected value',async()=>{
 const r=await hash(file('abc'),' '+ABC.toUpperCase()+'\n');assert.equal(r.hash,ABC);assert.equal(r.match,true);assert.equal(r.expected,ABC);assert.equal(r.byteLength,3);
});
test('empty files have the standard nonempty SHA-256 and are accepted',async()=>{
 const r=await hash(file(''));assert.equal(r.hash,'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');assert.equal(r.byteLength,0);assert.equal(r.match,null);
});
test('does not claim a match when no expected value was supplied',async()=>{
 const r=await hash(file('abc'));assert.equal(r.match,null);assert.equal(r.verdict,'已计算，尚未核对');assert.ok(r.text.includes('预期值：未提供'));
});
test('reports a valid but different checksum as a mismatch',async()=>{
 const r=await hash(file('abc'),'0'.repeat(64));assert.equal(r.match,false);assert.equal(r.verdict,'校验值不一致');
});
test('file name and type do not alter the content digest',async()=>{
 const a=await hash(file('abc','old.txt')),b=await hash(new File(['abc'],'新文件.pdf',{type:'application/pdf'}));assert.equal(a.hash,b.hash);assert.equal(b.name,'新文件.pdf');
});
test('every byte including newlines, NUL and Unicode encoding contributes to the digest',async()=>{
 const cases=['abc\n','abc\r\n','中文😀\u0000','é','e\u0301',new Uint8Array([0,255,128,1,0])];const hashes=new Set();
 for(const data of cases){const f=file(data);const r=await hash(f);assert.equal(r.hash,createHash('sha256').update(Buffer.from(await f.arrayBuffer())).digest('hex'));hashes.add(r.hash);}
 assert.equal(hashes.size,cases.length);assert.ok(!hashes.has(ABC));
});
test('rejects malformed expected values before reading the file',async()=>{
 let reads=0;const f={name:'a',size:0,arrayBuffer:async()=>{reads++;return new ArrayBuffer(0);}};
 for(const value of ['0'.repeat(63),'0'.repeat(65),'g'.repeat(64),'SHA256:'+ABC,ABC+' file.txt',ABC.slice(0,32)+' '+ABC.slice(32),null,42])await assert.rejects(hash(f,value),/校验值|64 位/);
 assert.equal(reads,0);assert.equal(expected(' \n\t '),'');
});
test('accepts exactly 64 MiB and rejects one byte over without reading it',async()=>{
 let reads=0;const f={name:'large.bin',size:67108864,arrayBuffer:async()=>{reads++;return new ArrayBuffer(0);}};assert.doesNotThrow(()=>valid(f));
 await assert.rejects(hash({...f,size:67108865}),/64 MiB/);assert.equal(reads,0);
});
test('requires a valid readable file and a nonnegative integral byte count',async()=>{
 for(const value of [null,{},new Blob(['abc']),{name:'a',size:3},{name:'a',size:-1,arrayBuffer(){}},{name:'a',size:0.5,arrayBuffer(){}},{name:'a',size:NaN,arrayBuffer(){}}])await assert.rejects(hash(value),/有效文件/);
});
test('fails clearly when Web Crypto is unavailable or the digest fails',async()=>{
 await assert.rejects(hash(file('abc'),'',null),/Web Crypto/);await assert.rejects(hash(file('abc'),'',{}),/Web Crypto/);
 await assert.rejects(hash(file('abc'),'',{digest:async()=>{throw new Error('internal');}}),/计算失败/);
});
test('reports inaccessible files and rejects partial or non-buffer reads',async()=>{
 await assert.rejects(hash({name:'a',size:0,arrayBuffer:async()=>{throw new Error('read denied');}}),/无法读取/);
 await assert.rejects(hash({name:'a',size:2,arrayBuffer:async()=>new ArrayBuffer(1)}),/字节数/);
 await assert.rejects(hash({name:'a',size:0,arrayBuffer:async()=>new Uint8Array(0)}),/字节数/);
});
test('rejects incorrectly sized or malformed crypto responses',async()=>{
 for(const response of [new ArrayBuffer(31),new ArrayBuffer(33),new Uint8Array(32),null])await assert.rejects(hash(file('abc'),'',{digest:async()=>response}),/无效/);
});
test('size labels retain exact byte counts alongside binary units',()=>{
 for(const [n,text] of [[0,'0 字节'],[1023,'1,023 字节'],[1024,'1.00 KiB（1,024 字节）'],[1048576,'1.00 MiB（1,048,576 字节）'],[67108864,'64.00 MiB（67,108,864 字节）']])assert.equal(size(n),text);
});
test('a full report includes the file, byte count, digest, expected value and scope',async()=>{
 const r=await hash(file('abc','example.txt'),ABC);for(const text of ['example.txt','3 字节',ABC,'校验值一致','只包含文件内容','不能单独证明'])assert.ok(r.text.includes(text),text);
});
test('one MiB of varied binary bytes hashes identically to the independent Node implementation',async()=>{
 const bytes=Uint8Array.from({length:1048576},(_,i)=>(i*73+(i>>>8))%256);const r=await hash(file(bytes));assert.equal(r.hash,createHash('sha256').update(bytes).digest('hex'));assert.equal(r.byteLength,bytes.length);
});

// Run the actual UI handlers with a minimal DOM adapter to control slow file reads.
// This makes race and clipboard-denial checks deterministic without changing the app.
function uiHarness() {
 const elements=new Map();
 for(const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
  elements.set(match[1],{value:'',files:[],textContent:'',className:'',dataset:{},hidden:/\bhidden\b/.test(match[0]),disabled:/\bdisabled\b/.test(match[0]),listeners:{},addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);},focus(){this.focused=true;},select(){this.selected=true;}});
 }
 const document={getElementById:id=>elements.get(id),addEventListener(){}};
 const code=Array.from(html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g),m=>m[1]).join('\n');
 runInNewContext(code,{document,ArrayBuffer,Uint8Array,File,crypto:webcrypto,navigator:{clipboard:{writeText:async()=>{throw new Error('denied');}}}});
 return {get:id=>elements.get(id),emit:(id,type)=>Promise.all((elements.get(id).listeners[type]||[]).map(fn=>fn({})))};
}
test('clearing during a slow read prevents the old success from reappearing',async()=>{
 const ui=uiHarness();let release;
 ui.get('file').files=[{name:'slow.txt',size:3,arrayBuffer:()=>new Promise(resolve=>{release=resolve;})}];await ui.emit('file','change');
 const pending=ui.emit('calculate','click');assert.ok(release);assert.equal(ui.get('calculate').disabled,true);
 await ui.emit('clear','click');release(new TextEncoder().encode('abc').buffer);await pending;
 assert.equal(ui.get('result').hidden,true);assert.equal(ui.get('copy-hash').disabled,true);assert.equal(ui.get('calculate').disabled,false);assert.equal(ui.get('status').textContent,'已清空文件选择和校验值。');
});
test('a late read failure cannot replace a newer file result or its status',async()=>{
 const ui=uiHarness();let rejectRead;
 ui.get('file').files=[{name:'old.txt',size:3,arrayBuffer:()=>new Promise((_,reject)=>{rejectRead=reject;})}];await ui.emit('file','change');const old=ui.emit('calculate','click');
 ui.get('file').files=[file('abc','new.txt')];await ui.emit('file','change');ui.get('expected').value=ABC;await ui.emit('expected','input');await ui.emit('calculate','click');
 rejectRead(new Error('no longer readable'));await old;
 assert.equal(ui.get('hash').textContent,ABC);assert.equal(ui.get('filename').textContent,'文件：new.txt');assert.equal(ui.get('result').hidden,false);assert.equal(ui.get('status').textContent,'已完成本地计算。');
});
test('clipboard denial exposes the exact requested text and edits clear the fallback',async()=>{
 const ui=uiHarness();ui.get('file').files=[file('abc')];await ui.emit('file','change');await ui.emit('calculate','click');
 await ui.emit('copy-hash','click');assert.equal(ui.get('copy-text').value,ABC);assert.equal(ui.get('copy-text').hidden,false);assert.equal(ui.get('copy-text').selected,true);
 await ui.emit('copy-report','click');assert.ok(ui.get('copy-text').value.includes('文件 SHA-256 核对'));assert.ok(ui.get('copy-text').value.includes('尚未核对'));
 await ui.emit('expected','input');assert.equal(ui.get('copy-text').value,'');assert.equal(ui.get('copy-text').hidden,true);assert.equal(ui.get('copy-hash').disabled,true);
});
