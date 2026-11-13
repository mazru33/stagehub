let catalogPromise = null;

export function getStageCatalog() {
  if (!catalogPromise) {
    catalogPromise = fetch('/data/stages.json', { cache: 'force-cache' }).then(async response => {
      if (!response.ok) throw new Error(`De stagecatalogus kon niet laden (HTTP ${response.status}).`);
      const payload = await response.json();
      if (!Array.isArray(payload.stages)) throw new Error('De stagecatalogus heeft een ongeldig formaat.');
      return payload.stages;
    }).catch(error => { catalogPromise = null; throw error; });
  }
  return catalogPromise;
}

export async function getStageById(id) {
  const stages = await getStageCatalog();
  return stages.find(stage => stage.id === String(id)) || null;
}
