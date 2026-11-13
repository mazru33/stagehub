import { backend } from './firebase-db.js';
import { $, boot, toast, esc, safeHref, mapSearchUrl, toggleSaved, recordApplication } from './common.js';
import { getStageById } from './stage-catalog.js';

let applicationContactsPromise;
function getApplicationContacts() {
  if (!applicationContactsPromise) applicationContactsPromise = fetch('/data/application-contacts.json', { cache: 'force-cache' })
    .then(async response => { if (!response.ok) throw new Error('Contactgegevens voor aanvragen zijn niet beschikbaar.'); return response.json(); })
    .catch(error => { applicationContactsPromise = null; throw error; });
  return applicationContactsPromise;
}
function isEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '')); }

function contactSection(stage, applicationEmail = '') {
  const email=String(applicationEmail||stage.contact_email||'').trim();
  const phone=String(stage.contact_phone||'').replace(/[^\d+().\-\s]/g,'').trim();
  const website=safeHref(stage.contact_website||'');
  const hasEmail=isEmail(email),hasPhone=Boolean(phone.replace(/\D/g,''));
  if(!hasEmail&&!hasPhone&&website==='#'&&!stage.contact_name)return '';
  return `<section class="stage-contact-panel"><div><span class="eyebrow">DIRECT CONTACT</span><h2>Contact over deze stage</h2><p>${esc(stage.contact_name||stage.company||'Leerbedrijf')}</p></div><div class="stage-contact-links">${hasEmail?`<a class="contact-link" href="mailto:${esc(email)}"><span>✉</span><span><small>E-mail</small><b>${esc(email)}</b></span></a>`:''}${hasPhone?`<a class="contact-link" href="tel:${esc(phone.replace(/[\s().-]/g,''))}"><span>☎</span><span><small>Telefoon</small><b>${esc(phone)}</b></span></a>`:''}${website!=='#'?`<a class="contact-link" href="${esc(website)}" target="_blank" rel="noopener noreferrer"><span>↗</span><span><small>Website</small><b>Bezoek het leerbedrijf</b></span></a>`:''}</div></section>`;
}

function renderApplicationPanel(stage, application, user, profile, applicationEmail) {
  const original=safeHref(stage.application_url||stage.source_url||'#');
  const verified = isEmail(applicationEmail);
  const fallback = original !== '#' ? `<a class="button button-outline button-full" href="${esc(original)}" target="_blank" rel="noopener noreferrer">Bekijk originele vacature ↗</a>` : '<p>Geen vacaturelink beschikbaar. Vraag het leerbedrijf of je stagebegeleider naar de sollicitatieroute.</p>';
  /* All listings retain a student-controlled application form. */
  
  if (!user) return `<div class="apply-panel"><h2>Solliciteer met StageHUB</h2><p>Log in om je sollicitatie samen te stellen en je opgeslagen CV te gebruiken.</p>${!verified?'<p>Geen geverifieerd sollicitatieadres beschikbaar. Zoek het juiste adres of gebruik de originele vacature.</p>':''}${fallback}<a class="button button-primary button-full" href="/login.html?next=${encodeURIComponent(location.pathname+location.search)}">Inloggen</a></div>`;
  return `<div class="apply-panel apply-panel-form"><span class="eyebrow">SOLLICITEREN VIA JE EIGEN MAIL</span><h2>Stel je sollicitatie samen</h2><p>StageHUB verstuurt niets namens jou. Controleer je bericht en verstuur het zelf vanuit je e-mailprogramma.</p>${!verified?'<p class="notice">Geen geverifieerd sollicitatieadres beschikbaar. Zoek het adres via de originele vacature of vraag het leerbedrijf. Vul alleen een adres in dat je zelf hebt gecontroleerd.</p>':'<p>Adres overgenomen uit de contactcatalogus. Controleer of het nog actueel is.</p>'}${fallback}<form id="directApplicationForm" class="form-stack"><label>Ontvanger<input id="applicationRecipient" type="email" maxlength="254" autocomplete="off" value="${esc(verified?applicationEmail:'')}" placeholder="Vul een gecontroleerd e-mailadres in" required></label><label>Onderwerp<input id="applicationSubject" maxlength="200" required value="${esc('Sollicitatie stage '+stage.title)}"></label><label>Bericht<textarea id="applicationMessage" rows="9" maxlength="5000" required>${esc(`Beste heer/mevrouw,\n\nGraag solliciteer ik naar de stage ${stage.title} bij ${stage.company||'uw bedrijf'}.\n\nMet vriendelijke groet,\n${profile?.display_name||user.email||''}`)}</textarea></label><div class="application-profile-summary"><b>Jouw CV</b>${profile?.cv_path?`<span>📎 ${esc(profile.cv_filename||'CV.pdf')} — opgeslagen in je privéprofiel</span><button id="downloadApplicationCv" type="button" class="button button-outline button-full">Download mijn CV</button>`:'<span>Je hebt nog geen CV geüpload. Voeg het toe via je profiel.</span>'}<a class="text-link" href="/dashboard.html">${profile?.cv_path?'CV wijzigen':'CV uploaden'} in mijn profiel ↗</a></div><button class="button button-primary button-full" type="submit">Open mijn e-mailprogramma</button><button id="downloadEml" class="button button-outline button-full" type="button">Download e-mailconcept (.eml) ${profile?.cv_path?'met CV':''}</button><p class="application-data-note">Bij ‘Open mijn e-mailprogramma’ moet je het CV zelf toevoegen. Een .eml-bestand kan het CV bevatten, maar werkt niet in ieder e-mailprogramma. Controleer altijd ontvanger, bijlage en inhoud vóór verzenden.</p><label class="checkbox-field"><input id="confirmApplicationSent" type="checkbox"> Ik heb mijn sollicitatie zelf verstuurd (via e-mail of de originele vacature)</label><button id="markApplied" class="button button-outline button-full" type="button">Markeer als gesolliciteerd</button><p id="applicationSendStatus" class="status-text" aria-live="polite"></p></form></div>`;
}

