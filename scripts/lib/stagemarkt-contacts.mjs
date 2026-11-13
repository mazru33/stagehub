export function cleanEmail(value) {
  const email = String(value || '').trim().replace(/^mailto:/i, '').split('?')[0];
  if(email.length>254||!/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(email))return '';
  const [local,domain]=email.split('@');
  return local.length<=64&&!local.startsWith('.')&&!local.endsWith('.')&&!local.includes('..')&&domain.split('.').every(label=>label.length<=63&&/^[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?$/i.test(label))?email:'';
}

export function httpUrl(value) {
  try { const url = new URL(String(value || '')); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; }
  catch { return ''; }
}

// Nuxt's public page payload stores values by table index. Read only the
// requested vacancy's contact fields; never evaluate scripts or scan page-wide
// emails, which could belong to unrelated navigation/footer content.
export function extractPageDetail(html, sourceId) {
  const match=String(html).match(/<script\b[^>]*\bid=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if(!match)return null;
  const table=JSON.parse(match[1]);
  if(!Array.isArray(table))return null;
  function value(index){
    for(let depth=0;depth<10;depth++){
      if(!Number.isInteger(index)||index<0)return undefined;
      const item=table[index];
      if(Array.isArray(item)&&['ShallowReactive','Reactive','Ref','ShallowRef'].includes(item[0])){index=item[1];continue;}
      return item;
    }
    return undefined;
  }
  const root=value(0),data=value(root?.data),raw=value(data?.[`education-detail-${sourceId}`]);
  if(!raw||Array.isArray(raw)||value(raw.id)!==sourceId)return null;
  const detail=Object.fromEntries(['id','emailadres','contactpersoon','telefoon','website','omschrijving','vaardigheden','aanbieden'].map(key=>[key,value(raw[key])]));
  const org=value(raw.organisatie);
  detail.organisatie=Object.fromEntries(['naam','emailadres','telefoonnummer','website'].map(key=>[key,value(org?.[key])]));
  return detail;
}

export function extractContact(detail, stage, checkedAt = new Date().toISOString()) {
  if (!detail || typeof detail !== 'object' || detail.id !== stage.source_id || !detail.organisatie?.naam) {
    throw new Error('Vacancy response does not match the requested listing.');
  }
  const direct = cleanEmail(detail.emailadres);
  const company = cleanEmail(detail.organisatie.emailadres);
  const email = direct || company;
  return {
    id: stage.id, source_id: stage.source_id, source_url: stage.source_url,
    checked_at: checkedAt, status: email ? 'found' : 'no_public_email',
    email, email_kind: direct ? 'vacancy_contact' : company ? 'company_contact' : null,
    company_email: company || null,
    contact_name: String(detail.contactpersoon || '').trim().slice(0, 160),
    phone: String(detail.telefoon || detail.organisatie.telefoonnummer || '').trim().slice(0, 50),
    website: httpUrl(detail.organisatie.website || detail.website),
    description: String(detail.omschrijving || '').slice(0, 12000),
    requirements: String(detail.vaardigheden || '').slice(0, 8000),
    benefits: String(detail.aanbieden || '').slice(0, 8000)
  };
}

export function applyContact(stage, record) {
  if (!record || record.source_id !== stage.source_id) return stage;
  const result = { ...stage, contact_check_status: record.status, contact_checked_at: record.checked_at };
  if (record.status === 'source_error') return result;
  return {
    ...result, contact_name: record.contact_name || null, contact_email: record.email || null,
    company_email: record.company_email, contact_email_kind: record.email_kind,
    contact_email_checked_at: record.checked_at,
    contact_source_url: record.source_url, contact_phone: record.phone || null,
    contact_website: record.website || stage.contact_website || null,
    description: record.description || stage.description,
    requirements: record.requirements || null, benefits: record.benefits || null
  };
}
