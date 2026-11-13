const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const crypto = require('node:crypto');

const app = initializeApp();
const db = getFirestore(app, 'stagehub-main');
const auth = getAuth(app);
const allowedHostsSecret = defineSecret('APPROVED_STAGE_FEED_HOSTS');
const approvedFeedUrlSecret = defineSecret('APPROVED_STAGE_FEED_URL');
const approvedFeedTokenSecret = defineSecret('APPROVED_STAGE_FEED_TOKEN');
const stagemarktAuthorizedSecret = defineSecret('STAGEMARKT_IMPORT_AUTHORIZED');
const supabaseApiKeySecret = defineSecret('SUPABASE_API_KEY');
const SUPABASE_REST_URL = 'https://zimkbskeoskvezrbitjh.supabase.co';
const STAGEMARKT_SEARCH_API = 'https://stagemarkt.nl/api/query-hub/education-search';
const STAGEMARKT_PAGE_SIZE = 1000;
const STAGEMARKT_PAGES_PER_TICK = 5;
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 10000;

function isAdmin(request) {
  if (!request.auth || request.auth.token.admin !== true) {
    throw new HttpsError('permission-denied', 'Alleen een StageHub-beheerder mag imports uitvoeren.');
  }
}
const PROFILE_FIELDS = ['school','study_level','city','interests','future_goal','preferred_role','about_me','skills','preferred_city','travel_radius_km','availability_date','work_preference','linkedin_url','portfolio_url'];
function cleanProfilePayload(profile = {}) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new HttpsError('invalid-argument', 'Ongeldig profiel.');
  const out = {};
  const textLimits = { school:160, study_level:80, city:120, future_goal:500, preferred_role:120, about_me:2000, preferred_city:120, work_preference:40, linkedin_url:2048, portfolio_url:2048 };
  for (const [key, max] of Object.entries(textLimits)) {
    if (!(key in profile)) continue;
    const value = profile[key];
    if (value === null && ['study_level','linkedin_url','portfolio_url'].includes(key)) { out[key] = null; continue; }
    if (typeof value !== 'string' || value.length > max) throw new HttpsError('invalid-argument', `Ongeldige profielwaarde: ${key}.`);
    if (key === 'work_preference' && !['maakt niet uit','op locatie','hybride','remote'].includes(value)) throw new HttpsError('invalid-argument', 'Ongeldige werkvoorkeur.');
    if (['linkedin_url','portfolio_url'].includes(key) && value) { let u; try { u = new URL(value); } catch { throw new HttpsError('invalid-argument', `Ongeldige URL: ${key}.`); } if (!['https:','http:'].includes(u.protocol)) throw new HttpsError('invalid-argument', `Ongeldige URL: ${key}.`); }
    out[key] = value;
  }
  for (const key of ['interests','skills']) {
    if (!(key in profile)) continue;
    if (!Array.isArray(profile[key]) || profile[key].length > (key === 'interests' ? 30 : 50) || profile[key].some(x => typeof x !== 'string' || x.length > 100)) throw new HttpsError('invalid-argument', `Ongeldige profiel-lijst: ${key}.`);
    out[key] = profile[key].map(x => x.trim()).filter(Boolean);
  }
  if ('travel_radius_km' in profile) {
    const value = profile.travel_radius_km;
    if (value !== null && (!Number.isInteger(value) || value < 0 || value > 500)) throw new HttpsError('invalid-argument', 'Reisafstand moet tussen 0 en 500 km liggen.');
    out.travel_radius_km = value;
  }
  if ('availability_date' in profile) {
    const value = profile.availability_date;
    if (value !== null && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpsError('invalid-argument', 'Ongeldige beschikbaarheidsdatum.');
    out.availability_date = value;
  }
  return out;
}
function firebaseAccountRow(user) {
  return { firebase_uid: user.uid, email: user.email || null, display_name: user.displayName || '', email_verified: user.emailVerified === true, disabled: user.disabled === true, auth_created_at: user.metadata.creationTime ? new Date(user.metadata.creationTime).toISOString() : null, last_sign_in_at: user.metadata.lastSignInTime ? new Date(user.metadata.lastSignInTime).toISOString() : null, synced_at: new Date().toISOString() };
}
function firebaseProfileRow(uid, user, profile = {}) {
  return { firebase_uid: uid, email: user.email || null, display_name: String(profile.display_name || user.displayName || '').slice(0, 100), ...cleanProfilePayload(profile), updated_at: new Date().toISOString(), synced_at: new Date().toISOString() };
}
async function supabaseUpsert(table, rows) {
  const key = String(supabaseApiKeySecret.value() || '').trim();
  if (!key || key === 'disabled') throw new HttpsError('failed-precondition', 'Supabase server key is not configured in Firebase Functions secrets.');
  const headers = { apikey: key, 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=minimal' };
  // New sb_secret keys must only be sent in apikey; legacy service_role JWTs also need Authorization.
  if (!key.startsWith('sb_secret_')) headers.authorization = `Bearer ${key}`;
  const response = await fetch(`${SUPABASE_REST_URL}/rest/v1/${table}?on_conflict=firebase_uid`, { method: 'POST', headers, body: JSON.stringify(rows), signal: AbortSignal.timeout(20000) });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    console.error(`Supabase ${table} upsert failed: HTTP ${response.status} ${detail}`);
    throw new HttpsError('unavailable', `Supabase kon ${table} niet bijwerken (HTTP ${response.status}).`);
  }
}
function cleanSource(value) {
  const source = String(value || 'approved_feed').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  return source || 'approved_feed';
}
function normalizeHeader(value) {
  return String(value || '').replace(/^\uFEFF/, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[\s-]+/g, '_');
}
function parseCsv(text) {
  const sample = text.slice(0, 8000);
  let comma = 0, semi = 0, quoted = false;
  for (let i = 0; i < sample.length; i++) {
    const ch = sample[i];
    if (ch === '"') { if (quoted && sample[i + 1] === '"') i++; else quoted = !quoted; }
    else if (!quoted && ch === '\n') break;
    else if (!quoted && ch === ',') comma++;
    else if (!quoted && ch === ';') semi++;
  }
  const delimiter = semi > comma ? ';' : ',';
  const rows = []; let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delimiter) { row.push(field.replace(/\r$/, '')); field = ''; }
    else if (ch === '\n') { row.push(field.replace(/\r$/, '')); if (row.some(v => v.trim())) rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  row.push(field.replace(/\r$/, '')); if (row.some(v => v.trim())) rows.push(row);
  if (rows.length < 2) throw new HttpsError('invalid-argument', 'De CSV bevat geen datarijen.');
  const headers = rows.shift().map(normalizeHeader);
  return rows.map(values => Object.fromEntries(headers.map((header, i) => [header, String(values[i] || '').trim()])));
}
const aliases = {
  title: ['title', 'titel', 'stagetitel', 'functie', 'naam'],
  source_id: ['source_id', 'sourceid', 'vacancy_id', 'vacancyid', 'external_id', 'extern_id', 'vacature_id', 'id'],
  company: ['company', 'bedrijf', 'bedrijfsnaam', 'leerbedrijf'],
  city: ['city', 'plaats', 'woonplaats', 'stad'],
  location: ['location', 'locatie'],
  education_level: ['education_level', 'educationlevel', 'opleidingsniveau', 'niveau'],
  category: ['category', 'categorie', 'vakgebied'],
  description: ['description', 'omschrijving', 'beschrijving'],
  published_at: ['published_at', 'publishedat', 'publication_date', 'publicationdate', 'publicatiedatum', 'plaatsingsdatum', 'created_at'],
  source_url: ['source_url', 'sourceurl', 'bron_url', 'vacature_url', 'url', 'link'],
  application_url: ['application_url', 'sollicitatie_url', 'apply_url'],
  address: ['address', 'adres'], postal_code: ['postal_code', 'postcode'],
  province: ['province', 'provincie', 'regio'], country: ['country', 'land'],
  latitude: ['latitude', 'lat', 'breedtegraad'], longitude: ['longitude', 'lon', 'lng', 'lengtegraad'],
  hours_per_week: ['hours_per_week', 'uren_per_week', 'uren'], compensation: ['compensation', 'stagevergoeding', 'vergoeding'],
  start_date: ['start_date', 'startdatum'], deadline: ['deadline', 'sluitingsdatum'],
  skills: ['skills', 'vaardigheden', 'trefwoorden'], work_mode: ['work_mode', 'werkvorm'],
  internship_type: ['internship_type', 'stage_type', 'leerweg'], external_id: ['external_id', 'extern_id', 'vacature_id', 'id']
};
function getValue(record, key) {
  for (const alias of aliases[key] || [key]) {
    const value = record[normalizeHeader(alias)];
    if (value !== undefined && value !== '') return value;
  }
  return '';
}
function asNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
function normalizeEducationLevel(value) {
  const label = String(value || '').trim();
  const compact = label.toLowerCase().replace(/[\s._-]+/g, '');
  const mbo = compact.match(/^mbo([1-4])$/);
  if (mbo) return `MBO ${mbo[1]}`;
  if (compact === 'hbo') return 'HBO';
  if (compact === 'wo') return 'WO';
  return label.slice(0, 80) || null;
}
function normalizeStage(input, source) {
  const raw = Object.fromEntries(Object.entries(input || {}).map(([k, v]) => [normalizeHeader(k), v]));
  const title = String(getValue(raw, 'title') || '').trim().slice(0, 300);
  const rawUrl = String(getValue(raw, 'source_url') || '').trim();
  if (!title || !rawUrl) throw new Error('Vereiste velden ontbreken: title en source_url.');
  let url;
  try { url = new URL(rawUrl); } catch { throw new Error('source_url is geen geldige URL.'); }
  if (url.protocol !== 'https:') throw new Error('source_url moet HTTPS gebruiken.');
  url.hash = '';
  const sourceUrl = url.href;
  const lat = asNumber(getValue(raw, 'latitude'));
  const lng = asNumber(getValue(raw, 'longitude'));
  if ((lat !== null && (lat < -90 || lat > 90)) || (lng !== null && (lng < -180 || lng > 180))) throw new Error('Coördinaten vallen buiten het geldige bereik.');
  const workMode = String(getValue(raw, 'work_mode') || '').toLowerCase();
  const date = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : null;
  const publishedAt = String(getValue(raw, 'published_at') || '').slice(0, 40) || null;
  const sourceId = String(getValue(raw, 'source_id') || getValue(raw, 'external_id') || '').slice(0, 180) || null;
  const educationLevel = normalizeEducationLevel(getValue(raw, 'education_level'));
  return {
    title,
    company: String(getValue(raw, 'company') || '').slice(0, 200),
    city: String(getValue(raw, 'city') || '').slice(0, 160) || null,
    location: String(getValue(raw, 'location') || getValue(raw, 'city') || '').slice(0, 200),
    educationLevel,
    education_level: educationLevel,
    category: String(getValue(raw, 'category') || '').slice(0, 120) || null,
    description: String(getValue(raw, 'description') || '').slice(0, 12000),
    source, sourceUrl, source_url: sourceUrl,
    sourceId, publishedAt,
    application_url: String(getValue(raw, 'application_url') || sourceUrl).slice(0, 2048),
    address: String(getValue(raw, 'address') || '').slice(0, 250),
    postal_code: String(getValue(raw, 'postal_code') || '').slice(0, 20) || null,
    province: String(getValue(raw, 'province') || '').slice(0, 120) || null,
    country: String(getValue(raw, 'country') || 'Nederland').slice(0, 80),
    latitude: lat, longitude: lng,
    hours_per_week: asNumber(getValue(raw, 'hours_per_week')),
    compensation: String(getValue(raw, 'compensation') || '').slice(0, 200) || null,
    start_date: date(getValue(raw, 'start_date')), deadline: date(getValue(raw, 'deadline')),
    skills: String(getValue(raw, 'skills') || '').split(/[;,|]/).map(s => s.trim()).filter(Boolean).slice(0, 50),
    work_mode: ['op locatie', 'hybride', 'remote'].includes(workMode) ? workMode : null,
    internship_type: String(getValue(raw, 'internship_type') || '').slice(0, 120) || null,
    external_id: sourceId,
    status: 'published', metadata: { import_method: 'authorised_feed' }
  };
}
function stageIdFor(url) { return crypto.createHash('sha256').update(url).digest('hex'); }
async function claimImport(source) {
  const ref = db.collection('stagehub_import_locks').doc(source);
  const token = crypto.randomUUID();
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (snap.exists && Number(snap.data().expires_at_ms) > Date.now()) {
      throw new HttpsError('aborted', 'Er loopt al een import voor deze bron. Probeer het later opnieuw.');
    }
    tx.set(ref, { token, expires_at_ms: Date.now() + 10 * 60 * 1000 });
  });
  return async () => db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (snap.exists && snap.data().token === token) tx.delete(ref);
  }).catch(() => {});
}
function allowedHosts() {
  return new Set(String(allowedHostsSecret.value() || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean));
}
function assertAllowedFeedUrl(value, hostList = allowedHosts()) {
  let url;
  try { url = new URL(String(value || '')); } catch { throw new HttpsError('invalid-argument', 'Voer een geldige feed-URL in.'); }
  if (url.protocol !== 'https:') throw new HttpsError('invalid-argument', 'Alleen HTTPS-feeds zijn toegestaan.');
  const host = url.hostname.toLowerCase();
  if (!hostList.has(host)) throw new HttpsError('permission-denied', `Feed-host ${host} staat niet op de toegestane lijst.`);
  if (url.username || url.password) throw new HttpsError('invalid-argument', 'Feed-URL mag geen inloggegevens bevatten.');
  return url;
}
async function fetchText(url, token = '', accept = 'text/csv,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.1') {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const headers = { accept, 'user-agent': 'StageHub-authorised-feed-import/1.0' };
      if (token) headers.authorization = `Bearer ${token}`;
      const response = await fetch(url, { redirect: 'manual', headers, signal: AbortSignal.timeout(25000) });
      if (response.status >= 300 && response.status < 400) throw new HttpsError('failed-precondition', 'De feed redirect. Gebruik de definitieve HTTPS-CSV-URL.');
      if (response.status === 429 || response.status >= 500) {
        if (attempt < 2) { await response.body?.cancel().catch(() => {}); await new Promise(resolve => setTimeout(resolve, 500 * (2 ** attempt))); continue; }
        throw new HttpsError('unavailable', `De feed gaf HTTP ${response.status} na drie pogingen.`);
      }
      if (!response.ok) throw new HttpsError('unavailable', `De feed gaf HTTP ${response.status}.`);
      const declared = Number(response.headers.get('content-length') || 0);
      if (declared > MAX_BYTES) throw new HttpsError('resource-exhausted', 'De feed is groter dan 10 MB.');
      if (!response.body) throw new HttpsError('unavailable', 'De feed heeft geen leesbare response-body.');
      const reader = response.body.getReader();
      const chunks = [];
      let bytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BYTES) {
          await reader.cancel().catch(() => {});
          throw new HttpsError('resource-exhausted', 'De feed is groter dan 10 MB.');
        }
        chunks.push(Buffer.from(value));
      }
      return { text: Buffer.concat(chunks, bytes).toString('utf8'), contentType: response.headers.get('content-type') || '', link: response.headers.get('link') || '' };
    } catch (error) {
      if (error instanceof HttpsError || attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 500 * (2 ** attempt)));
    }
  }
  throw new HttpsError('unavailable', 'De feed is niet bereikbaar.');
}
function decodeJsonRows(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new HttpsError('invalid-argument', 'De JSON-feed is ongeldig.'); }
  const rows = Array.isArray(parsed) ? parsed : parsed.items || parsed.results || parsed.data || parsed.vacancies || parsed.vacatures;
  if (!Array.isArray(rows)) throw new HttpsError('invalid-argument', 'De JSON-feed moet een array bevatten of items/results/data/vacancies aanbieden.');
  return rows;
}
function nextFromJson(text) {
  try { const obj = JSON.parse(text); return obj?.next || obj?.links?.next || obj?.pagination?.next || null; } catch { return null; }
}
function nextFromLink(header) {
  const match = String(header || '').match(/<([^>]+)>\s*;\s*rel="?next"?/i);
  return match?.[1] || null;
}
async function fetchFeedRows(initialUrl, token = '', pageHosts = allowedHosts()) {
  const rows = [];
  let url = initialUrl;
  let page = 0;
  const origin = initialUrl.origin;
  while (url && page < 100 && rows.length <= MAX_ROWS) {
    if (url.protocol !== 'https:' || url.origin !== origin || !pageHosts.has(url.hostname.toLowerCase())) throw new HttpsError('permission-denied', 'De volgende feedpagina moet HTTPS gebruiken en dezelfde toegestane host houden.');
    if (page) await new Promise(resolve => setTimeout(resolve, 300));
    const response = await fetchText(url, token);
    const isJson = response.contentType.includes('json') || /^\s*[\[{]/.test(response.text);
    let pageRows = isJson ? decodeJsonRows(response.text) : parseCsv(response.text);
    if (!isJson) pageRows = pageRows.filter(row => normalizeHeader(row.title || row.titel) !== 'title');
    rows.push(...pageRows);
    if (rows.length > MAX_ROWS) throw new HttpsError('resource-exhausted', 'Maximaal 10.000 datarijen per import.');
    const next = nextFromJson(response.text) || nextFromLink(response.link);
    if (!next) break;
    try { url = new URL(next, url); } catch { throw new HttpsError('invalid-argument', 'De feed bevat een ongeldige volgende pagina-URL.'); }
    page++;
  }
  if (url && page >= 100) throw new HttpsError('resource-exhausted', 'De feed overschrijdt de limiet van 100 pagina’s.');
  return rows;
}
async function fetchAndImport({ source, url, token = '', hosts = allowedHosts() }) {
  const runRef = db.collection('importRuns').doc();
  const startedAt = new Date().toISOString();
  await runRef.set({ id: runRef.id, source, status: 'running', startedAt, discoveredCount: 0, addedCount: 0, updatedCount: 0, skippedCount: 0, failedCount: 0, errors: [], createdAt: startedAt });
  try {
    const rows = await fetchFeedRows(url, token, hosts);
    return await importRows({ source, rows, runId: runRef.id });
  } catch (error) {
    await runRef.update({ status: 'failed', errors: [{ message: String(error.message || error).slice(0, 500) }], finishedAt: new Date().toISOString() }).catch(() => {});
    throw error;
  }
}
async function importRows({ source, rows, runId }) {
  const runRef = runId ? db.collection('importRuns').doc(runId) : db.collection('importRuns').doc();
  const startedAt = new Date().toISOString();
  let added = 0, updated = 0, failed = 0, duplicates = 0, release = null;
  const errors = [];
  try {
    await runRef.set({ id: runRef.id, source, status: 'running', startedAt, discoveredCount: rows.length, addedCount: 0, updatedCount: 0, skippedCount: 0, failedCount: 0, errors: [], createdAt: startedAt });
    release = await claimImport(source);
    const deduped = new Map();
    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i];
      let stage;
      try { stage = normalizeStage(raw, source); }
      catch (error) { failed++; if (errors.length < 100) errors.push({ row: i + 1, message: String(error.message || error).slice(0, 500) }); continue; }
      if (deduped.has(stage.source_url)) duplicates++;
      deduped.set(stage.source_url, stage);
    }
    const stages = [...deduped.values()];
    for (let offset = 0; offset < stages.length; offset += 100) {
      const group = stages.slice(offset, offset + 100);
      const prepared = await Promise.all(group.map(async stage => {
        const id = stageIdFor(stage.source_url);
        const ref = db.collection('stages').doc(id);
        const existing = await ref.get();
        const now = new Date().toISOString();
        const old = existing.exists ? existing.data() : {};
        return { ref, existed: existing.exists, data: { ...stage, id, createdAt: old.createdAt || old.created_at || now, created_at: old.created_at || old.createdAt || now, firstSeenAt: old.firstSeenAt || old.first_seen_at || now, first_seen_at: old.first_seen_at || old.firstSeenAt || now, lastSeenAt: now, last_seen_at: now, importedAt: now, updatedAt: now, updated_at: now } };
      }));
      let batch = db.batch();
      for (const item of prepared) batch.set(item.ref, item.data, { merge: true });
      try {
        if (prepared.length) await batch.commit();
        added += prepared.filter(item => !item.existed).length;
        updated += prepared.filter(item => item.existed).length;
      } catch {
        for (const item of prepared) {
          try {
            await item.ref.set(item.data, { merge: true });
            if (item.existed) updated++; else added++;
          } catch (error) {
            failed++;
            if (errors.length < 100) errors.push({ id: item.data.id, message: String(error.message || error).slice(0, 500) });
          }
        }
      }
    }
    const finishedAt = new Date().toISOString();
    await runRef.update({ status: failed && added + updated === 0 ? 'failed' : 'completed', addedCount: added, updatedCount: updated, skippedCount: duplicates, failedCount: failed, errors, finishedAt });
  return { discovered_count: rows.length, added_count: added, updated_count: updated, imported_count: added + updated, skipped_count: duplicates, failed_count: failed, run_id: runRef.id };
  } catch (error) {
    await runRef.update({ status: 'failed', addedCount: added, updatedCount: updated, failedCount: failed, errors: [...errors, { message: String(error.message || error).slice(0, 500) }].slice(0, 100), finishedAt: new Date().toISOString() }).catch(() => {});
    throw error;
  } finally {
    if (release) await release();
  }
}

