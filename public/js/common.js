import { backend } from './firebase-db.js';
export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const esc = (value = '') => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
export function safeHref(value) { const raw=String(value||'').trim();if(!raw||raw==='#')return '#';try { const url = new URL(raw, location.origin); return ['https:', 'http:'].includes(url.protocol) ? url.href : '#'; } catch { return '#'; } }
export function safeInternalPath(value, fallback='/dashboard.html') { try { const raw=String(value||'');const url=new URL(raw,location.origin);return raw.startsWith('/')&&!/[\\\r\n]/.test(raw)&&url.origin===location.origin?url.pathname+url.search+url.hash:fallback; } catch { return fallback; } }
export const toast = (message, type = 'info') => { const el = $('#toast'); if (!el) return; el.textContent = message; el.dataset.type = type; el.classList.add('show'); clearTimeout(window.__toastTimer); window.__toastTimer = setTimeout(() => el.classList.remove('show'), 3600); };
export const formatDate = value => value ? new Intl.DateTimeFormat('nl-NL',{dateStyle:'medium'}).format(new Date(value)) : 'Niet vermeld';
export async function getUser() { const { data, error } = await backend.auth.getUser(); if (error) return null; return data.user; }
export function isAdmin(user) { return user?.app_metadata?.role === 'admin'; }
export async function ensureProfile(user) {
  if (!user) return;
  const { error } = await backend.from('stagehub_profiles').upsert({ id:user.id, email:user.email ?? null, display_name:user.user_metadata?.display_name ?? '' }, { onConflict:'id', ignoreDuplicates:true });
  if (error) console.warn('Profile initialization:', error.message);
}
export async function requireUser() {
  const user = await getUser();
  if (!user) { location.replace(`/login.html?next=${encodeURIComponent(location.pathname + location.search)}`); return null; }
  await ensureProfile(user);
  return user;
}
export async function requireAdmin() {
  const user = await requireUser(); if (!user) return null;
  if (!isAdmin(user)) { location.replace('/dashboard.html?notice=admin'); return null; }
  return user;
}
function initStudentNavigation(user){
  const header=document.querySelector('.site-header');if(!header)return;
  let nav=header.querySelector('.nav-links');
  if(!nav){nav=document.createElement('nav');nav.className='nav-links';nav.innerHTML='<a href="/stages.html">Stages zoeken</a><a href="/ai.html">StageMatch</a><a href="/hoe-werkt-het.html">Hoe werkt het</a>';header.insertBefore(nav,header.querySelector('#navAuth'));}
  nav.id=nav.id||'primaryNavigation';nav.setAttribute('aria-label','Hoofdnavigatie');
  if(!nav.querySelector('a[href="/teacher.html"]')){const link=document.createElement('a');link.href='/teacher.html';link.textContent='Voor begeleiders';nav.append(link);}
  if(!nav.querySelector('.mobile-account-link')){const link=document.createElement('a');link.href='/dashboard.html';link.className='mobile-account-link';link.textContent='Mijn overzicht';nav.append(link);}
  const accountLink=nav.querySelector('.mobile-account-link');accountLink.href=user?'/dashboard.html':'/login.html';accountLink.textContent=user?'Mijn overzicht':'Inloggen';
  nav.querySelectorAll('a').forEach(link=>{if(new URL(link.href,location.origin).pathname===location.pathname){link.setAttribute('aria-current','page');link.classList.add('active');}});
  if(header.querySelector('#mobileNavToggle'))return;
  const button=document.createElement('button');button.type='button';button.id='mobileNavToggle';button.className='mobile-nav-toggle';button.setAttribute('aria-label','Open navigatiemenu');button.setAttribute('aria-controls',nav.id);button.setAttribute('aria-expanded','false');button.innerHTML='<span aria-hidden="true">☰</span>';header.append(button);
  function close(){header.dataset.mobileOpen='false';button.setAttribute('aria-expanded','false');button.setAttribute('aria-label','Open navigatiemenu');}
  button.addEventListener('click',()=>{const open=button.getAttribute('aria-expanded')!=='true';header.dataset.mobileOpen=String(open);button.setAttribute('aria-expanded',String(open));button.setAttribute('aria-label',open?'Sluit navigatiemenu':'Open navigatiemenu');});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&button.getAttribute('aria-expanded')==='true'){close();button.focus();}});
  document.addEventListener('click',event=>{if(!header.contains(event.target))close();});
  nav.addEventListener('click',event=>{if(event.target.closest('a'))close();});
}
export function initNav(user) {
  initStudentNavigation(user);
  const slot = $('#navAuth'); if (!slot) return;
  if (user) slot.innerHTML = `<a class="nav-link" href="/dashboard.html">Mijn StageHub</a><button class="button button-small button-quiet" id="signOutBtn">Uitloggen</button>`;
  else slot.innerHTML = `<a class="nav-link" href="/login.html">Inloggen</a><a class="button button-small button-primary" href="/login.html?mode=signup">Gratis account</a>`;
  $('#signOutBtn')?.addEventListener('click', async () => { await backend.auth.signOut(); location.href='/'; });
}

