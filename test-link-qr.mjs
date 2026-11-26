import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import {runInNewContext} from 'node:vm';

const html=readFileSync(new URL('./link-qr.html',import.meta.url),'utf8');
const library=html.match(/<script id="link-qr-library">([\s\S]*?)<\/script>/)[1];
const core=html.match(/<script id="link-qr-core">([\s\S]*?)<\/script>/)[1];
const {buildLinkQR:qr,paintLinkQR:paint}=runInNewContext(library+'\n'+core+'\n({buildLinkQR,paintLinkQR})',{URL,TextEncoder});

test('preserves signed and Unicode URL text instead of serializing a normalized URL',()=>{
  for(const source of ['HTTPS://EXAMPLE.COM/a%2fb?x=1&x=2&sig=a%2Bb#t=30','https://例子.中国/指南?q=手机😀#说明','http://example.com']) {
    assert.equal(qr(' \n'+source+'\n ').payload,source);
    assert.equal(qr(source).byteLength,new TextEncoder().encode(source).length);
  }
});

test('rejects unsupported schemes, malformed addresses, credentials and internal whitespace',()=>{
  for(const source of ['example.com','javascript:alert(1)','ftp://example.com','https://','https://x:wrong/','https://user:pass@example.com/']) assert.throws(()=>qr(source));
  for(const suffix of ['/a b','/a\tb','/a\nb','/a\u0000b','/a\u202eb','/a\ud800b']) assert.throws(()=>qr('https://example.com'+suffix),/内部/);
  assert.equal(qr('https://example.com/a%20b').payload,'https://example.com/a%20b');
});

test('accepts exact UTF-8 byte limit and rejects longer or oversized raw inputs',()=>{
  const prefix='https://example.com/';
  assert.equal(qr(prefix+'a'.repeat(512-prefix.length)).byteLength,512);
  const mixed=prefix+'中'.repeat(160)+'x'.repeat(512-prefix.length-480);
  assert.equal(qr(mixed).byteLength,512);
  assert.throws(()=>qr(prefix+'a'.repeat(513-prefix.length)),/512/);
  assert.throws(()=>qr(' '.repeat(4097)),/4,096/);
});

test('retains pinned encoder and license, and embeds all runtime code',()=>{
  assert.equal(createHash('sha256').update(library.slice(1,-1)).digest('hex'),'6a1116192ed1dd67fa1bf31e77f5817103d71c23bbac24c382e698b7668bdd01');
  assert.ok(library.includes('Copyright (c) Project Nayuki. (MIT License)'));
  assert.ok(library.includes('Permission is hereby granted'));
  assert.ok(!/<script[^>]+src=/i.test(html));
  assert.ok(html.includes("connect-src 'none'"));
});

test('uses medium correction with valid finder patterns and deterministic modules',()=>{
  const a=qr('https://example.com/guide?part=2#notes'),b=qr('https://example.com/guide?part=2#notes');
  assert.equal(a.qr.errorCorrectionLevel.ordinal,1);assert.equal(a.border,4);assert.equal(a.scale,8);
  assert.equal(a.qr.size,a.qr.version*4+17);assert.ok(a.qr.version<=20);
  for(let y=0;y<a.qr.size;y++)for(let x=0;x<a.qr.size;x++)assert.equal(a.qr.getModule(x,y),b.qr.getModule(x,y));
  for(let y=0;y<7;y++)for(let x=0;x<7;x++)assert.equal(a.qr.getModule(x,y),x===0||x===6||y===0||y===6||(x>=2&&x<=4&&y>=2&&y<=4));
});

test('passes exact UTF-8 bytes and ECI assignment into the encoder',()=>{
  let segments;
  const source='https://example.com/中文😀?a=%2f#片段';
  const capture=runInNewContext(core+'\nbuildLinkQR',{
    URL,TextEncoder,qrcodegen:{QrSegment:{makeEci:n=>({eci:n}),makeBytes:bytes=>({bytes})},QrCode:{Ecc:{MEDIUM:{}},encodeSegments(value){segments=value;return {size:21};}}},
  });
  capture(source);
  assert.equal(segments[0].eci,26);
  assert.deepEqual(Array.from(segments[1].bytes),Array.from(new TextEncoder().encode(source)));
});

test('renders whole black modules within a four-module opaque white border',()=>{
  const result=qr('https://example.com/');const rectangles=[];
  const ctx={fillStyle:'',fillRect(...args){rectangles.push({color:this.fillStyle,args});}};
  const canvas={getContext:()=>ctx};paint(canvas,result);
  assert.equal(canvas.width,result.pixels);assert.equal(canvas.height,result.pixels);
  assert.deepEqual(rectangles[0],{color:'#ffffff',args:[0,0,result.pixels,result.pixels]});
  for(const rect of rectangles.slice(1)) {
    assert.equal(rect.color,'#000000');const [x,y,w,h]=rect.args;
    assert.equal(w,8);assert.equal(h,8);assert.equal(x%8,0);assert.equal(y%8,0);
    assert.ok(x>=32&&y>=32&&x+w<=result.pixels-32&&y+h<=result.pixels-32);
  }
  assert.throws(()=>paint({getContext:()=>null},result),/Canvas/);
});

test('new input cancels old PNG results and failed encoding never enables download',()=>{
  const elements=new Map();let callback,downloads=0;const urls=[],revoked=[];
  const element=id=>{
    if(!elements.has(id))elements.set(id,{value:'',hidden:false,disabled:false,textContent:'',listeners:{},addEventListener(type,fn){this.listeners[type]=fn;},setAttribute(){},removeAttribute(){},focus(){}});
    return elements.get(id);
  };
  element('qr').getContext=()=>({fillRect(){}});element('qr').toBlob=fn=>{callback=fn;};
  const ui=[...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)].at(-1)[1];
  const URLMock=class extends URL {};
  URLMock.createObjectURL=()=>{const value='blob:'+urls.length;urls.push(value);return value;};
  URLMock.revokeObjectURL=value=>revoked.push(value);
  runInNewContext(library+'\n'+core+'\n'+ui,{TextEncoder,URL:URLMock,document:{getElementById:element,body:{append(){}},createElement:()=>({click(){downloads++;},remove(){}})}});
  element('example').listeners.click();const old=callback;
  element('settings').listeners.input();old(new Blob(['old']));
  assert.equal(urls.length,0);assert.equal(element('download').disabled,true);
  element('example').listeners.click();callback(null);
  assert.equal(element('download').disabled,true);assert.match(element('status').textContent,/失败/);
  element('example').listeners.click();callback(new Blob(['png']));
  assert.equal(element('download').disabled,false);element('download').listeners.click();assert.equal(downloads,1);
  element('settings').listeners.input();assert.deepEqual(revoked,['blob:0']);
  assert.equal(element('output').value,'');assert.equal(element('qr').width,0);
});
