import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const API = 'https://stagemarkt.nl/api/query-hub/education-search';
const PAGE_SIZE = 1000;
const OUTPUT = path.resolve('public/data/stages.json');
const CONCURRENCY = 3;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function slug(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120) || 'stage';
}
function date(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}
function searchTokens(values) {
  const tokens = new Set();
  for (const value of values.flatMap(value => Array.isArray(value) ? value : [value])) {
    const normalized = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('nl-NL');
    for (const token of normalized.match(/[a-z0-9]+/g) || []) if (token.length > 1) tokens.add(token);
    const compact = normalized.replace(/[^a-z0-9]/g, '');
    if (compact.length > 1) tokens.add(compact);
  }
  return [...tokens].slice(0, 120);
}
async function getPage(pageNo) {
  const url = new URL(API);
  url.searchParams.set('pageSize', String(PAGE_SIZE));
  url.searchParams.set('page', String(pageNo));
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch(url, {
      headers: { accept: 'application/json, text/plain, */*', referer: 'https://stagemarkt.nl/stages', 'user-agent': 'StageHubSchoolProject/4.0 (authorized Stagemarkt vacancy import)' },
      signal: AbortSignal.timeout(45000)
    });
    if (response.ok) return response.json();
    if (![429, 500, 502, 503, 504].includes(response.status)) throw new Error(`Stagemarkt HTTP ${response.status} on page ${pageNo}.`);
    await pause(Math.min(60000, Number(response.headers.get('retry-after') || 2) * 1000 * (attempt + 1)));
  }
  throw new Error(`Stagemarkt page ${pageNo} kept failing after retries.`);
}
function mapStage(item, sectorLabels) {
  const sourceId = String(item?.leerplaatsId || '').trim();
  const title = String(item?.titel || item?.kwalificatie?.naam || '').trim();
  if (!sourceId || !title) return null;
  const qualification = item.kwalificatie || {};
  const organization = item.organisatie || {};
  const address = item.adres || organization.vestigingsadres || {};
  const city = String(address.plaats || '').trim();
  const country = address.land?.name || 'Nederland';
  const latitude = Number(address.coordinaten?.lat), longitude = Number(address.coordinaten?.lon);
  const sourceUrl = `https://stagemarkt.nl/stages/${slug(qualification.naam || title)}_${encodeURIComponent(sourceId)}`;
  const low = Number(item.bedragVan), high = Number(item.bedragTot);
  const compensation = (Number.isFinite(low) || Number.isFinite(high)) && (low || high)
    ? `€${Number.isFinite(low) ? low : 0} - €${Number.isFinite(high) ? high : 0} p/m` : null;
  const category = sectorLabels.get(String(qualification.sectorId || '')) || null;
  const educationLevel = qualification.niveau ? `MBO ${qualification.niveau}` : 'MBO';
  const skills = (Array.isArray(item.kenmerken) ? item.kenmerken : [])
    .map(tag => String(tag?.omschrijving || tag?.naam || '').trim()).filter(Boolean).slice(0, 50);
  const stage = {
    id: crypto.createHash('sha256').update(`stagemarkt:${sourceId}`).digest('hex'),
    title: title.slice(0, 300), company: String(organization.naam || '').slice(0, 200),
    contact_name: String(organization.contactpersoonNaam || '').slice(0, 120) || null,
    contact_email: String(organization.emailadres || '').trim().slice(0, 254) || null,
    contact_phone: String(organization.telefoonnummer || '').trim().slice(0, 40) || null,
    contact_website: String(organization.website || '').trim().slice(0, 2048) || null,
    city: city.slice(0, 160) || null, location: [city, country].filter(Boolean).join(', ').slice(0, 200),
    education_level: educationLevel, category,
    description: String(item.omschrijving || item.wervendeTitel || '').slice(0, 12000),
    source: 'stagemarkt', source_id: sourceId, source_url: sourceUrl, application_url: sourceUrl,
    address: [address.straat, address.huisnummer, address.extra].filter(Boolean).join(' ').slice(0, 250),
    postal_code: String(address.postcode || '').slice(0, 20) || null,
    province: String(address.regio || '').slice(0, 120) || null, country: String(country).slice(0, 80),
    latitude: Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 ? latitude : null,
    longitude: Number.isFinite(longitude) && longitude >= -180 && longitude <= 180 ? longitude : null,
    compensation, start_date: date(item.startdatum), deadline: date(item.einddatum), skills,
    internship_type: String(item.leerweg || '').slice(0, 120) || null,
    status: 'published', is_featured: false
  };
  stage.search_tokens = searchTokens([stage.title, stage.company, stage.city, stage.location, educationLevel, category, skills, stage.internship_type, stage.description]);
  return stage;
}

async function main() {
  const first = await getPage(1);
  if (!Array.isArray(first.items) || !Number.isInteger(first.totalPages) || first.totalPages < 1 || first.totalPages > 1000) {
    throw new Error('Unexpected Stagemarkt pagination response; no catalog was written.');
  }
  // The public search endpoint currently returns empty pages after page 10 even
  // though it reports 133 pages. Avoid pretending those inaccessible pages loaded.
  const accessiblePages = Math.min(first.totalPages, 10);
  const pages = new Array(accessiblePages);
  pages[0] = first;
  let next = 2;
  async function worker() {
    while (true) {
      const pageNo = next++;
      if (pageNo > accessiblePages) return;
      pages[pageNo - 1] = await getPage(pageNo);
      console.log(`Fetched source page ${pageNo}/${accessiblePages}.`);
      await pause(200);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, accessiblePages - 1) }, worker));
  const byId = new Map();
  for (let pageNo = 1; pageNo <= pages.length; pageNo++) {
    const page = pages[pageNo - 1];
    const options = (page.filters || []).find(filter => filter.id === 'sectoren')?.options || [];
    const labels = new Map(options.map(option => [String(option.id), String(option.label || '')]));
    for (const item of page.items || []) {
      const stage = mapStage(item, labels);
      if (stage) byId.set(stage.id, stage);
    }
    if (pageNo % 10 === 0 || pageNo === pages.length) console.log(`Mapped page ${pageNo}/${pages.length}; ${byId.size.toLocaleString()} unique stages.`);
  }
  const stages = [...byId.values()];
  await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
  const temp = `${OUTPUT}.tmp`;
  await fs.writeFile(temp, JSON.stringify({ generated_at: new Date().toISOString(), total: stages.length, source_total: first.totalCount, source_pages: first.totalPages, source_limited: first.totalPages > accessiblePages, stages }));
  await fs.rename(temp, OUTPUT);
  const stat = await fs.stat(OUTPUT);
  console.log(`Static catalog ready: ${stages.length.toLocaleString()} stages, ${(stat.size / 1024 / 1024).toFixed(1)} MB at ${OUTPUT}`);
  if (first.totalPages > accessiblePages) console.warn(`Source API reports ${first.totalCount.toLocaleString()} listings, but its public endpoint only returned ${stages.length.toLocaleString()} across the first ${accessiblePages} pages. Later pages were empty.`);
}
main().catch(error => { console.error(`Static catalog build failed: ${error.message}`); process.exitCode = 1; });
