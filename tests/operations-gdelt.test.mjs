import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchGdeltSnapshot, gdeltDocURL} from '../docs/operations-gdelt.mjs';

const now = Date.parse('2026-11-23T03:00:00Z');
const article = (title, index, overrides = {}) => ({
  title, url:'https://example.com/report/'+index, domain:'example.com', seendate:'20261122T134500Z',
  sourcecountry:'France', ...overrides
});
const run = rows => fetchGdeltSnapshot(async (url, options) => {
  assert.equal(url,gdeltDocURL);
  assert.equal(options.credentials,'omit');
  assert.equal(options.referrerPolicy,'no-referrer');
  assert.equal(options.body,undefined);
  assert.equal(options.method,'GET');
  return {ok:true, json:async()=>({articles:rows})};
},now);

test('classifies corporate operational headlines across six risk types and retains first-seen time',async()=>{
  const titles = [
    'Example Components temporarily halts production at foundry',
    'Example Components workers announce 24-hour strike',
    'Main cargo terminal closed after cargo train derails',
    'Ransomware attack halts deliveries at Example Components',
    'Example Motors issues safety recall over defective electric brakes',
    'Example Components enters administration after financing talks fail'
  ];
  const data = await run(titles.map((title,index)=>article(title,index)));
  assert.deepEqual(data.reports.map(r=>r.category),['production','labor','logistics','cyber','quality','financial']);
  assert.equal(data.coverage[0].received,6);
  for(const r of data.reports) {
    assert.equal(r.dateBasis,'first-seen');
    assert.equal(r.seenAt,'2026-11-22T13:45:00.000Z');
    assert.equal(r.publishedAt,undefined);
    assert.equal(r.country,undefined);
    assert.equal(r.entities,undefined);
    assert.equal(r.publisher,'example.com');
  }
});

test('deduplicates syndicated headlines and tracking URLs, filtering stale, unsafe and non-operational articles',async()=>{
  const title = 'Example Components extends plant shutdown';
  const rows = [
    article(title,1,{url:'https://example.com/report/1?utm_source=news#main'}),
    article(title.toUpperCase(),2,{url:'https://another.example/syndicated'}),
    article(title+' after investigation',1),
    article(title,3,{seendate:'20261119T120000Z'}),
    article('Other Components extends plant shutdown',4,{seendate:'20261123T220000Z'}),
    article('Factory workers resume production at Example Components',5),
    article('How to prepare a factory for a ransomware attack',6),
    article('Factory output down despite higher shipments',7),
    article('Union strikes deal to avert rail strike',8),
    article('Cyber attack on newspaper website',9),
    article('Other Components files for bankruptcy',10,{url:'https://user:password@example.com/foo'}),
    article('Other Components files for bankruptcy',11,{url:'javascript:alert(1)'}),
    article('Other Components files for bankruptcy',12,{url:'http://127.0.0.1/internal'}),
    article('Other Components files for bankruptcy',13,{seendate:'20261100T000000Z'})
  ];
  const data = await run(rows);
  assert.equal(data.reports.length,1);
  assert.equal(data.reports[0].url,'https://example.com/report/1');
});

test('separates a completed empty feed from network throttling and malformed payloads',async()=>{
  const data = await run([]);
  assert.equal(data.coverage[0].retained,0);
  assert.equal(data.coverage[0].status,'ok');
  await assert.rejects(fetchGdeltSnapshot(async()=>({status:429,ok:false}),now),/rate-limiting/);
  await assert.rejects(fetchGdeltSnapshot(async()=>({ok:true,json:async()=>({})}),now),/unsupported/);
});
