import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {TextEncoder} from 'node:util';
import assert from 'node:assert/strict';
import test from 'node:test';
const html=readFileSync(new URL('./contact-card.html',import.meta.url),'utf8');
const core=html.match(/<script id="contact-card-core">([\s\S]*?)<\/script>/)[1];
const {makeContactCard:make,foldContact:fold}=runInNewContext(core+'\n({makeContactCard,foldContact})',{TextEncoder});
const card=extra=>make({name:'小林',phone:'+1 202 555 0100',email:'',org:'',note:'',...extra});
const unfold=text=>text.replace(/\r\n[ \t]/g,'');
const unescape=text=>text.replace(/\\([\\;,nN])/g,(_,c)=>c==='n'||c==='N'?'\n':c);
const props=text=>unfold(text).trimEnd().split('\r\n').map(line=>{const i=line.indexOf(':');return [line.slice(0,i),line.slice(i+1)];});

test('minimal contact has required properties, exact CRLF and deterministic filename',()=>{
 const r=card();assert.equal(r.vcf,'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:小林\r\nN:;小林;;;\r\nTEL;TYPE=VOICE:+1 202 555 0100\r\nEND:VCARD\r\n');assert.equal(r.filename,'contact.vcf');assert.equal(r.bytes,Buffer.byteLength(r.vcf));assert.ok(!r.vcf.replace(/\r\n/g,'').includes('\n'));
});
test('email-only, phone-only and all optional fields are supported',()=>{
 const r=card({phone:'',email:'hello+tag@example.com',org:'团队',note:'一\n二'});assert.ok(!r.vcf.includes('TEL;'));assert.ok(r.vcf.includes('EMAIL;TYPE=INTERNET:hello+tag@example.com'));assert.ok(r.vcf.includes('ORG:团队'));assert.ok(r.vcf.includes('NOTE:一\\n二'));
});
test('requires a name and at least one contact route',()=>{for(const x of [{name:''},{name:'  '},{phone:''}])assert.throws(()=>card(x));});
test('preserves case, internal spaces and unicode without splitting the name',()=>{
 const r=card({name:'  林 Á 🧰  ',phone:' +1 (202) 555-0100 ',email:'A.B@Example.COM'});assert.equal(r.name,'林 Á 🧰');assert.equal(r.phone,'+1 (202) 555-0100');assert.equal(r.email,'A.B@Example.COM');assert.ok(r.vcf.includes('N:;林 Á 🧰;;;'));
});
test('escapes delimiters, literal backslashes, and multiline note; injected properties remain note text',()=>{
 const name='A,B;C\\D',note='hello\r\nEND:VCARD\rBEGIN:VCARD\nTEL:999\\n;,';const r=card({name,org:'A;B,C\\',note});const ps=props(r.vcf);assert.equal(ps.filter(([k])=>k==='BEGIN').length,1);assert.equal(ps.filter(([k])=>k==='END').length,1);assert.equal(unescape(ps.find(([k])=>k==='FN')[1]),name);assert.equal(unescape(ps.find(([k])=>k==='NOTE')[1]),note.replace(/\r\n|\r/g,'\n'));assert.equal(unescape(ps.find(([k])=>k==='ORG')[1]),'A;B,C\\');
});
test('accepts phone formatting and numeric boundaries',()=>{for(const phone of ['123','+123','(123) 456.789-0','1'.repeat(20),'1'.repeat(20)+' '.repeat(20)])assert.equal(card({phone}).phone,phone.trim());});
test('rejects ambiguous phone syntax, too few or too many digits and length overflow',()=>{
 for(const phone of ['12','+','abc','12+345','++123','123 ext 4','123;456','１２３','1'.repeat(21),'1'.repeat(3)+'-'.repeat(38)])assert.throws(()=>card({phone}),phone);
});
test('accepts common ASCII mailbox syntax including subdomains and punctuation',()=>{for(const email of ['a@example.com','a.b+tag@example.co.uk',"a!#$%&'*-/=?^_`{|}~@x.example",'A@EXAMPLE.COM','a@xn--example-9d0b.com'])assert.equal(card({email}).email,email);});
test('rejects malformed, internationalized and unsupported email syntax',()=>{
 for(const email of ['a','a@','@example.com','a@@example.com','a..b@example.com','.a@example.com','a.@example.com','"a"@example.com','Name <a@example.com>','a@-example.com','a@example-.com','a@example..com','a@localhost','a@例子.com','中@example.com','a@exa mple.com','a'.repeat(65)+'@example.com','a@'+'a'.repeat(64)+'.com'])assert.throws(()=>card({email}),email);
});
test('enforces maximum address size without truncation',()=>{const email='a'.repeat(64)+'@'+'b'.repeat(63)+'.'+'c'.repeat(63)+'.'+'d'.repeat(61);assert.equal(email.length,254);assert.equal(card({email}).email,email);assert.throws(()=>card({email:email+'e'}));});
test('unicode codepoint limits accept emoji and exact maxima but reject overflow',()=>{
 for(const [key,max] of [['name',80],['org',120],['note',1000]]){const value='🧰'.repeat(max);assert.equal(card({[key]:value})[key],value);assert.throws(()=>card({[key]:value+'中'}));}
});
test('rejects controls, line separators and unpaired surrogates including trimmed regions',()=>{
 for(const key of ['name','phone','email','org','note'])for(const bad of ['\0','\t','\u007f','\u0085','\u2028','\ud800','\udfff'])assert.throws(()=>card({[key]:bad+'A'}));
 for(const key of ['name','phone','email','org'])assert.throws(()=>card({[key]:'a\nb'}));
});
test('rejects wrong field types, missing fields and excessive raw whitespace',()=>{
 for(const value of [undefined,null,2,{},[]])assert.throws(()=>card({name:value}));assert.throws(()=>make(null));assert.throws(()=>make({name:'a'}));assert.throws(()=>card({name:' '.repeat(10000)+'a'}));
});
test('UTF-8 folding never splits a codepoint and every physical line is at most 75 bytes',()=>{
 for(const line of ['A'.repeat(75),'A'.repeat(76),'中'.repeat(100),'🧰'.repeat(100),'A'.repeat(74)+'🧰']){const folded=fold(line);assert.equal(unfold(folded),line);for(const p of folded.split('\r\n')){assert.ok(Buffer.byteLength(p)<=75);assert.equal(Buffer.from(p).toString('utf8'),p);}}
});
test('500 mixed unicode contacts survive independent unfolding and unescaping without structural changes',()=>{
 const tokens=['中','🧰','A',';','\\',',','é',' '];
 for(let i=0;i<500;i++){let name='联系人'+i,note='备注';for(let j=0;j<i%40;j++){name+=tokens[(i+j)%tokens.length];note+=tokens[(i*3+j)%tokens.length]+'\n';}name=name.trim();note=note.trim();const r=card({name,note}),ps=props(r.vcf);assert.equal(unescape(ps.find(([k])=>k==='FN')[1]),name);assert.equal(unescape(ps.find(([k])=>k==='NOTE')[1]),note);assert.equal(ps.length,7);assert.equal(r.bytes,Buffer.byteLength(r.vcf));for(const line of r.vcf.trimEnd().split('\r\n'))assert.ok(Buffer.byteLength(line)<=75);}
});
test('HTML-like text remains text and does not alter the file structure',()=>{const r=card({name:'<img src=x onerror=alert(1)>',note:'<script>text</script>'});assert.equal(props(r.vcf).length,7);assert.ok(r.vcf.includes('FN:<img src=x onerror=alert(1)>'));});
