import { backend } from './firebase-db.js';
import { getStageCatalog } from './stage-catalog.js';
import { $, boot, stageCard, toast, toggleSaved } from './common.js';
import { initStudentPlan } from './student-guide.js';

async function init(){
  const userPromise=boot().catch(()=>null);
  if($('#year'))$('#year').textContent=new Date().getFullYear();
  initStudentPlan();
  $('#heroSearch')?.addEventListener('submit',event=>{event.preventDefault();const query=$('#heroQuery').value.trim();location.href='/stages.html'+(query?'?q='+encodeURIComponent(query):'');});
  const host=$('#featuredStages');if(!host)return;
  let stages;
  try{stages=(await getStageCatalog()).filter(stage=>stage.status==='published');}
  catch{host.hidden=true;$('#homeEmpty').hidden=false;$('#homeEmpty h3').textContent='De stages konden even niet laden';$('#homeEmpty p').textContent='Controleer je verbinding of probeer de zoekpagina. Je kunt je startplan hieronder gewoon gebruiken.';return;}
  if($('#catalogCount'))$('#catalogCount').textContent=stages.length.toLocaleString('nl-NL');
  if($('#contactCount'))$('#contactCount').textContent=stages.filter(stage=>stage.contact_email).length.toLocaleString('nl-NL');
  const companies=new Set();
  const featured=stages.slice().sort((a,b)=>Number(Boolean(b.is_featured))-Number(Boolean(a.is_featured))||Number(a.contact_check_status==='source_error')-Number(b.contact_check_status==='source_error'))
    .filter(stage=>{const key=String(stage.company||stage.id).trim().toLowerCase();if(companies.has(key))return false;companies.add(key);return true;}).slice(0,3);
  if(!featured.length){host.hidden=true;$('#homeEmpty').hidden=false;return;}
  const user=await userPromise;
  let saved=new Set();
  if(user){const {data}=await backend.from('stagehub_saved_stages').select('stage_id').eq('user_id',user.id);saved=new Set((data||[]).map(row=>row.stage_id));}
  host.innerHTML=featured.map(stage=>stageCard(stage,saved.has(stage.id))).join('');
  host.querySelectorAll('.save-stage').forEach(button=>button.addEventListener('click',async()=>{button.disabled=true;try{const value=await toggleSaved(button.dataset.id,user);if(value!==undefined){button.textContent=value?'♥ Bewaard':'♡ Bewaar';button.setAttribute('aria-pressed',String(value));}}finally{button.disabled=false;}}));
  host.querySelectorAll('.track-stage').forEach(button=>button.addEventListener('click',async()=>{if(!user){location.href='/login.html?next='+encodeURIComponent('/dashboard.html');return;}button.disabled=true;try{const {error}=await backend.from('stagehub_applications').upsert({user_id:user.id,stage_id:button.dataset.id,status:'saved'},{onConflict:'user_id,stage_id',ignoreDuplicates:true});if(error)toast(error.message,'error');else toast('Stage toegevoegd aan je sollicitatieoverzicht.','success');}finally{button.disabled=false;}}));
}
init().catch(error=>console.error(error));
