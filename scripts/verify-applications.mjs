import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const read = name => readFile(new URL('../' + name, import.meta.url), 'utf8');
const { stages } = JSON.parse(await read('public/data/stages.json'));
const { contacts } = JSON.parse(await read('public/data/application-contacts.json'));
const emails = new Map(contacts.map(contact => [contact.id, contact.email]));
let draft;
const context = vm.createContext({
  TextEncoder, Uint8Array, Blob, crypto: webcrypto, btoa, Intl,
  location: { origin: 'https://stagehub.test', pathname:'/stage.html', search:'?id=fixture' },
  esc: value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char])),
  safeHref: value => {
    try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : '#'; }
    catch { return '#'; }
  },
  URL: { createObjectURL: blob => { draft = blob; return 'blob:test'; }, revokeObjectURL() {} },
  document: { createElement: () => ({ click() {}, remove() {} }), body: { append() {} } },
  setTimeout() {},
  backend: { storage: { createCvUrl: async () => ({ data: { signedUrl: 'https://stagehub.test/cv' } }) } },
  fetch: async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode('%PDF-1.4 test CV').buffer })
});
const source = await read('public/js/stage-detail.js');
vm.runInContext(source.replace(/^import .*;\r?\n/gm, '').replace(/init\(\)\.catch\([\s\S]*$/, ''), context);
for (const stage of stages) {
  context.stage = stage;
  context.email = emails.get(stage.id) || '';
  const html = vm.runInContext("renderApplicationPanel(stage,null,{email:'student@example.test'},null,email)", context);
  assert(html.includes('id="directApplicationForm"'), stage.id);
  assert(!html.includes('readonly'), stage.id);
  if (!context.email) {
    assert(html.includes('Geen geverifieerd sollicitatieadres'));
    assert(html.includes('value="" placeholder="Vul een gecontroleerd e-mailadres in"'));
  }
  const guest = vm.runInContext('renderApplicationPanel(stage,null,null,null,email)', context);
  assert(guest.includes('/login.html?next='));
  assert(guest.includes('id="directApplicationForm"'));
  assert(guest.includes('id="applicationCvFile"'));
}
context.stage = { title:'Test', company:'Test', application_url:'javascript:alert(1)' };
assert(vm.runInContext("renderApplicationPanel(stage,null,{email:'student@example.test'},null,'')", context).includes('Vraag het leerbedrijf'));
context.fields = { to:'student@example.test', subject:'Sollicitatie café', body:'Beste bedrijf,\nGroet, Zoë' };
assert(vm.runInContext('mailtoUrl(fields)', context).includes('caf%C3%A9'));
await vm.runInContext("downloadEmailDraft(fields,{cv_path:'private/test.pdf'})", context);
const message = await draft.text();
assert(message.includes('X-Unsent: 1'));
const encodedSubject = message.match(/Subject: =\?UTF-8\?B\?(.+)\?=/)[1];
assert.equal(Buffer.from(encodedSubject, 'base64').toString(), context.fields.subject);
context.longSubject = 'é😀'.repeat(66);
const folded = vm.runInContext('mimeSubject(longSubject)', context);
assert(folded.split('\r\n').every(line => line.length <= 75));
assert.equal([...folded.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)].map(match => Buffer.from(match[1], 'base64').toString()).join(''), context.longSubject);
const attachment = message.split('filename="CV.pdf"')[1].split('\r\n\r\n')[1].split('\r\n--')[0];
assert.equal(Buffer.from(attachment.replace(/\s/g, ''), 'base64').toString(), '%PDF-1.4 test CV');
await vm.runInContext('downloadEmailDraft(fields,null)', context);
assert(!(await draft.text()).includes('Content-Disposition: attachment'));
context.fileBytes = new TextEncoder().encode('%PDF-1.4 local CV');
vm.runInContext('selectedCv={arrayBuffer:async()=>fileBytes.buffer}',context);
await vm.runInContext('downloadEmailDraft(fields,null)',context);
assert((await draft.text()).includes(Buffer.from('%PDF-1.4 local CV').toString('base64')));
vm.runInContext('selectedCv=null',context);
context.fetch = async () => ({ ok:false });
await assert.rejects(vm.runInContext("downloadEmailDraft(fields,{cv_path:'private/test.pdf'})", context));
console.log(`PASS: ${stages.length} listings; ${contacts.length} source contacts; guest/fallback routes; Unicode mailto; MIME subject and PDF; CV fetch failure.`);
const commonContext=vm.createContext({URL,location:{origin:'https://stagehub.test'}});
vm.runInContext((await read('public/js/common.js')).replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,''),commonContext);
for(const input of ['', '#', 'javascript:alert(1)']){commonContext.input=input;assert.equal(vm.runInContext('safeHref(input)',commonContext),'#');}
for(const input of ['https://evil.test','//evil.test','/\\evil.test','/\n/evil.test']){commonContext.input=input;assert.equal(vm.runInContext('safeInternalPath(input)',commonContext),'/dashboard.html');}
commonContext.input='/stage.html?id=fixture';
assert.equal(vm.runInContext('safeInternalPath(input)',commonContext),commonContext.input);
commonContext.document={querySelector:()=>null};
commonContext.backend={
  from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:null,error:null}),upsert:async()=>({error:null})}),
  sendApplicationConfirmation:()=>{throw new Error('Application tracking must never send email.');}
};
const recorded=await vm.runInContext("recordApplication({id:'fixture'},{id:'test-user'})",commonContext);
assert.equal(recorded.applied,true);
assert.equal(recorded.emailSent,false);
