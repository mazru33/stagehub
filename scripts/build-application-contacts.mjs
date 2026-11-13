import { readFile, writeFile } from 'node:fs/promises';
import { cleanEmail } from './lib/stagemarkt-contacts.mjs';

const catalogPath = new URL('../public/data/stages.json', import.meta.url);
const outputPath = new URL('../public/data/application-contacts.json', import.meta.url);
const { stages } = JSON.parse(await readFile(catalogPath, 'utf8'));
const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig;
const applicationIntent = /(stuur.{0,120}(?:cv|curriculum|motivatie|sollicitatie|brief)|(?:cv|curriculum|motivatie|sollicitatie|brief).{0,120}(?:stuur|mail|naar)|solliciteer.{0,100}(?:mail|e-?mail|@)|solliciteren.{0,100}(?:mail|e-?mail|@)|reageer.{0,100}(?:mail|e-?mail|@))/is;
const contacts = [];

for (const stage of stages) {
  if (stage.status !== 'published' || stage.source !== 'stagemarkt') continue;
  const published = cleanEmail(stage.contact_email);
  if (published && stage.contact_source_url && stage.contact_email_checked_at) {
    contacts.push({ id:stage.id, title:stage.title, company:stage.company||'', email:published,
      email_kind:stage.contact_email_kind, contact_name:stage.contact_name||'',
      checked_at:stage.contact_email_checked_at, source_url:stage.contact_source_url });
    continue;
  }
  // A successful fresh response without an email supersedes old description data.
  if (stage.contact_check_status === 'no_public_email') continue;
  const description = String(stage.description || '');
  for (const match of description.matchAll(emailPattern)) {
    const email = match[0].trim();
    const context = description.slice(Math.max(0, match.index - 250), Math.min(description.length, match.index + email.length + 250));
    if (!applicationIntent.test(context)) continue;
    if (!cleanEmail(email)) continue;
    contacts.push({ id: stage.id, title: stage.title, company: stage.company || '', email, email_kind:'description_snapshot', source_url: stage.source_url || '' });
    break;
  }
}

await writeFile(outputPath, `${JSON.stringify({ generated_at: new Date().toISOString(), contacts }, null, 2)}\n`);
console.log(`Built ${contacts.length} direct application contacts from published listings.`);