function stagemarktSlug(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120) || 'stage';
}
function stagemarktDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}
function mapStagemarktStage(item, sectorLabels = new Map()) {
  const sourceId = String(item?.leerplaatsId || '').trim();
  const title = String(item?.titel || item?.kwalificatie?.naam || '').trim();
  if (!sourceId || !title) throw new Error('Stagemarkt-record mist leerplaatsId of titel.');
  const qualification = item.kwalificatie || {};
  const organization = item.organisatie || {};
  const address = item.adres || organization.vestigingsadres || {};
  const country = address.land?.name || 'Nederland';
  const city = String(address.plaats || '').trim();
  const lat = Number(address.coordinaten?.lat);
  const lng = Number(address.coordinaten?.lon);
  const sourceUrl = `https://stagemarkt.nl/stages/${stagemarktSlug(qualification.naam || title)}_${encodeURIComponent(sourceId)}`;
  const sector = sectorLabels.get(String(qualification.sectorId || '')) || null;
  const compensationLow = Number(item.bedragVan);
  const compensationHigh = Number(item.bedragTot);
  const compensation = (Number.isFinite(compensationLow) || Number.isFinite(compensationHigh)) && (compensationLow || compensationHigh)
    ? `€${Number.isFinite(compensationLow) ? compensationLow : 0} - €${Number.isFinite(compensationHigh) ? compensationHigh : 0} p/m`
    : null;
  return {
    title: title.slice(0, 300),
    company: String(organization.naam || '').slice(0, 200),
    contact_name: String(organization.contactpersoonNaam || '').slice(0, 120) || null,
    contact_email: String(organization.emailadres || '').trim().slice(0, 254) || null,
    contact_phone: String(organization.telefoonnummer || '').trim().slice(0, 40) || null,
    contact_website: String(organization.website || '').trim().slice(0, 2048) || null,
    city: city.slice(0, 160) || null,
    location: [city, country].filter(Boolean).join(', ').slice(0, 200),
    education_level: qualification.niveau ? `MBO ${qualification.niveau}` : 'MBO',
    educationLevel: qualification.niveau ? `MBO ${qualification.niveau}` : 'MBO',
    category: sector,
    description: String(item.omschrijving || item.wervendeTitel || '').slice(0, 12000),
    source: 'stagemarkt',
    source_id: sourceId,
    sourceId,
    source_url: sourceUrl,
    sourceUrl,
    application_url: sourceUrl,
    address: [address.straat, address.huisnummer, address.extra].filter(Boolean).join(' ').slice(0, 250),
    postal_code: String(address.postcode || '').slice(0, 20) || null,
    province: String(address.regio || '').slice(0, 120) || null,
    country: String(country).slice(0, 80),
    latitude: Number.isFinite(lat) && lat >= -90 && lat <= 90 ? lat : null,
    longitude: Number.isFinite(lng) && lng >= -180 && lng <= 180 ? lng : null,
    compensation,
    start_date: stagemarktDate(item.startdatum),
    deadline: stagemarktDate(item.einddatum),
    skills: (Array.isArray(item.kenmerken) ? item.kenmerken : []).map(tag => String(tag?.omschrijving || tag?.naam || '').trim()).filter(Boolean).slice(0, 50),
    internship_type: String(item.leerweg || '').slice(0, 120) || null,
    status: 'published',
    is_featured: false,
    metadata: { import_method: 'authorised_stagemarkt_search', qualification: String(qualification.naam || '').slice(0, 200), qualification_code: String(qualification.crebocode || '').slice(0, 40), sector_id: String(qualification.sectorId || '').slice(0, 80), work_days_per_week: String(item.dagenPerWeek || '').slice(0, 80) }
  };
}
async function fetchStagemarktPage(pageNumber) {
  const url = new URL(STAGEMARKT_SEARCH_API);
  url.searchParams.set('pageSize', String(STAGEMARKT_PAGE_SIZE));
  url.searchParams.set('page', String(pageNumber));
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { headers: { accept: 'application/json, text/plain, */*', referer: 'https://stagemarkt.nl/stages', 'user-agent': 'StageHubSchoolProject/4.0 (authorized Stagemarkt vacancy import)' }, signal: AbortSignal.timeout(45000) });
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        const retryAfter = Number(response.headers.get('retry-after') || 0);
        await response.body?.cancel().catch(() => {});
        await new Promise(resolve => setTimeout(resolve, Math.max(1000, Math.min(10000, retryAfter * 1000 || 1000 * (attempt + 1)))));
        continue;
      }
      if (!response.ok) throw new Error(`Stagemarkt gaf HTTP ${response.status} op pagina ${pageNumber}.`);
      const length = Number(response.headers.get('content-length') || 0);
      if (length > 7 * 1024 * 1024) throw new Error(`Stagemarkt-pagina ${pageNumber} overschrijdt 7 MB.`);
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > 7 * 1024 * 1024) throw new Error(`Stagemarkt-pagina ${pageNumber} overschrijdt 7 MB.`);
      const data = JSON.parse(text);
      if (!Array.isArray(data.items) || !Number.isInteger(data.totalPages) || data.totalPages < 1 || data.totalPages > 1000) throw new Error('Onverwachte Stagemarkt-paginering; import veilig gestopt.');
      return data;
    } catch (error) {
      lastError = error;
      if (attempt === 2 || /overschrijdt|Onverwachte|HTTP 4/.test(String(error.message))) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  throw lastError || new Error('Stagemarkt is niet bereikbaar.');
}
async function persistStagemarktItems(items, sectorLabels) {
  let added = 0, updated = 0, failed = 0;
  const errors = [];
  const stages = [];
  for (let i = 0; i < items.length; i++) {
    try { stages.push(mapStagemarktStage(items[i], sectorLabels)); }
    catch (error) { failed++; if (errors.length < 20) errors.push({ row: i + 1, message: String(error.message || error).slice(0, 300) }); }
  }
  for (let offset = 0; offset < stages.length; offset += 100) {
    const group = stages.slice(offset, offset + 100);
    const refs = group.map(stage => db.collection('stages').doc(stage.source_id ? stageIdFor(`stagemarkt:${stage.source_id}`) : stageIdFor(stage.source_url)));
    const existing = await db.getAll(...refs);
    const now = new Date().toISOString();
    const batch = db.batch();
    for (let i = 0; i < group.length; i++) {
      const old = existing[i].exists ? existing[i].data() : {};
      const stage = group[i];
      const data = { ...stage, id: refs[i].id, status: old.status || stage.status, is_featured: old.is_featured === true, createdAt: old.createdAt || old.created_at || now, created_at: old.created_at || old.createdAt || now, firstSeenAt: old.firstSeenAt || old.first_seen_at || now, first_seen_at: old.first_seen_at || old.firstSeenAt || now, lastSeenAt: now, last_seen_at: now, importedAt: now, updatedAt: now, updated_at: now };
      batch.set(refs[i], data, { merge: true });
      if (existing[i].exists) updated++; else added++;
    }
    await batch.commit();
  }
  return { added, updated, failed, errors };
}
async function startStagemarktScrape() {
  const jobRef = db.collection('stagemarktImportJobs').doc('active');
  const runRef = db.collection('importRuns').doc();
  const now = new Date().toISOString();
  let result;
  await db.runTransaction(async tx => {
    const current = await tx.get(jobRef);
    if (current.exists && current.data().status === 'running') { result = { already_running: true, ...current.data() }; return; }
    const job = { status: 'running', run_id: runRef.id, next_page: 1, total_pages: null, total_count: null, discovered_count: 0, added_count: 0, updated_count: 0, failed_count: 0, created_at: now, updated_at: now, worker_token: null, worker_until_ms: 0 };
    tx.set(jobRef, job);
    tx.set(runRef, { id: runRef.id, source: 'stagemarkt', status: 'running', startedAt: now, createdAt: now, discoveredCount: 0, addedCount: 0, updatedCount: 0, skippedCount: 0, failedCount: 0, errors: [] });
    result = { already_running: false, ...job };
  });
  return result;
}
async function processStagemarktScrapeTick() {
  if (!['yes', 'true'].includes(String(stagemarktAuthorizedSecret.value() || '').trim().toLowerCase())) return;
  const jobRef = db.collection('stagemarktImportJobs').doc('active');
  const token = crypto.randomUUID();
  const nowMs = Date.now();
  let job;
  await db.runTransaction(async tx => {
    const snap = await tx.get(jobRef);
    if (!snap.exists || snap.data().status !== 'running' || Number(snap.data().worker_until_ms || 0) > nowMs) return;
    job = snap.data();
    tx.update(jobRef, { worker_token: token, worker_until_ms: nowMs + 10 * 60 * 1000, updated_at: new Date().toISOString() });
  });
  if (!job) return;
  const runRef = db.collection('importRuns').doc(job.run_id);
  try {
    let nextPage = Number(job.next_page || 1);
    let totalPages = Number(job.total_pages || 0);
    let discovered = Number(job.discovered_count || 0);
    let added = Number(job.added_count || 0);
    let updated = Number(job.updated_count || 0);
    let failed = Number(job.failed_count || 0);
    const errors = [];
    for (let n = 0; n < STAGEMARKT_PAGES_PER_TICK; n++) {
      if (totalPages && nextPage > totalPages) break;
      const page = await fetchStagemarktPage(nextPage);
      totalPages = page.totalPages;
      const sectors = (page.filters || []).find(filter => filter.id === 'sectoren')?.options || [];
      const sectorLabels = new Map(sectors.map(item => [String(item.id), String(item.label || '')]));
      const counts = await persistStagemarktItems(page.items, sectorLabels);
      discovered += page.items.length;
      added += counts.added;
      updated += counts.updated;
      failed += counts.failed;
      errors.push(...counts.errors.map(error => ({ page: nextPage, ...error })));
      nextPage++;
      const patch = { next_page: nextPage, total_pages: totalPages, total_count: Number(page.totalCount || 0), discovered_count: discovered, added_count: added, updated_count: updated, failed_count: failed, updated_at: new Date().toISOString() };
      await db.runTransaction(async tx => {
        const current = await tx.get(jobRef);
        if (!current.exists || current.data().worker_token !== token) throw new Error('Stagemarkt-job lock changed while importing.');
        tx.update(jobRef, patch);
      });
      await runRef.update({ discoveredCount: discovered, addedCount: added, updatedCount: updated, failedCount: failed, errors: errors.slice(0, 100) });
      if (nextPage <= totalPages) await new Promise(resolve => setTimeout(resolve, 500));
    }
    const complete = totalPages > 0 && nextPage > totalPages;
    if (complete) {
      const finishedAt = new Date().toISOString();
      await jobRef.update({ status: 'completed', worker_token: null, worker_until_ms: 0, updated_at: finishedAt, finished_at: finishedAt });
      await runRef.update({ status: failed && added + updated === 0 ? 'failed' : 'completed', finishedAt });
    } else {
      await jobRef.update({ worker_token: null, worker_until_ms: 0, updated_at: new Date().toISOString() });
    }
  } catch (error) {
    const finishedAt = new Date().toISOString();
    await jobRef.update({ status: 'failed', worker_token: null, worker_until_ms: 0, last_error: String(error.message || error).slice(0, 500), updated_at: finishedAt, finished_at: finishedAt }).catch(() => {});
    await runRef.update({ status: 'failed', errors: [{ message: String(error.message || error).slice(0, 500) }], finishedAt }).catch(() => {});
    throw error;
  } finally {
    await db.runTransaction(async tx => {
      const current = await tx.get(jobRef);
      if (current.exists && current.data().worker_token === token) tx.update(jobRef, { worker_token: null, worker_until_ms: 0 });
    }).catch(() => {});
  }
}

