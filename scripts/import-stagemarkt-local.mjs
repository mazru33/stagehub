import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const PROJECT = 'stagehub-777cd';
const DATABASE = 'stagehub-main';
const API = 'https://stagemarkt.nl/api/query-hub/education-search';
const PAGE_SIZE = 1000;
const BATCH_SIZE = 100;
const CHECKPOINT = path.resolve('scripts/.stagemarkt-import-progress.json');
const require = createRequire(import.meta.url);
const cliAuth = require('../.firebase-cli/node_modules/firebase-tools/lib/auth.js');
const account = cliAuth.getGlobalDefaultAccount();
if (!account?.tokens?.refresh_token) throw new Error('Firebase CLI is not logged in. Run: firebase login');
if (account.user?.email) console.log(`Firebase account: ${account.user.email}`);
const args = process.argv.slice(2);
const maxPagesIndex = args.indexOf('--max-pages');
const maxPages = maxPagesIndex >= 0 ? Number(args[maxPagesIndex + 1]) : Infinity;
if (!(maxPages > 0)) throw new Error('--max-pages must be a positive number.');

const docRoot = `projects/${PROJECT}/databases/${DATABASE}/documents`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function token() {
  const result = await cliAuth.getAccessToken(account.tokens.refresh_token, []);
  if (!result?.access_token) throw new Error('Could not obtain a Firebase access token. Run firebase login again.');
  return result.access_token;
}
async function firestore(pathname, init = {}) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(`https://firestore.googleapis.com/v1/${pathname}`, {
      ...init,
      headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json', ...(init.headers || {}) }
    });
    const text = await response.text();
    if (response.ok) return text ? JSON.parse(text) : {};
    let detail = text;
    try { detail = JSON.parse(text)?.error?.message || text; } catch { /* keep response body */ }
    lastError = new Error(`Firestore HTTP ${response.status}: ${detail.slice(0, 500)}`);
    if (![429, 500, 502, 503, 504].includes(response.status)) throw lastError;
    await sleep(Math.min(60000, 2000 * (2 ** attempt)));
  }
  throw lastError;
}
async function sourcePage(page) {
  const url = new URL(API);
  url.searchParams.set('pageSize', String(PAGE_SIZE));
  url.searchParams.set('page', String(page));
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(url, {
      headers: { accept: 'application/json, text/plain, */*', referer: 'https://stagemarkt.nl/stages', 'user-agent': 'StageHubSchoolProject/4.0 (authorized Stagemarkt vacancy import)' },
      signal: AbortSignal.timeout(45000)
    });
    if (response.ok) return response.json();
    if (![429, 500, 502, 503, 504].includes(response.status)) throw new Error(`Stagemarkt HTTP ${response.status} on page ${page}.`);
    await sleep(Math.min(60000, Number(response.headers.get('retry-after') || 2) * 1000 * (attempt + 1)));
  }
  throw new Error(`Stagemarkt page ${page} kept failing after retries.`);
}
function slug(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120) || 'stage';
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
function mapStage(item, sectorLabels) {
  const sourceId = String(item?.leerplaatsId || '').trim();
  const title = String(item?.titel || item?.kwalificatie?.naam || '').trim();
  if (!sourceId || !title) throw new Error('Missing leerplaatsId or title.');
  const qualification = item.kwalificatie || {};
  const organization = item.organisatie || {};
  const address = item.adres || organization.vestigingsadres || {};
  const city = String(address.plaats || '').trim();
  const country = address.land?.name || 'Nederland';
  const lat = Number(address.coordinaten?.lat), lng = Number(address.coordinaten?.lon);
  const sourceUrl = `https://stagemarkt.nl/stages/${slug(qualification.naam || title)}_${encodeURIComponent(sourceId)}`;
  const low = Number(item.bedragVan), high = Number(item.bedragTot);
  const compensation = (Number.isFinite(low) || Number.isFinite(high)) && (low || high)
    ? `€${Number.isFinite(low) ? low : 0} - €${Number.isFinite(high) ? high : 0} p/m` : null;
  const fields = {
    title: title.slice(0, 300), company: String(organization.naam || '').slice(0, 200), contact_name: String(organization.contactpersoonNaam || '').slice(0, 120) || null, contact_email: String(organization.emailadres || '').trim().slice(0, 254) || null, contact_phone: String(organization.telefoonnummer || '').trim().slice(0, 40) || null, contact_website: String(organization.website || '').trim().slice(0, 2048) || null, city: city.slice(0, 160) || null,
    location: [city, country].filter(Boolean).join(', ').slice(0, 200),
    education_level: qualification.niveau ? `MBO ${qualification.niveau}` : 'MBO',
    category: sectorLabels.get(String(qualification.sectorId || '')) || null,
    description: String(item.omschrijving || item.wervendeTitel || '').slice(0, 12000),
    source: 'stagemarkt', source_id: sourceId, source_url: sourceUrl, application_url: sourceUrl,
    address: [address.straat, address.huisnummer, address.extra].filter(Boolean).join(' ').slice(0, 250),
    postal_code: String(address.postcode || '').slice(0, 20) || null, province: String(address.regio || '').slice(0, 120) || null,
    country: String(country).slice(0, 80),
    latitude: Number.isFinite(lat) && lat >= -90 && lat <= 90 ? lat : null,
    longitude: Number.isFinite(lng) && lng >= -180 && lng <= 180 ? lng : null,
    compensation, start_date: date(item.startdatum), deadline: date(item.einddatum),
    skills: (Array.isArray(item.kenmerken) ? item.kenmerken : []).map(tag => String(tag?.omschrijving || tag?.naam || '').trim()).filter(Boolean).slice(0, 50),
    internship_type: String(item.leerweg || '').slice(0, 120) || null, status: 'published', is_featured: false,
  };
  fields.search_tokens = searchTokens([fields.title, fields.company, fields.city, fields.location, fields.education_level, fields.category, fields.skills, fields.internship_type, fields.description]);
  return fields;
}
function firestoreValue(value) {
  if (value === null) return { nullValue: 'NULL_VALUE' };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } };
  if (typeof value === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, firestoreValue(v)])) } };
  return { nullValue: 'NULL_VALUE' };
}
function fromFirestoreValue(value) {
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(fromFirestoreValue);
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([k, v]) => [k, fromFirestoreValue(v)]));
  return null;
}
function decodeDocument(document) {
  return Object.fromEntries(Object.entries(document.fields || {}).map(([key, value]) => [key, fromFirestoreValue(value)]));
}
async function importBatch(stages) {
  const refs = stages.map(stage => ({ stage, id: crypto.createHash('sha256').update(`stagemarkt:${stage.source_id}`).digest('hex') }));
  const existingById = new Map();
  for (let offset = 0; offset < refs.length; offset += BATCH_SIZE) {
    const group = refs.slice(offset, offset + BATCH_SIZE);
    const result = await firestore(`${docRoot}:batchGet`, { method: 'POST', body: JSON.stringify({ documents: group.map(x => `${docRoot}/stages/${x.id}`) }) });
    for (const entry of (Array.isArray(result) ? result : [result])) if (entry.found) existingById.set(entry.found.name.split('/').at(-1), decodeDocument(entry.found));
  }
  let added = 0, updated = 0;
  for (let offset = 0; offset < refs.length; offset += BATCH_SIZE) {
    const group = refs.slice(offset, offset + BATCH_SIZE);
    const now = new Date().toISOString();
    const writes = group.map(({ stage, id }) => {
      const old = existingById.get(id) || {};
      const data = { ...stage, id, status: old.status || stage.status, is_featured: old.is_featured === true, createdAt: old.createdAt || old.created_at || now, created_at: old.created_at || old.createdAt || now, updated_at: now };
      if (old.id) updated++; else added++;
      return { update: { name: `${docRoot}/stages/${id}`, fields: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, firestoreValue(value)])) }, updateMask: { fieldPaths: [...Object.keys(data), 'metadata', 'educationLevel', 'sourceId', 'sourceUrl', 'firstSeenAt', 'first_seen_at', 'lastSeenAt', 'last_seen_at', 'importedAt', 'updatedAt'] } };
    });
    await firestore(`${docRoot}:commit`, { method: 'POST', body: JSON.stringify({ writes }) });
  }
  return { added, updated };
}
async function readCheckpoint() {
  try { return JSON.parse(await fs.readFile(CHECKPOINT, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return { nextPage: 1, totalPages: null, totalCount: null, discovered: 0, added: 0, updated: 0 }; throw error; }
}
async function saveCheckpoint(state) {
  await fs.mkdir(path.dirname(CHECKPOINT), { recursive: true });
  await fs.writeFile(CHECKPOINT, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2));
}
async function main() {
  const state = await readCheckpoint();
  console.log(`Resuming at source page ${state.nextPage}${state.totalPages ? ` of ${state.totalPages}` : ''}.`);
  let pages = 0;
  while (pages < maxPages) {
    const page = await sourcePage(state.nextPage);
    if (!Array.isArray(page.items) || !Number.isInteger(page.totalPages) || page.totalPages < 1 || page.totalPages > 1000) throw new Error('Unexpected Stagemarkt pagination response; stopped safely.');
    state.totalPages = page.totalPages;
    state.totalCount = Number(page.totalCount || 0);
    const sectors = (page.filters || []).find(filter => filter.id === 'sectoren')?.options || [];
    const sectorLabels = new Map(sectors.map(option => [String(option.id), String(option.label || '')]));
    const stages = [], errors = [];
    for (const item of page.items) { try { stages.push(mapStage(item, sectorLabels)); } catch (error) { if (errors.length < 10) errors.push(error.message); } }
    const counts = await importBatch(stages);
    state.discovered += page.items.length;
    state.added += counts.added;
    state.updated += counts.updated;
    state.failed = (state.failed || 0) + (page.items.length - stages.length);
    state.nextPage++;
    await saveCheckpoint(state);
    pages++;
    console.log(`Page ${state.nextPage - 1}/${state.totalPages}: ${page.items.length} discovered, ${counts.added} added, ${counts.updated} updated; ${state.discovered}/${state.totalCount || '?'} total. ${errors.length ? `Skipped: ${errors.join('; ')}` : ''}`);
    if (state.nextPage <= state.totalPages) await sleep(500);
    else break;
  }
  const complete = state.totalPages !== null && state.nextPage > state.totalPages;
  console.log(`${complete ? 'Import complete' : 'Batch complete'}: ${state.discovered} discovered, ${state.added} added, ${state.updated} updated, ${state.failed || 0} invalid. Checkpoint: ${CHECKPOINT}`);
  if (!complete) console.log('Run the same command again to resume from the next page.');
}
main().catch(error => { console.error(`Import stopped: ${error.message}`); console.error('Progress already committed is safe; rerun the command to resume.'); process.exitCode = 1; });


