import test from 'node:test';
import assert from 'node:assert/strict';
import {filtersFromQuery,queryFromFilters} from '../public/js/search-state.js';
import {readPlan,PLAN_STORAGE_KEY} from '../public/js/student-guide.js';
test('a shared search keeps place, education, category and email preference',()=>{const filters={q:'zorg',city:'Alphen aan den Rijn',level:'MBO 4',category:'Zorg en welzijn',emailOnly:true};assert.deepEqual(filtersFromQuery(queryFromFilters(filters)),filters);});
test('cleared filters return a clean URL',()=>assert.equal(queryFromFilters({}),''));
test('unexpected or oversized URL values cannot produce unbounded search input',()=>{const result=filtersFromQuery('q='+('a'.repeat(1000))+'&email=true');assert.equal(result.q.length,100);assert.equal(result.emailOnly,false);});
test('the local start plan accepts only its own checklist steps',()=>{const storage={getItem:key=>{assert.equal(key,PLAN_STORAGE_KEY);return '["discover","cv","another-task"]';}};assert.deepEqual(readPlan(storage),['discover','cv']);});
test('private browsing or malformed local state does not block the page',()=>{assert.deepEqual(readPlan({getItem(){throw new Error('Blocked');}}),[]);assert.deepEqual(readPlan({getItem:()=>'{broken'}),[]);assert.deepEqual(readPlan({getItem:()=>'{}'}),[]);});