exports.importApprovedStages = onCall({ region: 'europe-west1', timeoutSeconds: 120, memory: '512MiB', enforceAppCheck: true }, async request => {
  isAdmin(request);
  const body = request.data || {};
  if (body.license_confirmed !== true) throw new HttpsError('failed-precondition', 'Bevestig dat je toestemming hebt om deze gegevens te importeren.');
  if (!Array.isArray(body.rows) || body.rows.length < 1 || body.rows.length > 100) throw new HttpsError('invalid-argument', 'Importeer 1 tot 100 regels per batch.');
  const source = cleanSource(body.source);
  return importRows({ source, rows: body.rows });
});

exports.refreshApprovedFeed = onCall({ region: 'europe-west1', timeoutSeconds: 540, memory: '1GiB', secrets: [allowedHostsSecret, approvedFeedTokenSecret], enforceAppCheck: true }, async request => {
  isAdmin(request);
  const body = request.data || {};
  if (body.license_confirmed !== true) throw new HttpsError('failed-precondition', 'Bevestig dat je toestemming hebt om deze feed te gebruiken.');
  const url = assertAllowedFeedUrl(body.feed_url);
  return fetchAndImport({ source: cleanSource(body.source), url, token: approvedFeedTokenSecret.value() });
});

exports.adminImporterConfig = onCall({ region: 'europe-west1', secrets: [stagemarktAuthorizedSecret], enforceAppCheck: true }, async request => {
  isAdmin(request);
  const authorized = ['yes', 'true'].includes(String(stagemarktAuthorizedSecret.value() || '').trim().toLowerCase());
  return { authorizationConfirmed: authorized, scraperEnabled: authorized, sourceEnabled: authorized };
});

