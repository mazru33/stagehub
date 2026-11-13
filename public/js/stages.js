import { backend } from './firebase-db.js';
import { $, $$, boot, toast, esc, safeHref, stageCard, toggleSaved } from './common.js';
import { getStageCatalog } from './stage-catalog.js';
const PAGE_SIZE = 18;
let user = null, savedIds = new Set(), catalog = [], filteredCatalog = [], rows = [], pageOffset = 0, hasMore = false, loading = false, map = null, markerLayer = null, mapReady = false, debounceTimer = null, leafletPromise = null;
const list = $('#stageList');
function cleanTerm(value) { return String(value || '').replace(/[(),%_\\]/g, ' ').replace(/[<>"']/g, ' ').replace(/\bmbo\s*([1-4])\b/gi, 'MBO $1').replace(/\s+/g, ' ').trim().slice(0,100); }
function normalize(value) { return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('nl-NL'); }
function currentFilters() { return { q:cleanTerm($('#searchInput').value), city:cleanTerm($('#cityInput').value), level:$('#educationInput').value, category:$('#categoryInput').value }; }
function filterCatalog() {
  const f=currentFilters(), terms=normalize(f.q).split(/\s+/).filter(Boolean), city=normalize(f.city), level=normalize(f.level), category=normalize(f.category);
  filteredCatalog=catalog.filter(stage=>{
    if(stage.status!=='published')return false;
    if(level&&normalize(stage.education_level)!==level)return false;
    if(category&&normalize(stage.category)!==category)return false;
    if(city&&!normalize(stage.city||stage.location).includes(city))return false;
    if(terms.length){const haystack=normalize([stage.title,stage.company,stage.city,stage.location,stage.category,stage.education_level,stage.description,...(stage.skills||[])].join(' '));if(!terms.every(term=>haystack.includes(term)))return false;}
    return true;
  });
}
async function setupMap() {
  if (mapReady) { map.invalidateSize(); return; }
  if (!window.L) {
    if (!leafletPromise) leafletPromise = new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'; script.onload = resolve; script.onerror = () => reject(new Error('De kaartdienst kon niet laden.')); document.head.appendChild(script); });
    try { await leafletPromise; } catch { $('#mapEmpty').hidden = false; $('#mapEmpty').textContent = 'De kaartdienst kon niet laden. Gebruik de Kaart-link op een stagekaart om de locatie te openen.'; return; }
  }
  map = window.L.map('stageMap').setView([52.15,5.3],7);
  window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'}).addTo(map);
  markerLayer = window.L.featureGroup().addTo(map); mapReady = true; renderMarkers();
}
function renderMarkers() {
  if (!mapReady || !markerLayer) return;
  markerLayer.clearLayers(); let count = 0;
  rows.forEach(s => {
    const lat = Number(s.latitude), lng = Number(s.longitude);
    if (s.latitude === null || s.longitude === null || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const popup = `<div class="map-popup"><b>${esc(s.title)}</b><br>${esc(s.company || '')}<br>${esc(s.city || s.location || '')}<br><a href="${esc(safeHref(s.application_url || s.source_url || '#'))}" target="_blank" rel="noopener">Bekijk vacature ↗</a></div>`;
    window.L.marker([lat,lng]).bindPopup(popup).addTo(markerLayer); count++;
  });
  $('#mapPinCount').textContent = `${count} ${count===1?'locatie':'locaties'}`;
  $('#mapEmpty').hidden = count > 0;
  if (count) { const bounds = markerLayer.getBounds(); map.fitBounds(bounds.pad(.18),{maxZoom:12}); }
}
function bindCards() {
  $$('.save-stage',list).forEach(btn=>btn.addEventListener('click',async()=>{btn.disabled=true;const saved=await toggleSaved(btn.dataset.id,user);if(saved!==undefined){if(saved)savedIds.add(btn.dataset.id);else savedIds.delete(btn.dataset.id);renderCards();}btn.disabled=false;}));
  $$('.track-stage',list).forEach(btn=>btn.addEventListener('click',async()=>{if(!user){location.href='/login.html?next='+encodeURIComponent('/dashboard.html');return;}btn.disabled=true;const {error}=await backend.from('stagehub_applications').upsert({user_id:user.id,stage_id:btn.dataset.id,status:'saved'},{onConflict:'user_id,stage_id',ignoreDuplicates:true});if(error)toast(error.message,'error');else toast('Stage staat nu in je voortgangsoverzicht.','success');btn.disabled=false;}));
}
function renderCards() {
  list.innerHTML = rows.length ? rows.map(s=>stageCard(s,savedIds.has(s.id))).join('') : `<div class="empty-state"><span class="empty-icon">⌕</span><h3>Geen stages gevonden</h3><p>Probeer een andere zoekterm of vergroot je zoekgebied. Je kunt je profiel aanvullen zodat je gerichter kunt zoeken.</p><a class="button button-outline" href="/dashboard.html">Mijn profiel aanvullen</a></div>`;
  $('#loadMore').hidden = !hasMore;
  bindCards(); renderMarkers();
}
function populateCategories() {
  const seen = new Set(catalog.map(s=>s.category).filter(Boolean));
  const select = $('#categoryInput'), selected = select.value;
  const opts = [...seen].sort((a,b)=>a.localeCompare(b,'nl')).map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
  if (seen.size) { const existing = [...select.options].map(o=>o.value).filter(Boolean); const all = new Set([...existing,...seen]); select.innerHTML = '<option value="">Alle vakgebieden</option>'+[...all].sort((a,b)=>a.localeCompare(b,'nl')).map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join(''); select.value = selected; }
  const cities = [...new Set(catalog.map(s=>s.city).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'nl'));
  $('#cities').innerHTML = cities.map(c=>`<option value="${esc(c)}"></option>`).join('');
}
async function loadStages(reset=true) {
  if (loading) return; loading=true;
  if (reset) { pageOffset=0; rows=[]; list.innerHTML='<div class="loading-card"><span class="loader"></span> Kansen ophalen…</div>'; }
  $('#resultCount').textContent='Stages laden…';
  try {
    if(!catalog.length)catalog=await getStageCatalog();
    if(reset)filterCatalog();
    const batch=filteredCatalog.slice(pageOffset,pageOffset+PAGE_SIZE);pageOffset+=batch.length;rows=reset?batch:[...rows,...batch];hasMore=pageOffset<filteredCatalog.length;
    $('#resultCount').textContent=`${rows.length}${hasMore?'+':''} ${rows.length===1?'stage':'stages'} in deze zoekopdracht`;
    $('#resultsTitle').textContent=currentFilters().q?`Resultaten voor “${currentFilters().q}”`:'Kansen voor jou';
    populateCategories(); renderCards();
  } catch(error) {
    list.innerHTML=`<div class="empty-state"><h3>Stages konden niet laden</h3><p>${esc(error.message||'Controleer je verbinding en probeer opnieuw.')}</p></div>`;
    $('#resultCount').textContent='Verbindingsprobleem';
  } finally { loading=false; }
}
async function init() {
  const authPromise=boot();
  const params=new URLSearchParams(location.search); if(params.get('q'))$('#searchInput').value=params.get('q');
  try { catalog=await getStageCatalog(); } catch { /* loadStages renders the readable catalog error */ }
  await loadStages(true);
  user=await authPromise;
  if(user){const {data,error}=await backend.from('stagehub_saved_stages').select('stage_id').eq('user_id',user.id);if(!error){savedIds=new Set((data||[]).map(x=>x.stage_id));renderCards();}}
  ['searchInput','cityInput','educationInput','categoryInput'].forEach(id=>$('#'+id).addEventListener(id==='searchInput'||id==='cityInput'?'input':'change',()=>{clearTimeout(debounceTimer);debounceTimer=setTimeout(()=>loadStages(true),250);}));
  $('#filterForm').addEventListener('submit',e=>{e.preventDefault();loadStages(true);});
  $('#clearFilters').addEventListener('click',()=>{$('#searchInput').value='';$('#cityInput').value='';$('#educationInput').value='';$('#categoryInput').value='';loadStages(true);});
  $('#loadMore').addEventListener('click',()=>loadStages(false));
  $('#listViewBtn').addEventListener('click',()=>{list.hidden=false;$('#mapPanel').hidden=true;$('#listViewBtn').classList.add('active');$('#mapViewBtn').classList.remove('active');$('#listViewBtn').setAttribute('aria-pressed','true');$('#mapViewBtn').setAttribute('aria-pressed','false');});
  $('#mapViewBtn').addEventListener('click',async()=>{list.hidden=true;$('#mapPanel').hidden=false;$('#listViewBtn').classList.remove('active');$('#mapViewBtn').classList.add('active');$('#listViewBtn').setAttribute('aria-pressed','false');$('#mapViewBtn').setAttribute('aria-pressed','true');await setupMap();if(mapReady){setTimeout(()=>{map.invalidateSize();renderMarkers();},60);}});
}
init();
