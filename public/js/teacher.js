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
    const { data, error } = await backend.teacherProgress();
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
    $('#teacherStatus').textContent = 'Geen toegang of ophalen mislukt. Dit overzicht vereist schoollogin, afzonderlijke docentgoedkeuring en toestemming van de student. Vernieuw om opnieuw te proberen.';
  } finally { busy = false; $('#refreshProgress').disabled = false; }
}

await boot();
const { data: { user } } = await backend.auth.getUser();
if (!user) {
  $('#teacherStatus').textContent = 'Log in met je schoolaccount. Docenten krijgen pas toegang na afzonderlijke goedkeuring; studenten kiezen zelf met wie ze delen.';
  const link = document.createElement('a'); link.href = '/login.html?next=' + encodeURIComponent(safeInternalPath('/teacher.html')); link.className = 'button button-primary'; link.textContent = 'Naar schoollogin ↗'; $('#teacherStudents').append(link); $('#refreshProgress').hidden = true;
} else {
  $('#refreshProgress').addEventListener('click', refresh);
  backend.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT') { clearProgress(); location.replace('/login.html?next=%2Fteacher.html'); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearProgress(); else refresh(); });
  await refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, 30000);
}
