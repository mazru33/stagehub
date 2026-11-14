import { backend } from './firebase-db.js';
import { $, esc, toast } from './common.js';

export async function initSchoolSharing(user) {
  const host = $('#schoolSharing');
  if (!host) return;
  const [access, teachers, grants] = await Promise.all([
    backend.schoolAccess(),
    backend.from('stagehub_school_staff').select('user_id,display_name,email').order('display_name'),
    backend.from('stagehub_teacher_access').select('teacher_id,created_at').eq('student_id', user.id)
  ]);
  if (access.error || teachers.error || grants.error) {
    host.textContent = 'Delen kon niet worden geladen. Vernieuw de pagina om het opnieuw te proberen.';
    return;
  }
  const directory = new Map((teachers.data || []).map(t => [t.user_id, t]));
  const shared = new Set((grants.data || []).map(g => g.teacher_id));
  if (access.data?.approved_teacher) $('#teacherLink').hidden = false;
  const render = () => {
    const available = [...directory.values()].filter(t => t.user_id !== user.id && !shared.has(t.user_id));
    host.innerHTML = `<p class="notice">${shared.size ? `Je deelt met ${shared.size} docent(en).` : 'Delen staat uit. Geen docent kan je voortgang bekijken.'}</p>
      <div class="sharing-list">${[...shared].map(id => {
        const teacher = directory.get(id);
        return `<div class="sharing-person"><div><b>${esc(teacher?.display_name || 'Eerder gekozen docent')}</b><small>${esc(teacher?.email || 'Niet meer beschikbaar in de docentlijst')}</small></div><button class="button button-outline button-small revoke-sharing" data-teacher="${esc(id)}" type="button">Toegang intrekken</button></div>`;
      }).join('')}</div>
      ${access.data?.school_member ? available.length ? `<form id="sharingForm" class="form-stack"><label>Kies je docent<select id="sharingTeacher" required><option value="">Selecteer een goedgekeurde docent</option>${available.map(t => `<option value="${esc(t.user_id)}">${esc(t.display_name)} — ${esc(t.email)}</option>`).join('')}</select></label><label class="sharing-consent"><input id="sharingConsent" type="checkbox" required><span>Ik wil mijn naam, school-e-mailadres en alle huidige en toekomstige gevolgde stages met status en datums delen met deze docent, totdat ik de toegang intrek.</span></label><button class="button button-primary" type="submit">Delen met deze docent</button></form>` : '<p>Er zijn nog geen andere goedgekeurde docenten beschikbaar. Je hoeft niets te delen.</p>' : '<p>Log met je Nova College Microsoft-account in om een docent te kiezen. Schoollogin moet eerst door Nova College worden ingesteld.</p><a class="text-link" href="/login.html">Naar inloggen ↗</a>'}`;
    host.querySelectorAll('.revoke-sharing').forEach(button => button.addEventListener('click', async () => {
      button.disabled = true;
      const { error } = await backend.from('stagehub_teacher_access').delete().eq('student_id', user.id).eq('teacher_id', button.dataset.teacher);
      if (error) { toast('Intrekken mislukt. Probeer opnieuw.', 'error'); button.disabled = false; return; }
      shared.delete(button.dataset.teacher); render(); toast('Toegang ingetrokken. Nieuwe verzoeken van deze docent worden geblokkeerd.');
    }));
    $('#sharingForm')?.addEventListener('submit', async event => {
      event.preventDefault();
      if (!$('#sharingConsent').checked) return;
      const teacherId = $('#sharingTeacher').value, button = event.currentTarget.querySelector('button');
      button.disabled = true;
      const { error } = await backend.from('stagehub_teacher_access').insert({ student_id: user.id, teacher_id: teacherId });
      if (error) { toast('Delen mislukt. Vernieuw de pagina en controleer je schoolaccount.', 'error'); button.disabled = false; return; }
      shared.add(teacherId); render(); toast('Je deelt nu je voortgang met deze docent.');
    });
  };
  render();
}