exports.runStagemarktImport = onCall({ region: 'europe-west1', timeoutSeconds: 60, memory: '256MiB', secrets: [stagemarktAuthorizedSecret], enforceAppCheck: true }, async request => {
  isAdmin(request);
  if (!['yes', 'true'].includes(String(stagemarktAuthorizedSecret.value() || '').trim().toLowerCase())) throw new HttpsError('failed-precondition', 'Stagemarkt-import staat uit. Leg eerst de schriftelijke toestemming en toegestane feed vast.');
  if (request.data?.authorization_confirmed !== true) throw new HttpsError('failed-precondition', 'Bevestig dat StageHub schriftelijke toestemming heeft voor het gebruik van Stagemarkt-stagevacatures.');
  return startStagemarktScrape();
});

exports.adminStagemarktImportStatus = onCall({ region: 'europe-west1', enforceAppCheck: true }, async request => {
  isAdmin(request);
  const snap = await db.collection('stagemarktImportJobs').doc('active').get();
  if (!snap.exists) return { status: 'not_started', next_page: 1, total_pages: null, total_count: null, discovered_count: 0, added_count: 0, updated_count: 0, failed_count: 0 };
  const data = snap.data();
  return { status: data.status, next_page: data.next_page, total_pages: data.total_pages, total_count: data.total_count, discovered_count: data.discovered_count, added_count: data.added_count, updated_count: data.updated_count, failed_count: data.failed_count, last_error: data.last_error || null, run_id: data.run_id || null };
});

