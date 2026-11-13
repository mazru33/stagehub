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
  TextEncoder, Uint8Array, Blob, crypto: webcrypto, btoa,
  location: { origin: 'https://stagehub.test' },
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
vm.runInContext(source.replace(/^import .*;\r?\n/gm, '').replace(/init\(\);\s*$/, ''), context);
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
const attachment = message.split('filename="CV.pdf"')[1].split('\r\n\r\n')[1].split('\r\n--')[0];
assert.equal(Buffer.from(attachment.replace(/\s/g, ''), 'base64').toString(), '%PDF-1.4 test CV');
await vm.runInContext('downloadEmailDraft(fields,null)', context);
assert(!(await draft.text()).includes('Content-Disposition: attachment'));
context.fetch = async () => ({ ok:false });
await assert.rejects(vm.runInContext("downloadEmailDraft(fields,{cv_path:'private/test.pdf'})", context));
console.log(`PASS: ${stages.length} listings; ${contacts.length} source contacts; guest/fallback routes; Unicode mailto; MIME subject and PDF; CV fetch failure.`);
