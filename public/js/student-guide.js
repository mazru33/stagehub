export const PLAN_STORAGE_KEY='stagehub:start-plan:v1';
export function readPlan(storage){try{const value=JSON.parse(storage.getItem(PLAN_STORAGE_KEY)||'[]');return Array.isArray(value)?value.filter(key=>['discover','cv','message'].includes(key)):[];}catch{return [];}}
export function initStudentPlan(){
  const host=document.querySelector('#studentPlan');if(!host)return;
  const inputs=[...host.querySelectorAll('[data-plan-step]')];
  let storage;try{storage=localStorage;}catch{}
  const saved=storage?readPlan(storage):[];
  inputs.forEach(input=>{input.checked=saved.includes(input.dataset.planStep);});
  function update(persist){
    const selected=inputs.filter(input=>input.checked).map(input=>input.dataset.planStep);
    host.querySelector('#planCount').textContent=selected.length+' / 3';
    host.querySelector('#planProgress').style.width=(selected.length/3*100)+'%';
    host.querySelector('[role=progressbar]').setAttribute('aria-valuenow',String(selected.length));
    host.querySelector('#planEncouragement').textContent=['Begin waar je wilt. Dit is jouw tempo.','Eén stap gezet. Je bent begonnen.','Je hebt al wat overzicht. Ga verder wanneer jij wilt.','Je voorbereiding staat klaar. Jij kiest je volgende stap.'][selected.length];
    if(persist){try{if(!storage)throw new Error('No storage');storage.setItem(PLAN_STORAGE_KEY,JSON.stringify(selected));}catch{host.querySelector('.plan-bottom small').textContent='Je checklist blijft zichtbaar zolang deze pagina openstaat.';}}
  }
  inputs.forEach(input=>input.addEventListener('change',()=>update(true)));
  host.querySelector('#resetStudentPlan').addEventListener('click',()=>{inputs.forEach(input=>{input.checked=false;});update(true);});
  update(false);
}