exports.syncFirebaseProfileToSupabase = onCall({ region: 'europe-west1', timeoutSeconds: 60, memory: '256MiB', secrets: [supabaseApiKeySecret], enforceAppCheck: true }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Log in om je profiel te synchroniseren.');
  const user = await auth.getUser(request.auth.uid);
  const profile = firebaseProfileRow(user.uid, user, request.data?.profile || {});
  await Promise.all([
    supabaseUpsert('stagehub_firebase_users', [firebaseAccountRow(user)]),
    supabaseUpsert('stagehub_firebase_profiles', [profile])
  ]);
  return { synced: true, firebase_uid: user.uid, synced_at: profile.synced_at };
});

exports.adminBackfillFirebaseUsersToSupabase = onCall({ region: 'europe-west1', timeoutSeconds: 300, memory: '1GiB', secrets: [supabaseApiKeySecret], enforceAppCheck: true }, async request => {
  isAdmin(request);
  const pageToken = typeof request.data?.pageToken === 'string' ? request.data.pageToken : undefined;
  const page = await auth.listUsers(100, pageToken);
  const accounts = page.users.map(firebaseAccountRow);
  const profileRows = [];
  const errors = [];
  for (const user of page.users) {
    try {
      const snapshot = await db.collection('stagehub_profiles').doc(user.uid).get();
      profileRows.push(firebaseProfileRow(user.uid, user, snapshot.exists ? snapshot.data() : {}));
    } catch (error) {
      if (errors.length < 100) errors.push({ uid: user.uid, message: String(error.message || error).slice(0, 250) });
    }
  }
  if (accounts.length) await supabaseUpsert('stagehub_firebase_users', accounts);
  if (profileRows.length) await supabaseUpsert('stagehub_firebase_profiles', profileRows);
  return { synced_users: accounts.length, synced_profiles: profileRows.length, skipped_profiles: errors.length, errors, nextPageToken: page.pageToken || null };
});

