import { backend } from './firebase-db.js';
import { $, esc, toast } from './common.js';

export async function initSchoolSharing(user) {
 const host=$('#schoolSharing'); if(!host)return;
 const result=await backend.mentorAction('connections');
 if(result.error){host.textContent='Delen kon niet worden geladen. Vernieuw de pagina.';return;}
 let connections=result.data||[], recipient=null, checkedCode='';
 $('#teacherLink').hidden=false;
 const render=()=>{
  host.innerHTML=`<p class="notice">${connections.length?`Je deelt met ${connections.length} begeleider(s).`:'Delen staat uit. Niemand kan via een begeleiderscode je voortgang zien.'}</p>
   <div class="sharing-list">${connections.map(c=>`<div class="sharing-person"><div><b>${esc(c.display_name)}</b><small>${esc(c.email)}</small></div><button type="button" class="button button-outline button-small revoke-sharing" data-id="${esc(c.mentor_id)}">Toegang intrekken</button></div>`).join('')}</div>
   <form id="lookupMentor" class="form-stack"><label>Code van je docent of begeleider<input id="mentorCode" autocomplete="off" spellcheck="false" maxlength="32" pattern="[a-fA-F0-9]{32}" placeholder="Plak de code van je begeleider" required></label><button class="button button-outline" type="submit">Controleer begeleider</button></form>
   <div id="mentorPreview"></div><p class="privacy-note">Geen schoolaccount nodig. Begeleiders registreren zichzelf; StageHub heeft hun functie niet namens de school gecontroleerd. Vraag de code rechtstreeks aan je docent en controleer naam en e-mailadres voordat je deelt.</p>`;
  host.querySelectorAll('.revoke-sharing').forEach(b=>b.addEventListener('click',async()=>{
   b.disabled=true;
   const {error}=await backend.from('stagehub_mentor_grants').delete().eq('student_id',user.id).eq('mentor_id',b.dataset.id);
   if(error){toast('Intrekken mislukt. Probeer opnieuw.','error');b.disabled=false;return;}
   connections=connections.filter(c=>c.mentor_id!==b.dataset.id);render();toast('Toegang ingetrokken. Nieuwe verzoeken zijn geblokkeerd.');
  }));
  $('#lookupMentor').addEventListener('submit',async e=>{
   e.preventDefault(); const button=e.currentTarget.querySelector('button');button.disabled=true;recipient=null;$('#mentorPreview').replaceChildren();
   checkedCode=$('#mentorCode').value.trim().toLowerCase();const requestCode=checkedCode;
   try{
    const {data,error}=await backend.mentorAction('lookup',{code:checkedCode});if(error)throw error;
    if($('#mentorCode').value.trim().toLowerCase()!==requestCode)return;
    recipient=data;
    $('#mentorPreview').innerHTML=`<form id="confirmMentor" class="form-stack mentor-preview"><h3>${esc(data.display_name)}</h3><p>${esc(data.email)}</p><span class="pill">Zelf geregistreerd · niet door school geverifieerd</span><label class="sharing-consent"><input type="checkbox" id="mentorConsent" required><span>Ik herken deze begeleider en wil mijn naam, e-mailadres en alle huidige en toekomstige gevolgde stages, statussen en datums delen totdat ik toegang intrek. Mijn cv, notities en berichten blijven privé.</span></label><button type="submit" class="button button-primary">Ja, deel mijn voortgang</button></form>`;
    $('#confirmMentor').addEventListener('submit',async event=>{
     event.preventDefault();if(!recipient||!$('#mentorConsent').checked)return;
     const confirmButton=event.currentTarget.querySelector('button');confirmButton.disabled=true;
     const connected=await backend.mentorAction('connect',{code:checkedCode,expected_mentor:recipient.mentor_id});
     if(connected.error){toast(connected.error.message||'Verbinden mislukt. Controleer de code opnieuw.','error');$('#mentorPreview').replaceChildren();recipient=null;return;}
     connections=connections.filter(c=>c.mentor_id!==connected.data.mentor_id);connections.push(connected.data);recipient=null;render();toast('Je deelt nu je voortgang met deze begeleider.');
    });
   }catch(error){toast(error.message||'Code ongeldig of verlopen.','error');}
   finally{button.disabled=false;}
  });
  $('#mentorCode').addEventListener('input',()=>{recipient=null;$('#mentorPreview').replaceChildren();});
 };
 render();
}
