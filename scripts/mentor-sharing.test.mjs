import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../public/js/school-sharing.js',import.meta.url),'utf8')
 .replace(/^import .*;\r?\n/gm,'').replace('export async function','async function');
function fixture(){
 const elements=new Map(),calls=[],messages=[];
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const element=id=>{
  const e={id,value:'',checked:false,disabled:false,hidden:true,events:{},_html:'',
   addEventListener(type,fn){this.events[type]=fn;},querySelector(){return this.button??={disabled:false};},querySelectorAll(){return [];},replaceChildren(){this.innerHTML='';}};
  Object.defineProperty(e,'innerHTML',{get(){return this._html;},set(value){this._html=value;for(const match of value.matchAll(/id="([^"]+)"/g))elements.set('#'+match[1],element(match[1]));}});
  return e;
 };
 elements.set('#schoolSharing',element('schoolSharing'));elements.set('#teacherLink',element('teacherLink'));
 const backend={async mentorAction(action,args){calls.push({action,args});return {data:action==='connections'?[]:{mentor_id:'mentor-1',display_name:'<script>bad</script>',email:'teacher@example.invalid'},error:null};}};
 const context=vm.createContext({backend,$:s=>elements.get(s),esc,toast:(...m)=>messages.push(m)});
 vm.runInContext(source,context);
 return {context,elements,calls,backend,messages,async init(){await context.initSchoolSharing({id:'student-1'});},async submit(id){const e=elements.get(id);await e.events.submit({preventDefault(){},currentTarget:e});}};
}
test('invitation preview shares nothing; consent is separate and recipient is escaped',async()=>{
 const f=fixture();await f.init();
 assert.match(f.elements.get('#schoolSharing').innerHTML,/Delen staat uit/);
 f.elements.get('#mentorCode').value='a'.repeat(32);await f.submit('#lookupMentor');
 assert.equal(f.calls.filter(c=>c.action==='connect').length,0);
 assert.match(f.elements.get('#mentorPreview').innerHTML,/&lt;script&gt;/);
 await f.submit('#confirmMentor');assert.equal(f.calls.filter(c=>c.action==='connect').length,0);
 f.elements.get('#mentorConsent').checked=true;await f.submit('#confirmMentor');
 assert.equal(f.calls.filter(c=>c.action==='connect').length,1);
 assert.equal(f.calls.at(-1).args.expected_mentor,'mentor-1');
 assert.match(f.elements.get('#schoolSharing').innerHTML,/Je deelt met 1/);
});
test('changing the invitation clears the previous recipient',async()=>{
 const f=fixture();await f.init();f.elements.get('#mentorCode').value='a'.repeat(32);await f.submit('#lookupMentor');
 f.elements.get('#mentorCode').events.input();assert.equal(f.elements.get('#mentorPreview').innerHTML,'');
});
test('connection failure does not claim successful sharing',async()=>{
 const f=fixture();await f.init();f.elements.get('#mentorCode').value='a'.repeat(32);await f.submit('#lookupMentor');
 f.elements.get('#mentorConsent').checked=true;
 const original=f.backend.mentorAction;f.backend.mentorAction=async(a,b)=>a==='connect'?{error:{message:'expired'}}:original(a,b);
 await f.submit('#confirmMentor');assert.match(f.elements.get('#schoolSharing').innerHTML,/Delen staat uit/);assert.equal(f.messages.at(-1)[1],'error');
});
test('an old lookup response cannot restore a recipient after editing the code',async()=>{
 const f=fixture();await f.init();let resolve;
 f.backend.mentorAction=()=>new Promise(r=>{resolve=r;});
 f.elements.get('#mentorCode').value='a'.repeat(32);
 const lookup=f.submit('#lookupMentor');
 f.elements.get('#mentorCode').value='b'.repeat(32);f.elements.get('#mentorCode').events.input();
 resolve({data:{mentor_id:'old-recipient',display_name:'Old recipient',email:'old@example.invalid'}});
 await lookup;assert.equal(f.elements.get('#mentorPreview').innerHTML,'');
});
