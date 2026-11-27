import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
const html=readFileSync(new URL('./image-join.html',import.meta.url),'utf8');
const core=html.match(/<script id="image-join-core">([\s\S]*?)<\/script>/)[1];
const ui=html.match(/<script id="image-join-ui">([\s\S]*?)<\/script>/)[1];
const api=runInNewContext(core+'\n({planImageJoin,paintImageJoin,validateJoinFiles,loadJoinImages})');
const {planImageJoin:plan,paintImageJoin:paint,validateJoinFiles:files,loadJoinImages:load}=api;
const image=(width,height)=>({width,height,bitmap:{close(){}}});
const file=(size=1,type='image/png',name='test.png')=>({size,type,name});

test('vertical screenshots use common width, preserve order and insert only internal gaps',()=>{
 const p=plan([image(600,300),image(600,240)],'vertical','800','12');
 assert.equal(p.width,600);assert.equal(p.height,552);
 assert.deepEqual(JSON.parse(JSON.stringify(p.boxes)),[{x:0,y:0,width:600,height:300},{x:0,y:312,width:600,height:240}]);
});
test('horizontal screenshots use common height and never upscale a smaller image',()=>{
 const p=plan([image(600,300),image(600,240)],'horizontal',800,12);
 assert.equal(p.common,240);assert.equal(p.width,1092);assert.equal(p.height,240);
 assert.equal(p.boxes[1].x,492);
});
test('rejects incomplete image lists, invalid options and pixel or edge overflows',()=>{
 for(const input of [[],[image(10,10)],Array(9).fill(image(10,10))])assert.throws(()=>plan(input,'vertical',100,0));
 for(const side of ['',0,99,2401,NaN,Infinity,'1e3','100.5',' 100'])assert.throws(()=>plan([image(200,200),image(200,200)],'vertical',side,0));
 for(const gap of [-1,65,'0.5',''])assert.throws(()=>plan([image(200,200),image(200,200)],'vertical',100,gap));
 assert.throws(()=>plan([image(200,200),image(200,200)],'diagonal',100,0));
 for(const dim of [[0,100],[-1,100],[1.5,100],[4001,4000],[NaN,10]])assert.throws(()=>plan([image(...dim),image(100,100)],'vertical',100,0));
 assert.throws(()=>plan([image(4000,4000),image(4000,4000)],'vertical',100,0),/2,400/);
 assert.throws(()=>plan([image(1,16384),image(1,1)],'vertical',100,0),/输出/);
 assert.throws(()=>plan([image(2400,4000),image(2400,4000)],'vertical',2400,0),/输出/);
});
test('accepts exact boundaries and handles very thin images without zero dimensions',()=>{
 assert.equal(plan([image(1,16383),image(1,1)],'vertical',100,0).height,16384);
 assert.equal(plan([image(2000,4000),image(2000,4000)],'vertical',2000,0).width,2000);
 const p=plan([image(16000,1),image(100,100)],'vertical',100,64);
 assert.equal(p.boxes[0].height,1);assert.equal(p.height,165);
});
test('file validation enforces types, count, per-file and aggregate byte limits before decoding',()=>{
 files([file(10*1024*1024),file(10*1024*1024,'image/jpeg'),file(10*1024*1024,'image/webp'),file(10*1024*1024)]);
 for(const list of [[],[file()],Array(9).fill(file()),[file(0),file()],[file(10*1024*1024+1),file()],[file(1,'image/svg+xml'),file()],Array(5).fill(file(10*1024*1024))])assert.throws(()=>files(list));
});
test('decode failures and progressive pixel overflow close all acquired bitmaps',async()=>{
 let closed=0,calls=0;
 await assert.rejects(()=>load([file(),file()],async()=>{if(++calls===2)throw new Error('corrupt');return {width:10,height:10,close(){closed++;}};}),/corrupt/);
 assert.equal(closed,1);
 closed=0;calls=0;
 await assert.rejects(()=>load([file(),file(),file()],async()=>{calls++;return {width:4000,height:4000,close(){closed++;}};}),/2,400/);
 assert.equal(calls,2);assert.equal(closed,2);
 calls=0;await assert.rejects(()=>load([file(0),file()],async()=>{calls++;}));assert.equal(calls,0);
});
test('successful decoding preserves file order and keeps bitmaps open for rendering',async()=>{
 let closed=0;
 const result=await load([file(1,'image/png','甲'),file(1,'image/png','乙')],async f=>({width:f.name==='甲'?300:600,height:200,close(){closed++;}}));
 assert.deepEqual(Array.from(result,i=>i.name),['甲','乙']);assert.equal(closed,0);assert.equal(result[1].width,600);
});
test('draws opaque white background then each image at its planned position',()=>{
 const calls=[],ctx={fillStyle:'',fillRect(...a){calls.push([this.fillStyle,...a]);},drawImage(...a){calls.push(a);}};
 const canvas={getContext:()=>ctx},images=[image(600,300),image(600,240)],p=plan(images,'vertical',800,12);
 paint(canvas,images,p);assert.equal(canvas.height,552);assert.deepEqual(calls[0],['#ffffff',0,0,600,552]);
 assert.deepEqual(calls[2],[images[1].bitmap,0,312,600,240]);assert.equal(ctx.imageSmoothingQuality,'high');
 assert.throws(()=>paint({getContext:()=>null},images,p),/Canvas/);
});
test('300 independently calculated layouts stay contiguous and within limits',()=>{
 for(let k=1;k<=300;k++){
  const dims=Array.from({length:2+k%5},(_,i)=>image(100+(k*73+i*101)%1000,100+(k*31+i*67)%700));
  for(const direction of ['vertical','horizontal']){
   const p=plan(dims,direction,100+k%300,k%65),v=direction==='vertical';
   const common=Math.min(100+k%300,...dims.map(i=>v?i.width:i.height));
   let sum=0;p.boxes.forEach((b,i)=>{assert.equal(v?b.y:b.x,sum);assert.equal(v?b.width:b.height,common);const other=Math.max(1,Math.round((v?dims[i].height:dims[i].width)*common/(v?dims[i].width:dims[i].height)));assert.equal(v?b.height:b.width,other);sum+=other+k%65;});
   assert.equal(v?p.height:p.width,sum-k%65);
  }
 }
});
function harness(){
 const nodes=new Map(),callbacks=[],revoked=[];
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',hidden:false,disabled:false,textContent:'',listeners:{},children:[],addEventListener(t,fn){this.listeners[t]=fn;},setAttribute(){},removeAttribute(){},replaceChildren(){this.children=[];},append(...n){this.children.push(...n);},getContext(){return {drawImage(){},fillRect(){}};},toBlob(fn){callbacks.push(fn);}});return nodes.get(id);};
 node('direction').value='vertical';node('side').value='800';node('gap').value='12';
 let id=0;const context={document:{getElementById:node,createElement:()=>node('created-'+id++)},window:{addEventListener(){}},URL:{createObjectURL:()=> 'blob:test',revokeObjectURL:u=>revoked.push(u)},createImageBitmap:async()=>({width:100,height:100,close(){}})};
 runInNewContext(core+'\n'+ui+'\n globalThis.seed=()=>{images=[{name:"甲",width:600,height:300,bitmap:{close(){}}},{name:"乙",width:600,height:240,bitmap:{close(){}}}];renderList();};',context);context.seed();
 return {node,callbacks,revoked,context};
}
test('editing while PNG is pending discards stale download and revokes completed URLs',()=>{
 const h=harness();h.node('generate').listeners.click();const first=h.callbacks.shift();
 h.node('gap').listeners.input();first({});assert.equal(h.node('download').hidden,true);
 h.node('generate').listeners.click();h.callbacks.shift()({});assert.equal(h.node('download').hidden,false);
 h.node('side').listeners.input();assert.equal(h.node('download').hidden,true);assert.deepEqual(h.revoked,['blob:test']);
 h.node('generate').listeners.click();h.callbacks.shift()(null);assert.equal(h.node('download').hidden,true);assert.match(h.node('status').textContent,/失败/);
});
test('list reorder and removal change actual draw order and invalidate previous PNG',()=>{
 const h=harness();h.node('generate').listeners.click();h.callbacks.shift()({});
 const first=h.node('images').children[0];const controls=first.children[1].children[1];controls.children[1].listeners.click();
 assert.match(h.node('images').children[0].children[1].children[0].textContent,/乙/);assert.equal(h.node('download').hidden,true);
 h.node('images').children[0].children[1].children[1].children[2].listeners.click();assert.equal(h.node('generate').disabled,true);
});
test('clearing during decode prevents old selection restoring images and closes late bitmaps',async()=>{
 const h=harness();let resolve,closed=0,calls=0;
 h.context.createImageBitmap=()=>{calls++;return calls===1?new Promise(r=>resolve=r):Promise.resolve({width:10,height:10,close(){closed++;}});};
 const choosing=runInNewContext('choose([{type:"image/png",size:1,name:"1"},{type:"image/png",size:1,name:"2"}])',h.context);
 h.node('clear').listeners.click();resolve({width:10,height:10,close(){closed++;}});await choosing;
 assert.equal(closed,2);assert.equal(h.node('images').children.length,0);assert.equal(h.node('generate').disabled,true);assert.match(h.node('status').textContent,/已清空/);
});
test('page embeds its code and blocks network requests',()=>{assert.ok(html.includes("connect-src 'none'"));assert.ok(!/<script[^>]+src=/i.test(html));assert.ok(!/\b(?:fetch|XMLHttpRequest|localStorage)\b/.test(core+ui));});