function mailFields() {
  return {to:$('#applicationRecipient').value.trim(),subject:$('#applicationSubject').value.trim(),body:$('#applicationMessage').value.trim()};
}
function mailtoUrl({to,subject,body}) { return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`; }
function mimeHeader(value) { return String(value).replace(/[\r\n]/g,' ').replace(/[^\x20-\x7E]/g,'?'); }
function mimeText(value) { return new TextEncoder().encode(value); }
function mimeSubject(value) {
  const words=[];let chunk='';
  for(const char of String(value).replace(/[\r\n]/g,' ')){
    if(mimeText(chunk+char).length>42){words.push(chunk);chunk='';}
    chunk+=char;
  }
  if(chunk)words.push(chunk);
  return words.map(word=>`=?UTF-8?B?${btoa(String.fromCharCode(...mimeText(word)))}?=`).join('\r\n ');
}
function base64(bytes) { let result=''; for(let i=0;i<bytes.length;i+=8192)result+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(result).replace(/.{1,76}/g,'$&\r\n').trimEnd(); }
async function cvBytes(profile) {
  if(!profile?.cv_path)return null;
  const {data,error}=await backend.storage.createCvUrl(profile.cv_path);
  if(error||!data?.signedUrl)throw new Error('Je CV kan niet worden opgehaald. Probeer opnieuw.');
  const response=await fetch(data.signedUrl);
  if(!response.ok)throw new Error('Je CV kan niet worden gedownload.');
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes.length>5*1024*1024)throw new Error('Het CV is te groot.');
  return bytes;
}
async function downloadEmailDraft(fields,profile) {
  const boundary='stagehub_'+crypto.randomUUID().replace(/-/g,'');
  const lines=[`To: ${mimeHeader(fields.to)}`,`Subject: ${mimeSubject(fields.subject)}`, 'X-Unsent: 1', 'MIME-Version: 1.0',`Content-Type: multipart/mixed; boundary="${boundary}"`,'',`--${boundary}`,'Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',base64(mimeText(fields.body))];
  const cv=await cvBytes(profile);
  if(cv){lines.push(`--${boundary}`,'Content-Type: application/pdf; name="CV.pdf"','Content-Disposition: attachment; filename="CV.pdf"','Content-Transfer-Encoding: base64','',base64(cv));}
  lines.push(`--${boundary}--`,'');
  const url=URL.createObjectURL(new Blob([lines.join('\r\n')],{type:'message/rfc822'}));
  const link=document.createElement('a');link.href=url;link.download='StageHUB-sollicitatie.eml';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}

function render(stage, saved = false, application = null, user = null, profile = null, applicationEmail = '') {
  const host = $('#stageDetail');
  const map = safeHref(mapSearchUrl(stage));
  const skills = Array.isArray(stage.skills) ? stage.skills : String(stage.skills || '').split(/[;,|]/).filter(Boolean);
  host.innerHTML = `<article class="panel stage-detail-card stage-detail-v3">
    <a class="back-link" href="/stages.html">← Terug naar stages</a>
    <div class="card-top"><span class="pill">${esc(stage.category || stage.internship_type || 'Stage')}</span><span class="stage-level-pill">${esc(stage.education_level || 'Alle niveaus')}</span>${stage.is_featured ? '<span class="featured-label">★ Uitgelicht</span>' : ''}</div>
    <h1>${esc(stage.title)}</h1><p class="company">${esc(stage.company || 'Bedrijf niet vermeld')}</p>
    <div class="stage-meta"><span>⌖ ${esc(stage.city || stage.location || 'Locatie niet vermeld')}</span>${stage.hours_per_week ? `<span>◷ ${esc(stage.hours_per_week)} u/week</span>` : ''}${stage.work_mode ? `<span>⌘ ${esc(stage.work_mode)}</span>` : ''}${stage.compensation ? `<span>€ ${esc(stage.compensation)}</span>` : ''}</div>
    <div class="stage-detail-layout"><div class="stage-detail-copy">
      <section><h2>Over deze stage</h2><p class="stage-detail-description">${esc(stage.description || 'Bekijk de originele vacature voor meer informatie.')}</p></section>
      ${skills.length ? `<section><h2>Vaardigheden</h2><div class="skill-chip-list">${skills.map(skill=>`<span class="skill-chip">${esc(skill)}</span>`).join('')}</div></section>` : ''}
      <section><h2>Locatie</h2><p>${esc([stage.address, stage.postal_code, stage.city || stage.location, stage.country || 'Nederland'].filter(Boolean).join(', '))}</p><a class="text-link" href="${esc(map)}" target="_blank" rel="noopener noreferrer">Bekijk op de kaart ↗</a></section>
    </div><aside class="stage-detail-aside">${renderApplicationPanel(stage,application,user,profile,applicationEmail)}
      <div class="stage-detail-actions"><button id="saveDetail" class="button button-quiet">${saved ? '♥ Bewaard' : '♡ Bewaar stage'}</button><a class="button button-quiet" href="${esc(map)}" target="_blank" rel="noopener noreferrer">⌖ Kaart</a></div>
    </aside></div>
    ${contactSection(stage,applicationEmail)}
  </article>`;
}

async function init() {
  const user = await boot();
  const id = new URLSearchParams(location.search).get('id');
  if (!id) { $('#stageDetail').innerHTML = '<section class="empty-state"><h1>Stage niet gevonden</h1><p>Deze link bevat geen stage-ID.</p><a class="button button-primary" href="/stages.html">Stages bekijken</a></section>'; return; }
  let stage=null;
  try { stage=await getStageById(id); } catch(error) { $('#stageDetail').innerHTML = `<section class="empty-state"><h1>Stage niet beschikbaar</h1><p>${esc(error.message || 'De stagecatalogus kon niet worden geladen.')}</p><a class="button button-primary" href="/stages.html">Andere stages bekijken</a></section>`; return; }
  if (!stage || stage.status !== 'published') { $('#stageDetail').innerHTML = '<section class="empty-state"><h1>Stage niet beschikbaar</h1><p>Deze vacature is niet meer gepubliceerd.</p><a class="button button-primary" href="/stages.html">Andere stages bekijken</a></section>'; return; }
  let saved=false,application=null,profile=null,applicationEmail='';
  try { const data=await getApplicationContacts();applicationEmail=data.contacts.find(contact=>contact.id===stage.id)?.email||''; } catch(error) { console.warn(error.message); }
  if(user){
    const [savedRes,appRes,profileRes]=await Promise.all([
      backend.from('stagehub_saved_stages').select('id').eq('user_id',user.id).eq('stage_id',stage.id).maybeSingle(),
      backend.from('stagehub_applications').select('*').eq('user_id',user.id).eq('stage_id',stage.id).maybeSingle(),
      backend.from('stagehub_profiles').select('*').eq('id',user.id).maybeSingle()
    ]);
    saved=Boolean(savedRes.data);application=appRes.data||null;profile=profileRes.data||null;
  }
  render(stage,saved,application,user,profile,applicationEmail);
  $('#saveDetail').addEventListener('click',async()=>{if(!user){location.href=`/login.html?next=${encodeURIComponent(location.pathname+location.search)}`;return;}const result=await toggleSaved(stage.id,user);if(result!==undefined)$('#saveDetail').textContent=result?'♥ Bewaard':'♡ Bewaar stage';});
  $('#downloadApplicationCv')?.addEventListener('click',async()=>{
    try {const bytes=await cvBytes(profile);const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));const link=document.createElement('a');link.href=url;link.download=profile.cv_filename||'CV.pdf';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}catch(error){toast(error.message,'error');}
  });
  $('#directApplicationForm')?.addEventListener('submit',event=>{
    event.preventDefault();const fields=mailFields();if(!isEmail(fields.to)||!fields.subject||!fields.body)return;
    location.href=mailtoUrl(fields);
    $('#applicationSendStatus').textContent='Je e-mailprogramma is geopend (indien ingesteld). Voeg je CV toe en verstuur de e-mail zelf.';
  });
  $('#downloadEml')?.addEventListener('click',async event=>{
    const fields=mailFields();if(!$('#directApplicationForm').reportValidity()||!isEmail(fields.to)||!fields.subject||!fields.body){toast('Vul eerst het onderwerp en bericht in.','error');return;}
    const button=event.currentTarget;button.disabled=true;
    try{await downloadEmailDraft(fields,profile);$('#applicationSendStatus').textContent='Concept gedownload. Open het in een geschikt mailprogramma, controleer de bijlage en verstuur zelf.';}catch(error){toast(error.message,'error');}finally{button.disabled=false;}
  });
  $('#markApplied')?.addEventListener('click',async event=>{
    if(!$('#confirmApplicationSent')?.checked){toast('Bevestig eerst dat je de sollicitatie zelf hebt verstuurd.','error');return;}
    const button=event.currentTarget;button.disabled=true;
    const result=await recordApplication(stage,user,{skipEmail:true});
    button.disabled=false;if(result?.applied){button.textContent='✓ Gemarkeerd als gesolliciteerd';$('#applicationSendStatus').textContent='Je sollicitatie is handmatig geregistreerd. StageHUB heeft de verzending niet geverifieerd.';}
  });
}

init();
