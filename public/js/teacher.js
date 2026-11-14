import { backend } from './firebase-db.js';
import { $, esc, boot, formatDate, safeInternalPath } from './common.js';
import { getStageById } from './stage-catalog.js';

const labels = {saved:'Gevolgd',applied:'Gesolliciteerd',interview:'Gesprek gepland',offer:'Aanbod',rejected:'Afgewezen',withdrawn:'Ingetrokken'};
let busy = false, generation = 0;
function clearProgress() { generation++; $('#teacherStudents').replaceChildren(); }
async function refresh() {
  if (busy) return;
  busy = true; clearProgress();
  const current = generation;
  $('#refreshProgress').disabled = true;
  $('#teacherStatus').textContent = 'Toegang en gedeelde voortgang controleren…';
  try {
    const { data, error } = await backend.mentorAction('progress');
    if (error) throw error;
    const students = Array.isArray(data) ? data : [];
    const ids = [...new Set(students.flatMap(s => s.applications.map(a => a.stage_id)))];
    const stages = new Map(await Promise.all(ids.map(async id => [id, await getStageById(id).catch(() => null)])));
    if (generation !== current || document.hidden) return;
    $('#teacherStudents').innerHTML = students.map(student => `<article class="shared-student"><h3>${esc(student.student_name)}</h3><p>${esc(student.student_email)} · deelt sinds ${esc(formatDate(student.shared_since))}</p>${student.applications.length ? student.applications.map(a => {
      const stage = stages.get(a.stage_id);
      return `<div class="shared-application"><div><a class="text-link" href="/stage.html?id=${encodeURIComponent(a.stage_id)}">${esc(stage?.title || 'Stage ' + a.stage_id)}</a><small>${esc(stage?.company || '')}</small></div><div><span class="pill">${esc(labels[a.status] || a.status)}</span><small>Bijgewerkt ${esc(formatDate(a.updated_at))}${a.applied_at ? ' · Sollicitatiedatum ' + esc(formatDate(a.applied_at)) : ''}</small></div></div>`;
    }).join('') : '<p>Deze student deelt een overzicht, maar volgt nog geen stages.</p>'}</article>`).join('');
    $('#teacherStatus').textContent = students.length ? `${students.length} student(en) delen met jou. Bijgewerkt om ${new Date().toLocaleTimeString('nl-NL')}.` : 'Nog geen gedeelde voortgang. Alleen studenten die zelf toestemming geven verschijnen hier.';
  } catch {
    clearProgress();
    $('#teacherStatus').textContent = 'Ophalen mislukt. Bevestig je e-mailadres en maak hieronder je begeleiderscode. Alleen studenten die zelf delen verschijnen hier.';
  } finally { busy = false; $('#refreshProgress').disabled = false; }
}

await boot();
const { data: { user } } = await backend.auth.getUser();
if (!user) {
  $('#teacherStatus').textContent = 'Gebruik een gewoon StageHub-account. Maak daarna een begeleiderscode; studenten kiezen zelf of ze met jou delen.';
  const link = document.createElement('a'); link.href = '/login.html?next=' + encodeURIComponent(safeInternalPath('/teacher.html')); link.className = 'button button-primary'; link.textContent = 'Inloggen of account maken ↗'; $('#teacherStudents').append(link); $('#refreshProgress').hidden = true;
} else {
  await initMentorProfile(user);
  $('#refreshProgress').addEventListener('click', refresh);
  backend.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT') { clearProgress(); location.replace('/login.html?next=%2Fteacher.html'); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearProgress(); else refresh(); });
  if (await hasMentorProfile()) await refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, 30000);
}

async function hasMentorProfile(){const {data}=await backend.from('stagehub_mentors').select('user_id').maybeSingle();return Boolean(data);}
async function initMentorProfile(user){
 const host=$('#mentorSetup');host.hidden=false;
 const {data,error}=await backend.from('stagehub_mentors').select('display_name,invite_code,expires_at').maybeSingle();
 if(error){host.textContent='Begeleidersprofiel laden mislukt. Vernieuw de pagina.';return;}
 if(data){showCode(data);return;}
 $('#teacherStatus').textContent='Maak een begeleiderscode. Studenten kunnen daarna zelf toestemming geven.';
 host.innerHTML=`<h2>Begin als docent of begeleider</h2><p>Gebruik je eigen naam en een herkenbaar e-mailadres. Je account is zelf geregistreerd en niet namens een school geverifieerd.</p><form id="mentorCreate" class="form-stack"><label>Je naam<input id="mentorName" maxlength="120" autocomplete="name" required></label><p>Studenten zien je naam en e-mailadres: <b>${esc(user.email)}</b>. Bevestig dit adres via de accountmail voordat je een code maakt.</p><button type="submit" class="button button-primary">Maak mijn begeleiderscode</button></form>`;
 $('#mentorCreate').addEventListener('submit',async event=>{
  event.preventDefault();const b=event.currentTarget.querySelector('button');b.disabled=true;
  const result=await backend.mentorAction('create',{mentor_name:$('#mentorName').value.trim()});
  if(result.error){$('#teacherStatus').textContent=result.error.message||'Code maken mislukt.';b.disabled=false;return;}
  showCode(result.data);await refresh();
 });
}
function showCode(profile){
 $('#mentorSetup').innerHTML=`<h2>Jouw begeleiderscode</h2><p>Geef deze code rechtstreeks aan je studenten. Zij controleren je naam en e-mailadres en kiezen daarna zelf of ze delen. De code alleen geeft geen toegang tot studentgegevens.</p><label>Code<input id="ownMentorCode" readonly value="${esc(profile.invite_code)}" aria-label="Jouw begeleiderscode"></label><p>Geldig tot ${esc(formatDate(profile.expires_at))}. Je naam: <b>${esc(profile.display_name)}</b>.</p><button id="copyMentorCode" class="button button-primary" type="button">Kopieer code</button> <button id="rotateMentorCode" class="button button-outline" type="button">Maak een nieuwe code</button><p class="privacy-note">Een nieuwe code maakt de oude ongeldig. Bestaande verbindingen blijven bestaan; studenten kunnen die zelf intrekken. Zelf geregistreerd, niet door school geverifieerd.</p>`;
 $('#copyMentorCode').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(profile.invite_code);$('#copyMentorCode').textContent='Code gekopieerd';}catch{$('#ownMentorCode').focus();$('#ownMentorCode').select();$('#copyMentorCode').textContent='Selecteer en kopieer de code';}});
 $('#rotateMentorCode').addEventListener('click',async event=>{
  event.target.disabled=true;const result=await backend.mentorAction('rotate');
  if(result.error){$('#teacherStatus').textContent='Nieuwe code maken mislukt.';event.target.disabled=false;return;}showCode(result.data);
 });
}
