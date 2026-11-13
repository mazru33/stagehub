import { backend } from './firebase-db.js';
import { $, boot, toast, esc, safeHref, mapSearchUrl, toggleSaved, recordApplication } from './common.js';
import { getStageById } from './stage-catalog.js';

let selectedCv = null;
function isEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '')); }

function contactSection(stage, applicationEmail = '') {
  const email=String(applicationEmail||stage.contact_email||'').trim();
  const phone=String(stage.contact_phone||'').replace(/[^\d+().\-\s]/g,'').trim();
  const website=safeHref(stage.contact_website||'');
  const hasEmail=isEmail(email),hasPhone=Boolean(phone.replace(/\D/g,''));
  const secondary=isEmail(stage.company_email)&&stage.company_email.toLowerCase()!==email.toLowerCase()?stage.company_email:'';
  if(!hasEmail&&!hasPhone&&website==='#'&&!stage.contact_name)return '';
  return `<section class="stage-contact-panel"><div><span class="eyebrow">DIRECT CONTACT</span><h2>Contact over deze stage</h2><p>${esc(stage.contact_name||stage.company||'Leerbedrijf')}</p></div><div class="stage-contact-links">${hasEmail?`<a class="contact-link" href="mailto:${esc(email)}"><span>✉</span><span><small>E-mail</small><b>${esc(email)}</b></span></a>`:''}${secondary?`<a class="contact-link" href="mailto:${esc(secondary)}"><span>✉</span><span><small>Algemeen bedrijfsadres</small><b>${esc(secondary)}</b></span></a>`:''}${hasPhone?`<a class="contact-link" href="tel:${esc(phone.replace(/[\s().-]/g,''))}"><span>☎</span><span><small>Telefoon</small><b>${esc(phone)}</b></span></a>`:''}${website!=='#'?`<a class="contact-link" href="${esc(website)}" target="_blank" rel="noopener noreferrer"><span>↗</span><span><small>Website</small><b>Bezoek het leerbedrijf</b></span></a>`:''}</div></section>`;
}

