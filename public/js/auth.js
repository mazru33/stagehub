import { backend } from './firebase-db.js';
import { firebaseConfig } from './firebase-config.js';
import { $, toast, ensureProfile, safeInternalPath } from './common.js';
const form = $('#authForm');
if (form) {
  const params = new URLSearchParams(location.search);
  let mode = params.get('mode') === 'reset' || new URLSearchParams(location.hash.slice(1)).get('type') === 'recovery' ? 'reset' : params.get('mode') === 'signup' ? 'signup' : 'login';
  const title = $('#authHeading'), submit = $('#authSubmit'), toggle = $('#toggleMode'), nameField = $('#nameField'), message = $('#authMessage');
  const next = params.get('next');
  const safeNext = safeInternalPath(next);
  const schoolButton = $('#schoolLogin');
  schoolButton.disabled = !firebaseConfig.schoolSignInEnabled;
  schoolButton.hidden = !firebaseConfig.schoolSignInEnabled;
  $('#schoolLoginStatus').textContent = firebaseConfig.schoolSignInEnabled
    ? 'Voor studenten en docenten van Nova College. Je logt veilig in bij Microsoft.'
    : 'Student of docent? Gebruik je eigen e-mailadres. Een schoolkoppeling is niet nodig.';
  schoolButton.addEventListener('click', async () => {
    schoolButton.disabled = true;
    try {
      const callback = new URL('/login.html', location.origin);
      callback.searchParams.set('next', safeNext);
      const { error } = await backend.auth.signInWithSchool(callback.href);
      if (error) throw error;
    } catch (error) { toast(error.message || 'Schoollogin kon niet starten.', 'error'); schoolButton.disabled = false; }
  });
  function render(clearMessage=true) { const signup = mode === 'signup', reset = mode === 'reset'; title.textContent = reset ? 'Nieuw wachtwoord instellen' : signup ? 'Maak je account' : 'Welkom terug'; submit.textContent = reset ? 'Wachtwoord opslaan' : signup ? 'Account maken' : 'Inloggen'; toggle.textContent = signup ? 'Heb je al een account? Inloggen' : 'Nieuw bij StageHub? Maak gratis een account'; toggle.hidden = reset; nameField.hidden = !signup; $('#email').closest('label').hidden = reset; $('#email').required = !reset; $('#resetPassword').hidden = signup || reset; $('#password').autocomplete = signup || reset ? 'new-password' : 'current-password'; if(clearMessage)message.textContent = reset ? 'Kies een nieuw wachtwoord voor je StageHub-account.' : ''; }
  toggle.addEventListener('click', () => { mode = mode === 'signup' ? 'login' : 'signup'; render(); });
  $('#resetPassword').addEventListener('click', async () => {
    const email = $('#email').value.trim();
    if (!email) { $('#email').focus(); toast('Vul eerst je e-mailadres in.','error'); return; }
    const { error } = await backend.auth.resetPassword(email);
    if (error) toast(error.message || 'De resetmail kon niet worden verstuurd.','error');
    else { message.textContent = 'Als er een account bij dit e-mailadres hoort, ontvang je een link om je wachtwoord opnieuw in te stellen.'; message.classList.add('notice'); }
  });
  form.addEventListener('submit', async e => {
    e.preventDefault(); submit.disabled = true; submit.textContent = 'Even geduld…';
    const email = $('#email').value.trim(), password = $('#password').value;
    try {
      if (mode === 'reset') {
        const { error } = await backend.auth.updatePassword(password);
        if (error) throw error;
        message.textContent = 'Je wachtwoord is bijgewerkt. Je wordt doorgestuurd naar je profiel.'; message.classList.add('notice');
        setTimeout(() => { location.href = safeNext; }, 700); return;
      } else if (mode === 'signup') {
        const { data, error } = await backend.auth.signUp({ email, password, options: { data: { display_name: $('#displayName').value.trim() }, emailRedirectTo: location.origin + '/dashboard.html' } });
        if (error) throw error;
        if (data.session && data.user) { await ensureProfile(data.user); await backend.from('stagehub_profiles').update({display_name:$('#displayName').value.trim()}).eq('id',data.user.id); location.href = safeNext; return; }
        message.textContent = 'Account aangemaakt. Controleer je e-mail om je account te bevestigen en log daarna in.'; message.classList.add('notice');
      } else {
        const { data, error } = await backend.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await ensureProfile(data.user); location.href = safeNext; return;
      }
    } catch (err) { toast(err.message || 'Inloggen is mislukt.','error'); }
    finally { submit.disabled = false; render(false); }
  });
  render();
  const authError = params.get('error') || new URLSearchParams(location.hash.slice(1)).get('error');
  if (authError) { message.textContent = 'Microsoft-inloggen is niet afgerond. Probeer opnieuw of gebruik je StageHub-account.'; history.replaceState(null, '', '/login.html?next=' + encodeURIComponent(safeNext)); }
  backend.auth.getSession().then(({data}) => { if (data.session && mode !== 'reset') location.replace(safeNext); });
}
