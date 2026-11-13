import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractContact, applyContact, extractPageDetail } from './lib/stagemarkt-contacts.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogFile = path.join(root, 'public/data/stages.json');
const cacheFile = path.join(root, '.scratch/stagemarkt-detail-contacts.jsonl');
const option = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const concurrency = Math.max(1, Math.min(4, Number(option('concurrency', 4))));
const delay = Math.max(150, Number(option('delay', 200)));
const limit = Number(option('limit', Infinity));
if(!Number.isInteger(concurrency)||!Number.isFinite(delay)||!(limit===Infinity||Number.isInteger(limit)&&limit>=0))throw new Error('Invalid concurrency, delay or limit option.');
const force = process.argv.includes('--refresh');
const dryRun = process.argv.includes('--dry-run');
const pageFallbackOnly=process.argv.includes('--html-fallback-only');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const catalog = JSON.parse(await fs.readFile(catalogFile, 'utf8'));
await fs.mkdir(path.dirname(cacheFile), { recursive: true });
const cache = new Map();
try {
  for (const line of (await fs.readFile(cacheFile, 'utf8')).split('\n').filter(Boolean)) {
    try { const entry = JSON.parse(line); cache.set(entry.id, entry); }
    catch { console.warn('Skipping an incomplete contact checkpoint line.'); }
  }
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const fresh = record => record && record.status !== 'source_error' && Date.now() - Date.parse(record.checked_at) < 7 * 86400000;
const queue = catalog.stages.filter(stage => stage.source === 'stagemarkt' && stage.status === 'published' && (pageFallbackOnly?cache.get(stage.id)?.status==='source_error':force || !fresh(cache.get(stage.id)))).slice(0, limit);
let next = 0, completed = 0, found = 0, errors = 0, blockedUntil = 0, cacheWrite = Promise.resolve();
const started = Date.now();

async function fetchContact(stage) {
  let reason = '';
  for (let attempt = 0; attempt < (pageFallbackOnly?0:3); attempt++) {
    if (blockedUntil > Date.now()) await pause(blockedUntil - Date.now());
    try {
      const url = new URL('https://stagemarkt.nl/api/query-hub/education-detail');
      url.searchParams.set('id', stage.source_id);
      const response = await fetch(url, {
        headers: { accept:'application/json', 'user-agent':'StageHUB/5.0 (student internship catalogue; public vacancy contacts)' },
        signal: AbortSignal.timeout(20000)
      });
      if (response.ok) return extractContact(await response.json(), stage);
      reason = `HTTP ${response.status}`;
      if (response.status === 429) {
        const retry = response.headers.get('retry-after');
        const seconds = Number(retry);
        const ms = Number.isFinite(seconds) && retry ? seconds * 1000 : Date.parse(retry) - Date.now();
        blockedUntil = Date.now() + Math.max(10000, Number.isFinite(ms) ? ms : 10000);
      }
      if (![429, 500, 502, 503, 504].includes(response.status)) break;
    } catch (error) { reason = error.message; }
    if (attempt < 2) await pause(1000 * (attempt + 1));
  }
  try {
    if(blockedUntil>Date.now())await pause(blockedUntil-Date.now());
    const source=new URL(stage.source_url);
    if(source.protocol!=='https:'||!['stagemarkt.nl','www.stagemarkt.nl'].includes(source.hostname))throw new Error('Unexpected source page host.');
    const response=await fetch(source,{redirect:'error',signal:AbortSignal.timeout(20000),headers:{'user-agent':'StageHUB/5.0 (public vacancy contact verification)'}});
    if(response.ok){
      const detail=extractPageDetail(await response.text(),stage.source_id);
      if(detail)return {...extractContact(detail,stage),contact_method:'page_data'};
      reason+=(reason?'; ':'')+'source page contains no matching vacancy data';
    }else {if(response.status===429){const retry=response.headers.get('retry-after');const seconds=Number(retry);const ms=Number.isFinite(seconds)&&retry?seconds*1000:Date.parse(retry)-Date.now();blockedUntil=Math.max(blockedUntil,Date.now()+Math.max(10000,Number.isFinite(ms)?ms:10000));}reason+=(reason?'; ':'')+`source page HTTP ${response.status}`;}
  }catch(error){reason+=(reason?'; ':'')+error.message;}
  return { id:stage.id, source_id:stage.source_id, source_url:stage.source_url, checked_at:new Date().toISOString(), status:'source_error', error:reason };
}

async function worker() {
  while (next < queue.length) {
    const stage = queue[next++];
    const record = await fetchContact(stage);
    cache.set(stage.id, record);
    cacheWrite = cacheWrite.then(() => fs.appendFile(cacheFile, JSON.stringify(record) + '\n'));
    await cacheWrite;
    completed++; if (record.email) found++; if (record.status === 'source_error') errors++;
    if (completed % 100 === 0 || completed === queue.length) {
      console.log(JSON.stringify({ completed, total:queue.length, found, errors, elapsedSeconds:Math.round((Date.now()-started)/1000) }));
    }
    await pause(delay);
  }
}
console.log(`Checking ${queue.length} vacancies (${cache.size} cached), concurrency ${concurrency}; resumable checkpoint ${cacheFile}`);
await Promise.all(Array.from({ length:concurrency }, worker));
await cacheWrite;
catalog.stages = catalog.stages.map(stage => applyContact(stage, cache.get(stage.id)));
const summary = {
  checked_at:new Date().toISOString(), total:catalog.stages.length,
  with_email:catalog.stages.filter(stage => stage.contact_email).length,
  no_public_email:catalog.stages.filter(stage => stage.contact_check_status === 'no_public_email').length,
  source_errors:catalog.stages.filter(stage => stage.contact_check_status === 'source_error').length,
  unchecked:catalog.stages.filter(stage => !stage.contact_check_status).length
};
if (!dryRun) {
  catalog.contacts_updated_at = summary.checked_at;
  catalog.contact_summary = summary;
  await fs.writeFile(catalogFile + '.tmp', JSON.stringify(catalog));
  await fs.rename(catalogFile + '.tmp', catalogFile);
  await fs.writeFile(path.join(root, 'public/data/contact-import-status.json'), JSON.stringify(summary, null, 2) + '\n');
}
console.log('Contact enrichment complete: ' + JSON.stringify(summary));
