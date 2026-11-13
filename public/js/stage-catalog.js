let catalogPromise = null;
const detailPromises = new Map();

export function getStageCatalog() {
  if (!catalogPromise) {
    catalogPromise = fetch('/data/stage-index.json', { cache: 'no-cache' }).then(async response => {
      if (!response.ok) throw new Error(`De stagecatalogus kon niet laden (HTTP ${response.status}).`);
      const payload = await response.json();
      if (!Array.isArray(payload.stages)) throw new Error('De stagecatalogus heeft een ongeldig formaat.');
      return payload.stages;
    }).catch(error => { catalogPromise = null; throw error; });
  }
  return catalogPromise;
}

export async function getStageById(id) {
  const key=String(id||'');
  const bucket=/^[a-f0-9]{64}$/.test(key)?key.slice(0,2):'other';
  if(!detailPromises.has(bucket))detailPromises.set(bucket,fetch(`/data/stage-details/${bucket}.json`,{cache:'no-cache'}).then(async response=>{
    if(!response.ok)throw new Error(`De stagedetails konden niet laden (HTTP ${response.status}).`);
    const payload=await response.json();if(!Array.isArray(payload.stages))throw new Error('De stagedetails hebben een ongeldig formaat.');return payload.stages;
  }).catch(error=>{detailPromises.delete(bucket);throw error;}));
  return (await detailPromises.get(bucket)).find(stage=>stage.id===key)||null;
}