export async function boot() {
  const { data: { session } } = await backend.auth.getSession();
  initNav(session?.user ?? null);
  backend.auth.onAuthStateChange((_event, nextSession) => initNav(nextSession?.user ?? null));
  return session?.user ?? null;
}
export function mapSearchUrl(stage) {
  if (Number.isFinite(Number(stage.latitude)) && Number.isFinite(Number(stage.longitude)) && stage.latitude !== null && stage.longitude !== null) {
    return `https://www.openstreetmap.org/?mlat=${encodeURIComponent(stage.latitude)}&mlon=${encodeURIComponent(stage.longitude)}#map=15/${encodeURIComponent(stage.latitude)}/${encodeURIComponent(stage.longitude)}`;
  }
  const place = [stage.address, stage.postal_code, stage.city || stage.location, stage.country || 'Nederland'].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place || 'Nederland')}`;
}
function stageContactSummary(stage) {
  const email=String(stage.contact_email||'').trim(),phone=String(stage.contact_phone||'').replace(/[^\d+().\-\s]/g,'').trim();
  const validEmail=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if(!validEmail&&!phone)return '';
  return `<div class="stage-contact-preview">${validEmail?`<a href="mailto:${esc(email)}">✉ ${esc(email)}</a>`:''}${phone?`<a href="tel:${esc(phone.replace(/[\s().-]/g,''))}">☎ ${esc(phone)}</a>`:''}</div>`;
}
export function stageCard(stage, saved = false, compact = false) {
  const place = stage.city || stage.location || 'Locatie niet vermeld';
  const edu = stage.education_level || 'Alle niveaus';
  const category = stage.category || stage.internship_type || 'Stage';
  const mapUrl = safeHref(mapSearchUrl(stage));
  const detailUrl = `/stage.html?id=${encodeURIComponent(stage.id)}`;
  const contact = stageContactSummary(stage);
  return `<article class="stage-card ${stage.is_featured ? 'featured' : ''}" data-stage-id="${esc(stage.id)}">
    <div class="card-top"><span class="pill">${esc(category)}</span><span class="stage-level-pill">${esc(edu)}</span>${stage.is_featured ? '<span class="featured-label">★ Uitgelicht</span>' : ''}</div>
    <h3>${esc(stage.title)}</h3><p class="company">${esc(stage.company || 'Bedrijf niet vermeld')}</p>
    <div class="stage-meta"><span>⌖ ${esc(place)}</span>${stage.hours_per_week ? `<span>◷ ${esc(stage.hours_per_week)} u/week</span>` : ''}${stage.work_mode ? `<span>⌘ ${esc(stage.work_mode)}</span>` : ''}${stage.compensation ? `<span>${esc(stage.compensation)}</span>` : ''}</div>
    ${compact ? '' : `<p class="stage-description">${esc((stage.description || 'Bekijk de originele vacature voor meer informatie.').slice(0,220))}${(stage.description||'').length>220?'…':''}</p>`}
    <p class="contact-availability">${stage.contact_email?'✉ Contactadres beschikbaar':stage.contact_check_status==='source_error'?'Controleer beschikbaarheid bij Stagemarkt':'Contact via de bronvacature'}</p>
    <div class="card-actions"><a class="button button-primary button-small" href="${detailUrl}">Solliciteer <span aria-hidden="true">↗</span></a><button class="button button-quiet button-small save-stage" data-id="${esc(stage.id)}" aria-pressed="${saved}">${saved ? '♥ Bewaard' : '♡ Bewaar'}</button></div><details class="stage-card-more"><summary>Contact &amp; meer opties</summary>${contact}<div><button class="button button-quiet button-small track-stage" data-id="${esc(stage.id)}">＋ Volgen</button><a class="button button-outline button-small map-link" href="${esc(mapUrl)}" target="_blank" rel="noopener noreferrer">⌖ Kaart</a></div></details>
  </article>`;
}
export async function toggleSaved(stageId, user) {
  if (!user) { location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`; return; }
  const { data: existing, error: readError } = await backend.from('stagehub_saved_stages').select('id').eq('user_id',user.id).eq('stage_id',stageId).maybeSingle();
  if (readError) { toast(readError.message,'error'); return; }
  if (existing) { const { error } = await backend.from('stagehub_saved_stages').delete().eq('id',existing.id); if (error) { toast(error.message,'error'); return; } toast('Stage verwijderd uit je favorieten.'); }
  else { const { error } = await backend.from('stagehub_saved_stages').insert({user_id:user.id,stage_id:stageId}); if (error) { toast(error.message,'error'); return; } toast('Stage opgeslagen.'); }
  return !existing;
}
export async function recordApplication(stage,user) {
  if (!user) { location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`; return null; }
  const {data:existing,error:readError}=await backend.from('stagehub_applications').select('*').eq('user_id',user.id).eq('stage_id',stage.id).maybeSingle();
  if(readError){toast(`Sollicitatie kon niet worden geladen: ${readError.message}`,'error');return null;}
  if(existing&&['interview','offer','rejected','withdrawn'].includes(existing.status)){
    toast(`Deze stage staat al in je profiel als “${existing.status}”.`);return {applied:false,emailSent:false};
  }
  const appliedAt=existing?.applied_at||new Date().toISOString().slice(0,10);
  const {error:saveError}=await backend.from('stagehub_applications').upsert({user_id:user.id,stage_id:stage.id,status:'applied',applied_at:appliedAt,notes:existing?.notes||'',...(existing?.confirmation_email_sent_at?{confirmation_email_sent_at:existing.confirmation_email_sent_at}:{})},{onConflict:'user_id,stage_id'});
  if(saveError){toast(`Stage niet in je profiel opgeslagen: ${saveError.message}`,'error');return null;}
  toast('Sollicitatie handmatig geregistreerd.','success');
  return {applied:true,emailSent:false};
}
