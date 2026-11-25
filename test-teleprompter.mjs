import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {runInNewContext} from 'node:vm';

const html = readFileSync(new URL('./teleprompter.html', import.meta.url), 'utf8');
const core = html.match(/<script id="teleprompter-core">([\s\S]*?)<\/script>/)[1];
const {promptSettings, promptStep} = runInNewContext(core + '\n({promptSettings,promptStep})');

test('preserves text and markup literally while normalizing only line endings', () => {
  const source = '  开场 👩🏽‍💻\r\n\r\n<i>e\u0301</i>\r结尾  ';
  assert.equal(promptSettings(source,'36','30').text, '  开场 👩🏽‍💻\n\n<i>e\u0301</i>\n结尾  ');
  assert.equal(promptSettings('A'.repeat(20000),'20','10').text.length,20000);
  assert.throws(()=>promptSettings('A'.repeat(20001),'36','30'),/20,000/);
  assert.throws(()=>promptSettings(' \n\t','36','30'),/稿件/);
  assert.throws(()=>promptSettings('x\ud800','36','30'),/Unicode/);
});

test('enforces font and speed boundaries without silently clamping settings', () => {
  for(const font of ['19','65','36.5','','1e2']) assert.throws(()=>promptSettings('稿件',font,'30'),/字号/);
  for(const speed of ['9','101','10.5','','1e2']) assert.throws(()=>promptSettings('稿件','36',speed),/速度/);
  assert.equal(promptSettings('稿件','64','100').font,64);
});

test('accumulates fractional frame positions and limits stalls without overshooting', () => {
  let position=0;
  for(let i=0;i<600;i+=1) position=promptStep(position,1000,1000/60,10).position;
  assert.ok(Math.abs(position-100)<1e-8);
  assert.equal(promptStep(10,1000,5000,30).position,13);
  assert.equal(promptStep(98,100,100,100).position,100);
  assert.equal(promptStep(98,100,100,100).done,true);
  assert.equal(promptStep(0,0,0,30).done,true);
  for(const args of [[-1,10,0,30],[0,-1,0,30],[0,10,-1,30],[0,10,0,Infinity],[0,10,0,9]]) assert.throws(()=>promptStep(...args),/无效/);
});

function uiHarness() {
  const elements=new Map(), callbacks=new Map(); let nextId=0;
  const element=id=>{
    if(!elements.has(id)) elements.set(id,{
      value:'',textContent:'',disabled:false,open:true,style:{},listeners:{},scrollHeight:1000,clientHeight:300,
      addEventListener(event,handler){this.listeners[event]=handler;},
      setAttribute(){},removeAttribute(){},focus(){},
    });
    return elements.get(id);
  };
  let scroll=0;
  Object.defineProperty(element('reader'),'scrollTop',{get(){return scroll;},set(value){scroll=Math.round(value);}});
  element('font').value='36';element('speed').value='30';
  const document={hidden:false,listeners:{},getElementById:element,addEventListener(event,handler){this.listeners[event]=handler;}};
  const ui=[...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)].at(-1)[1];
  runInNewContext(core+'\n'+ui,{
    document,
    requestAnimationFrame(callback){callbacks.set(++nextId,callback);return nextId;},
    cancelAnimationFrame(id){callbacks.delete(id);},
  });
  return {element,document,callbacks,step(timestamp){const [id,callback]=callbacks.entries().next().value;callbacks.delete(id);callback(timestamp);}};
}

test('low speed still advances when browser scroll positions round to pixels', () => {
  const h=uiHarness();h.element('example').listeners.click();
  assert.equal(h.element('editor').open,false);
  h.element('speed').value='10';h.element('speed').listeners.input();
  h.element('play').listeners.click();h.step(0);
  for(let i=1;i<=12;i+=1) h.step(i*1000/60);
  assert.equal(h.element('reader').scrollTop,2);
  h.element('play').listeners.click();
  assert.equal(h.callbacks.size,0);
  assert.equal(h.element('reader').scrollTop,2);
});

test('pause and new playback isolate old animation callbacks', () => {
  const h=uiHarness();h.element('example').listeners.click();h.element('play').listeners.click();
  const old=h.callbacks.values().next().value;
  h.element('play').listeners.click();h.element('play').listeners.click();
  old(1000);
  assert.equal(h.callbacks.size,1);
  assert.equal(h.element('reader').scrollTop,0);
  h.step(1000);h.step(1100);
  assert.equal(h.element('reader').scrollTop,3);
});

test('editing removes stale prompt and hidden-tab pause never auto-resumes', () => {
  const h=uiHarness();h.element('example').listeners.click();h.element('play').listeners.click();
  h.document.hidden=true;h.document.listeners.visibilitychange();
  assert.equal(h.callbacks.size,0);
  h.document.hidden=false;h.document.listeners.visibilitychange();
  assert.equal(h.callbacks.size,0);
  h.element('play').listeners.click();const old=h.callbacks.values().next().value;
  h.element('source').listeners.input();old(1000);
  assert.equal(h.element('prompt').textContent,'');
  assert.equal(h.element('play').disabled,true);
  assert.equal(h.callbacks.size,0);
});

test('font resets position, speed retains it, and manual navigation pauses', () => {
  const h=uiHarness();h.element('example').listeners.click();h.element('reader').scrollTop=20;
  h.element('speed').value='40';h.element('speed').listeners.input();
  assert.equal(h.element('reader').scrollTop,20);
  h.element('play').listeners.click();h.element('reader').listeners.wheel();
  assert.equal(h.callbacks.size,0);
  h.element('font').value='48';h.element('font').listeners.input();
  assert.equal(h.element('reader').scrollTop,0);
  assert.equal(h.element('prompt').style.fontSize,'48px');
  let prevented=false;
  h.element('reader').listeners.keydown({code:'Space',preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(h.callbacks.size,1);
  h.element('reader').listeners.keydown({code:'ArrowDown',key:'ArrowDown'});
  assert.equal(h.callbacks.size,0);
});

test('short scripts need no animation and reaching the end allows a fresh start', () => {
  const h=uiHarness();h.element('example').listeners.click();
  h.element('reader').scrollHeight=200;h.element('play').listeners.click();
  assert.equal(h.callbacks.size,0);assert.match(h.element('reading-status').textContent,/全文已显示/);
  h.element('reader').scrollHeight=305;h.element('speed').value='100';
  h.element('play').listeners.click();h.step(0);h.step(100);
  assert.equal(h.element('reader').scrollTop,5);assert.equal(h.callbacks.size,0);
  h.element('play').listeners.click();assert.equal(h.element('reader').scrollTop,0);
});