exports.adminListUsers = onCall({ region: 'europe-west1', enforceAppCheck: true }, async request => {
  isAdmin(request);
  const pageToken = typeof request.data?.pageToken === 'string' ? request.data.pageToken : undefined;
  const result = await auth.listUsers(100, pageToken);
  return {
    users: result.users.map(user => ({ uid: user.uid, email: user.email || null, displayName: user.displayName || '', disabled: user.disabled, createdAt: user.metadata.creationTime, lastSignInAt: user.metadata.lastSignInTime || null, admin: user.customClaims?.admin === true })),
    nextPageToken: result.pageToken || null
  };
});

exports.adminSetUserDisabled = onCall({ region: 'europe-west1', enforceAppCheck: true }, async request => {
  isAdmin(request);
  const uid = String(request.data?.uid || '');
  const disabled = request.data?.disabled;
  if (!uid || uid.length > 128 || typeof disabled !== 'boolean') throw new HttpsError('invalid-argument', 'Ongeldige gebruiker of status.');
  if (uid === request.auth.uid) throw new HttpsError('failed-precondition', 'Je kunt je eigen beheeraccount niet uitschakelen.');
  const user = await auth.getUser(uid);
  if (user.customClaims?.admin === true) throw new HttpsError('failed-precondition', 'Een beheeraccount kan niet vanuit dit scherm worden uitgeschakeld.');
  await auth.updateUser(uid, { disabled });
  return { uid, disabled };
});

