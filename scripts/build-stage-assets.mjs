import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

const dataDir = new URL('../public/data/', import.meta.url);
const raw = await fs.readFile(new URL('stages.json', dataDir), 'utf8');
const catalog = JSON.parse(raw);
const contactPayload=JSON.parse(await fs.readFile(new URL('application-contacts.json',dataDir),'utf8'));
const contacts=new Map(contactPayload.contacts.map(contact=>[contact.id,contact]));
const revision = createHash('sha256').update(raw).digest('hex').slice(0, 12);
const keys = ['id','title','company','city','location','education_level','category','skills','contact_email','contact_phone','status','is_featured','compensation','hours_per_week','work_mode','latitude','longitude','internship_type','contact_check_status'];
const buckets = new Map(Array.from({length:256},(_,i)=>[i.toString(16).padStart(2,'0'),[]]));
buckets.set('other',[]);
const ids = new Set();
const stages = catalog.stages.map(original => {
  const contact=contacts.get(original.id);
  const stage=contact&&!original.contact_email?{...original,contact_email:contact.email,contact_email_kind:contact.email_kind,contact_source_url:contact.source_url,contact_email_checked_at:contact.checked_at}:original;
  if (!stage.id || ids.has(stage.id)) throw new Error('Catalogue has an empty or duplicate stage ID.');
  ids.add(stage.id);
  const bucket = /^[a-f0-9]{64}$/.test(stage.id) ? stage.id.slice(0,2) : 'other';
  buckets.get(bucket).push(stage);
  return {
    ...Object.fromEntries(keys.filter(key=>stage[key]!=null).map(key=>[key,stage[key]])),
    description:String(stage.description||'').slice(0,220),
    search_tokens:(stage.search_tokens||[]).filter(token=>typeof token==='string'&&token.length<=80)
  };
});
await fs.mkdir(new URL('stage-details/',dataDir),{recursive:true});
for (const [bucket,details] of buckets) {
  await fs.writeFile(new URL(`stage-details/${bucket}.json`,dataDir),JSON.stringify({revision,stages:details}));
}
const index = JSON.stringify({revision,total:stages.length,contacts_updated_at:catalog.contacts_updated_at,stages});
await fs.writeFile(new URL('stage-index.json',dataDir),index);
console.log(`Built ${stages.length} searchable summaries (${(Buffer.byteLength(index)/1024/1024).toFixed(1)} MB) and 257 detail groups; revision ${revision}.`);