function renderApplicationPanel(stage, application, user, profile, applicationEmail) {
  const original=safeHref(stage.application_url||stage.source_url||'');
  const verified=isEmail(applicationEmail);
  const source=safeHref(stage.contact_source_url||stage.source_url||'');
  const checked=stage.contact_email_checked_at||(stage.contact_check_status==='found'?stage.contact_checked_at:null);
  const date=checked&&!Number.isNaN(Date.parse(checked))?new Intl.DateTimeFormat('nl-NL',{dateStyle:'medium'}).format(new Date(checked)):'';
  const next=encodeURIComponent(location.pathname+location.search);
  const fallback=original!=='#'?`<a class="text-link" href="${esc(original)}" target="_blank" rel="noopener noreferrer">Bekijk de vacature op Stagemarkt ↗</a>`:'<p>Geen vacaturelink beschikbaar. Vraag het leerbedrijf of je stagebegeleider naar de sollicitatieroute.</p>';
  const contactNote=verified?`<p class="contact-evidence">${stage.contact_email_kind==='company_contact'?'Algemeen bedrijfsadres':stage.contact_email_kind==='description_snapshot'?'Adres uit een eerdere vacaturetekst':'Contactadres voor deze vacature'} op ${source!=='#'?`<a href="${esc(source)}" target="_blank" rel="noopener noreferrer">Stagemarkt ↗</a>`:'de bronvacature'}${date?` · gecontroleerd ${esc(date)}`:''}. Controleer het adres vóór verzenden.</p>`:`<p class="notice">Geen geverifieerd sollicitatieadres beschikbaar.${stage.contact_check_status==='source_error'?' Stagemarkt kon deze vacature bij de laatste controle niet laden.':' Er is geen openbaar e-mailadres gevonden.'} Bekijk de bronvacature of vraag het leerbedrijf om het juiste adres.</p>`;
  const tracked=application&&['applied','interview','offer','rejected','withdrawn'].includes(application.status);
  return `<div class="apply-panel apply-panel-form" id="solliciteren">
    <span class="eyebrow">JIJ VERSTUURT JE SOLLICITATIE</span><h2>Solliciteren in 3 stappen</h2>
    <p>Controleer het contactadres, voeg je CV toe en maak je bericht persoonlijk. Je verstuurt de sollicitatie zelf.</p>
    ${stage.contact_check_status==='source_error'&&verified?'<p class="notice">De beschikbaarheid van deze vacature kon niet opnieuw worden gecontroleerd. Controleer de bron voordat je solliciteert.</p>':''}
    <form id="directApplicationForm" class="form-stack direct-apply-form">
      <fieldset class="application-step"><legend><span>1</span> Controleer de ontvanger</legend>
        ${contactNote}<label for="applicationRecipient">E-mailadres van het leerbedrijf</label>
        <input id="applicationRecipient" type="email" inputmode="email" autocapitalize="none" spellcheck="false" maxlength="254" autocomplete="off" value="${esc(verified?applicationEmail:'')}" placeholder="Vul een gecontroleerd e-mailadres in" required>
        ${stage.contact_name?`<small>Contactpersoon: ${esc(stage.contact_name)}</small>`:''}${fallback}
      </fieldset>
      <fieldset class="application-step"><legend><span>2</span> Kies je CV</legend>
        <label class="cv-upload-label" for="applicationCvFile">PDF uploaden · maximaal 5 MB</label>
        <input id="applicationCvFile" type="file" accept=".pdf,application/pdf" aria-describedby="applicationCvStatus">
        <p id="applicationCvStatus" class="cv-upload-status" aria-live="polite">${profile?.cv_path?`Je opgeslagen CV is geselecteerd: ${esc(profile.cv_filename||'CV.pdf')}`:'Nog geen CV geselecteerd. Je kunt ook zonder CV een concept maken.'}</p>
        <div class="application-cv-actions"><button id="downloadApplicationCv" type="button" class="button button-outline button-small" ${profile?.cv_path?'':'hidden'}>Download geselecteerd CV</button><button id="resetApplicationCv" type="button" class="button button-quiet button-small" hidden>Gebruik ${profile?.cv_path?'opgeslagen CV':'geen CV'}</button></div>
        <small>Een nieuw gekozen bestand wordt alleen voor dit concept gebruikt en niet opgeslagen of verstuurd. Na vernieuwen of verlaten van deze pagina kies je het opnieuw.</small>
        ${user?`<a class="text-link" href="/dashboard.html?next=${next}">CV bewaren in mijn profiel ↗</a>`:`<a class="text-link" href="/login.html?next=${next}">Inloggen om je opgeslagen CV te gebruiken ↗</a>`}
      </fieldset>
      <fieldset class="application-step"><legend><span>3</span> Maak je bericht persoonlijk</legend>
        <label for="applicationSubject">Onderwerp</label><input id="applicationSubject" maxlength="200" required value="${esc('Sollicitatie stage '+stage.title)}">
        <label for="applicationMessage">Jouw bericht</label><textarea id="applicationMessage" rows="9" maxlength="5000" required>${esc(`Beste ${stage.contact_name||'heer/mevrouw'},\n\nGraag solliciteer ik naar de stage ${stage.title} bij ${stage.company||'uw bedrijf'}.\n\nIk volg de opleiding [jouw opleiding]. Deze stage spreekt mij aan omdat [jouw motivatie]. Ik vertel graag meer over mezelf in een kennismaking.\n\nMet vriendelijke groet,\n${profile?.display_name||'[Jouw naam]'}`)}</textarea>
        <small>Vervang de tekst tussen [haakjes]. Je bericht wordt als concept in dit tabblad bewaard. Alleen een CV uit je profiel wordt automatisch opnieuw geselecteerd.</small>
      </fieldset>
      <button class="button button-primary button-full" type="submit">Open mijn e-mailprogramma ↗</button>
      <p class="application-data-note">Hiermee open je alleen een concept. Voeg je CV zelf toe in je mailprogramma en klik daar op Verzenden.</p>
      <button id="downloadEml" class="button button-outline button-full" type="button">Download e-mailconcept (.eml)${profile?.cv_path?' met CV':''}</button>
      <p class="application-data-note">Een .eml-concept bevat het geselecteerde CV. Dit werkt vooral met geschikte desktopmailprogramma’s. Controleer altijd de ontvanger, tekst en bijlage.</p>
      <button id="copyApplication" class="button button-quiet button-full" type="button">Kopieer onderwerp en bericht</button>
      <p id="applicationSendStatus" class="status-text" aria-live="polite"></p>
    </form>
    <div class="application-tracking"><h3>Heb je je sollicitatie verstuurd?</h3>
      ${user?`<label class="checkbox-field"><input id="confirmApplicationSent" type="checkbox" ${tracked?'checked disabled':''}> Ik heb mijn sollicitatie zelf verstuurd (via e-mail of de originele vacature)</label><button id="markApplied" class="button button-outline button-full" type="button" ${tracked?'disabled':''}>${tracked?'✓ Staat in je sollicitatieoverzicht':'Markeer als gesolliciteerd'}</button>`:`<p>Je hebt geen account nodig om een e-mailconcept te maken.</p><a class="text-link" href="/login.html?next=${next}">Inloggen om je sollicitatie bij te houden ↗</a>`}
      <p class="application-data-note">StageHUB verzendt geen e-mails en kan niet controleren of een bericht is aangekomen.</p>
    </div>
  </div>`;
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
  if(selectedCv)return new Uint8Array(await selectedCv.arrayBuffer());
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
    <div class="stage-meta"><span>⌖ ${esc(stage.city || stage.location || 'Locatie niet vermeld')}</span>${stage.hours_per_week ? `<span>◷ ${esc(stage.hours_per_week)} u/week</span>` : ''}${stage.work_mode ? `<span>⌘ ${esc(stage.work_mode)}</span>` : ''}${stage.compensation ? `<span>${esc(stage.compensation)}</span>` : ''}</div>
    <a class="button button-primary application-jump" href="#solliciteren">Stel je sollicitatie samen ↓</a><div class="stage-detail-layout"><div class="stage-detail-copy">
      <section><h2>Over deze stage</h2><p class="stage-detail-description">${esc(stage.description || 'Bekijk de originele vacature voor meer informatie.')}</p></section>
      ${stage.requirements?`<section><h2>Wat breng je mee?</h2><p class="stage-detail-description">${esc(stage.requirements)}</p></section>`:''}${stage.benefits?`<section><h2>Wat biedt het leerbedrijf?</h2><p class="stage-detail-description">${esc(stage.benefits)}</p></section>`:''}
      ${skills.length ? `<section><h2>Vaardigheden</h2><div class="skill-chip-list">${skills.map(skill=>`<span class="skill-chip">${esc(skill)}</span>`).join('')}</div></section>` : ''}
      <section><h2>Locatie</h2><p>${esc([stage.address, stage.postal_code, stage.city || stage.location, stage.country || 'Nederland'].filter(Boolean).join(', '))}</p><a class="text-link" href="${esc(map)}" target="_blank" rel="noopener noreferrer">Bekijk op de kaart ↗</a></section>
    </div><aside class="stage-detail-aside">${renderApplicationPanel(stage,application,user,profile,applicationEmail)}
      <div class="stage-detail-actions"><button id="saveDetail" class="button button-quiet">${saved ? '♥ Bewaard' : '♡ Bewaar stage'}</button><a class="button button-quiet" href="${esc(map)}" target="_blank" rel="noopener noreferrer">⌖ Kaart</a></div>
    </aside></div>
    ${contactSection(stage,applicationEmail)}
  </article>`;
}

async function init() {
  let user=null;try{user=await boot();}catch{toast('Inloggen is tijdelijk niet beschikbaar. Je kunt wel je sollicitatie voorbereiden.');}
  const id = new URLSearchParams(location.search).get('id');
  if (!id) { $('#stageDetail').innerHTML = '<section class="empty-state"><h1>Stage niet gevonden</h1><p>Deze link bevat geen stage-ID.</p><a class="button button-primary" href="/stages.html">Stages bekijken</a></section>'; return; }
  let stage=null;
  try { stage=await getStageById(id); } catch(error) { $('#stageDetail').innerHTML = `<section class="empty-state"><h1>Stage niet beschikbaar</h1><p>${esc(error.message || 'De stagecatalogus kon niet worden geladen.')}</p><a class="button button-primary" href="/stages.html">Andere stages bekijken</a></section>`; return; }
  if (!stage || stage.status !== 'published') { $('#stageDetail').innerHTML = '<section class="empty-state"><h1>Stage niet beschikbaar</h1><p>Deze vacature is niet meer gepubliceerd.</p><a class="button button-primary" href="/stages.html">Andere stages bekijken</a></section>'; return; }
  let saved=false,application=null,profile=null,applicationEmail=stage.contact_email||'';
  if(user){
    const [savedRes,appRes,profileRes]=await Promise.all([
      backend.from('stagehub_saved_stages').select('id').eq('user_id',user.id).eq('stage_id',stage.id).maybeSingle(),
      backend.from('stagehub_applications').select('*').eq('user_id',user.id).eq('stage_id',stage.id).maybeSingle(),
      backend.from('stagehub_profiles').select('*').eq('id',user.id).maybeSingle()
    ]);
    saved=Boolean(savedRes.data);application=appRes.data||null;profile=profileRes.data||null;
  }
  render(stage,saved,application,user,profile,applicationEmail);
  const draftKey='stagehub:draft:'+stage.id+':'+(user?.id||'guest');
  try{const guestKey='stagehub:draft:'+stage.id+':guest';const draft=JSON.parse(sessionStorage.getItem(draftKey)||sessionStorage.getItem(guestKey)||'null');if(user&&draft){sessionStorage.setItem(draftKey,JSON.stringify(draft));sessionStorage.removeItem(guestKey);}if(draft){for(const [field,id] of [['to','applicationRecipient'],['subject','applicationSubject'],['body','applicationMessage']])if(typeof draft[field]==='string'&&(field!=='to'||draft[field].trim()))$('#'+id).value=draft[field];}}catch{}
  $('#directApplicationForm').addEventListener('input',()=>{try{sessionStorage.setItem(draftKey,JSON.stringify(mailFields()));}catch{}});
  $('#applicationCvFile').addEventListener('change',async event=>{
    const file=event.target.files?.[0];if(!file)return;
    try{if(file.size>5*1024*1024||!file.size||!/\.pdf$/i.test(file.name)||new TextDecoder().decode(await file.slice(0,5).arrayBuffer())!=='%PDF-')throw new Error('Kies een geldig PDF-bestand van maximaal 5 MB.');selectedCv=file;$('#applicationCvStatus').textContent=file.name+' geselecteerd — alleen in dit tabblad.';$('#downloadApplicationCv').hidden=false;$('#resetApplicationCv').hidden=false;$('#downloadEml').textContent='Download e-mailconcept (.eml) met CV';}catch(error){event.target.value='';toast(error.message,'error');}
  });
  $('#resetApplicationCv').addEventListener('click',()=>{selectedCv=null;$('#applicationCvFile').value='';$('#applicationCvStatus').textContent=profile?.cv_path?'Je opgeslagen CV is geselecteerd: '+(profile.cv_filename||'CV.pdf'):'Nog geen CV geselecteerd.';$('#downloadApplicationCv').hidden=!profile?.cv_path;$('#resetApplicationCv').hidden=true;$('#downloadEml').textContent='Download e-mailconcept (.eml)'+(profile?.cv_path?' met CV':'');});
  $('#copyApplication').addEventListener('click',async()=>{try{const fields=mailFields();await navigator.clipboard.writeText('Aan: '+fields.to+'\nOnderwerp: '+fields.subject+'\n\n'+fields.body);$('#applicationSendStatus').textContent='Onderwerp en bericht gekopieerd. Plak ze in je mailprogramma en voeg je CV toe.';}catch{toast('Kopiëren is niet beschikbaar. Selecteer en kopieer je bericht handmatig.','error');}});
  $('#saveDetail').addEventListener('click',async()=>{if(!user){location.href=`/login.html?next=${encodeURIComponent(location.pathname+location.search)}`;return;}const result=await toggleSaved(stage.id,user);if(result!==undefined)$('#saveDetail').textContent=result?'♥ Bewaard':'♡ Bewaar stage';});
  $('#downloadApplicationCv')?.addEventListener('click',async()=>{
    try {const bytes=await cvBytes(profile);if(!bytes)throw new Error('Kies eerst een CV.');const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));const link=document.createElement('a');link.href=url;link.download=selectedCv?.name||profile?.cv_filename||'CV.pdf';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}catch(error){toast(error.message,'error');}
  });
  $('#directApplicationForm')?.addEventListener('submit',event=>{
    event.preventDefault();const fields=mailFields();if(!isEmail(fields.to)||!fields.subject||!fields.body)return;
    if(/\[[^\]]+\]/.test(fields.body)&&!confirm('Er staan nog invulvelden tussen [haakjes] in je bericht. Toch een concept openen?'))return;
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
    try{const result=await recordApplication(stage,user);if(result?.applied){button.textContent='✓ Staat in je sollicitatieoverzicht';$('#applicationSendStatus').textContent='Je sollicitatie is handmatig geregistreerd. StageHUB heeft de verzending niet geverifieerd.';try{sessionStorage.removeItem(draftKey);}catch{}button.dataset.recorded='true';$('#confirmApplicationSent').disabled=true;}}catch(error){toast(error.message||'Opslaan is mislukt. Probeer opnieuw.','error');}finally{button.disabled=button.dataset.recorded==='true';}
  });
}

init().catch(error=>{$('#stageDetail').innerHTML='<section class="empty-state"><h1>Deze stage kon niet laden</h1><p>Controleer je verbinding en probeer opnieuw.</p><a class="button button-primary" href="/stages.html">Stages bekijken</a></section>';console.error(error);});