exports.adminListApplications = onCall({ region: 'europe-west1', enforceAppCheck: true }, async request => {
  isAdmin(request);
  const pageSize = Math.max(1, Math.min(100, Number(request.data?.pageSize) || 50));
  let query = db.collection('stagehub_applications').orderBy('updated_at', 'desc');
  const pageToken = typeof request.data?.pageToken === 'string' ? request.data.pageToken : '';
  if (pageToken) {
    const cursor = await db.collection('stagehub_applications').doc(pageToken).get();
    if (cursor.exists) query = query.startAfter(cursor);
  }
  const snapshot = await query.limit(pageSize).get();
  const applications = await Promise.all(snapshot.docs.map(async snap => {
    const data = snap.data();
    const [profile, stage] = await Promise.all([
      db.collection('stagehub_profiles').doc(data.user_id).get(),
      db.collection('stages').doc(data.stage_id).get()
    ]);
    return { id: snap.id, user_id: data.user_id, email: profile.exists ? profile.data().email || null : null, status: data.status, notes: data.notes || '', updated_at: data.updated_at, stage_title: stage.exists ? stage.data().title || '' : 'Stage niet beschikbaar', company: stage.exists ? stage.data().company || '' : '' };
  }));
  return { applications, nextPageToken: snapshot.docs.length === pageSize ? snapshot.docs.at(-1).id : null };
});

