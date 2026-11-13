import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanEmail, extractContact, applyContact, extractPageDetail } from './lib/stagemarkt-contacts.mjs';

const stage = { id:'fixture', source_id:'vacancy-123', source_url:'https://stagemarkt.nl/stages/test_vacancy-123' };
const detail = { id:stage.source_id, emailadres:'student-contact@example.test', contactpersoon:'Test contact', organisatie:{ naam:'Fixture company', emailadres:'general@example.test', website:'https://example.test' } };
test('reads the vacancy contact field missed by search-only imports', () => {
  const record=extractContact(detail,stage,'2026-11-13T10:00:00.000Z');
  assert.equal(record.email,detail.emailadres);
  assert.equal(record.company_email,detail.organisatie.emailadres);
  assert.equal(record.email_kind,'vacancy_contact');
  const enriched=applyContact(stage,record);
  assert.equal(enriched.contact_email,detail.emailadres);
  assert.equal(enriched.contact_email_checked_at,record.checked_at);
  assert.equal(enriched.contact_source_url,stage.source_url);
});
test('uses a published company address only when the vacancy has no valid direct address', () => {
  const record=extractContact({...detail,emailadres:null},stage);
  assert.equal(record.email,'general@example.test');
  assert.equal(record.email_kind,'company_contact');
});
test('does not guess email addresses and removes withdrawn source contacts', () => {
  const record=extractContact({...detail,emailadres:null,organisatie:{naam:'Fixture company'}},stage);
  assert.equal(record.status,'no_public_email');
  assert.equal(record.email,'');
  assert.equal(applyContact({...stage,contact_email:'old@example.test'},record).contact_email,null);
});
test('does not associate a response with another vacancy', () => {
  assert.throws(()=>extractContact({...detail,id:'another-vacancy'},stage),/does not match/);
  assert.deepEqual(applyContact(stage,{source_id:'another-vacancy',email:'wrong@example.test'}),stage);
});
test('reports source errors without treating the listing as deleted or fabricating contact data', () => {
  const result=applyContact({...stage,contact_email:'old@example.test',status:'published'},{source_id:stage.source_id,status:'source_error',checked_at:'2026-11-13'});
  assert.equal(result.contact_email,'old@example.test');
  assert.equal(result.contact_check_status,'source_error');
  assert.equal(result.status,'published');
});
test('rejects malformed emails and header injection', () => {
  for(const value of ['a@example.test\r\nBcc: evil@example.test','a@example.test,evil@example.test','invalid','https://example.test','a@@example.test'])assert.equal(cleanEmail(value),'');
  assert.equal(cleanEmail(' mailto:contact@example.test?subject=Stage '),'contact@example.test');
});
test('reads the exact vacancy from a public Nuxt page without collecting unrelated emails',()=>{
  const table=[['ShallowReactive',1],{data:2},['ShallowReactive',3],{['education-detail-'+stage.source_id]:4},{id:5,emailadres:6,organisatie:7},stage.source_id,'contact@example.test',{naam:8},'Fixture company'];
  const html='<footer>unrelated@example.test</footer><script type="application/json" id="__NUXT_DATA__">'+JSON.stringify(table)+'</script>';
  const result=extractPageDetail(html,stage.source_id);
  assert.equal(result.emailadres,'contact@example.test');
  assert.equal(result.organisatie.naam,'Fixture company');
  assert.equal(extractPageDetail(html,'another-vacancy'),null);
  assert.equal(extractPageDetail('<footer>unrelated@example.test</footer>',stage.source_id),null);
});