exports.adminSetApplicationStatus = onCall({ region: 'europe-west1', enforceAppCheck: true }, async request => {
  isAdmin(request);
  const id = String(request.data?.id || '');
  const status = String(request.data?.status || '');
  if (!id || id.length > 256 || !['saved','applied','interview','offer','rejected','withdrawn'].includes(status)) throw new HttpsError('invalid-argument', 'Ongeldige applicatie of status.');
  const ref = db.collection('stagehub_applications').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Deze voortgangsvermelding bestaat niet meer.');
  await ref.update({ status, updated_at: new Date().toISOString() });
  return { id, status };
});

exports.adminSystemStatus = onCall({ region: 'europe-west1', enforceAppCheck: true }, async request => {
  isAdmin(request);
  await Promise.all([db.collection('stages').limit(1).get(), auth.listUsers(1)]);
  return { status: 'ok', firestore: 'connected', authentication: 'connected', checked_at: new Date().toISOString(), region: 'europe-west1', database: 'stagehub-main' };
});

exports.scheduledApprovedFeedRefresh = onSchedule({
  region: 'europe-west1', schedule: 'every day 04:00', timeZone: 'Europe/Amsterdam',
  timeoutSeconds: 540, memory: '1GiB', secrets: [allowedHostsSecret, approvedFeedUrlSecret, approvedFeedTokenSecret]
}, async () => {
  const feedUrl = approvedFeedUrlSecret.value();
  if (!feedUrl || feedUrl.trim().toLowerCase() === 'disabled') return;
  const source = 'scheduled_approved_feed';
  try {
    const url = assertAllowedFeedUrl(feedUrl);
    await fetchAndImport({ source, url, token: approvedFeedTokenSecret.value() });
  } catch (error) {
    throw error;
  }
});

exports.processStagemarktScrapeJob = onSchedule({ region: 'europe-west1', schedule: 'every 1 minutes', timeoutSeconds: 540, memory: '1GiB', secrets: [stagemarktAuthorizedSecret] }, async () => {
  await processStagemarktScrapeTick();
});

