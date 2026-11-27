import test from 'node:test';
import assert from 'node:assert/strict';
import {loadOperationalLeads,matchOperationalLeads,matchOperationalReports,operationalSourceURL} from '../docs/screen-operations.mjs';

const now = Date.parse('2026-11-23T12:00:00Z');
const generatedAt = new Date(now).toISOString();
const publishedAt = '2026-11-22T09:00:00Z';
const coverage = [{id:'operator', name:'Operator notices', url:'https://operator.example/feed',
  status:'ok', checkedAt:generatedAt, received:10, retained:8}];
const snapshot = (reports, additions={}) => ({version:1,generatedAt,coverage,reports,...additions});
const news = (id,title,category,extra={}) => ({id,title,category,publishedAt,url:'https://press.example/'+id,publisher:'Press',...extra});
const row = (id,name,city='Lyon',country='France') => ({id,name,city,country});
const named = row('1','Asteron Components SAS');
const run = (reports,rows=[named]) => matchOperationalLeads(rows,snapshot(reports),{now});

test('reviewed map locations identify companies independently of supplier matches', () => {
  const location = {name:'Example Software', city:'Lyon', lat:45.75, lon:4.85,
    basis:'Headquarters city.', sourceURL:'https://example.org/contact'};
  const report = news('software', 'Example Software confirms a cyberattack that disrupted services', 'cyber',
    {country:'France', sourceId:'reviewed-public', mapLocation:location});
  const {items, matches} = run([report]);
  assert.deepEqual(items[0].mapLocation, location);
  assert.deepEqual(matches, []);
  assert.equal(run([{...report, sourceId:'gdelt'}]).items[0].mapLocation, undefined);
  assert.equal(matchOperationalReports([named], [report], {now, checkedAt:generatedAt, agent:true}).items[0].mapLocation, undefined);
  for (const invalid of [{lat:'45'}, {lon:181}, {lat:-91}, {name:' '}, {city:''}, {basis:null},
    {sourceURL:'http://example.org/contact'}, {sourceURL:'https://user@example.org/contact'}]) {
    assert.equal(run([{...report, mapLocation:{...location, ...invalid}}]).items[0].mapLocation, undefined);
  }
});

test('matches a public plant fire to the site using the formal Netherlands register label', () => {
  const local = row('nl', 'Asteron Components BV', 'Delft', 'Netherlands (Kingdom of the)');
  const other = row('be', 'Asteron Components BV', 'Delft', 'Belgium');
  const report = news('fire', 'Roof fire at Asteron Components plant', 'production', {
    entities: ['Asteron Components B.V.'], country: 'Netherlands', locality: 'Delft'
  });
  const code = name => name.toLowerCase() === 'netherlands' ? 'NL' : null;
  const result = matchOperationalLeads([local, other], snapshot([report]), {now, countryCode: code});
  assert.deepEqual(result.matches.map(m => [m.supplier, m.kind, m.decision]), [[local, 'company-city', 'watch']]);
});

test('reads six categories with evidence and preserves unmatched reports without inventing supplier matches',()=>{
  const reports = [
    news('a','Asteron Components halts production after plant fire','production'),
    news('b','Asteron Components workers begin a 24-hour strike','labor'),
    news('c','Asteron Components suspends freight shipments after rail derailment','logistics'),
    news('d','Asteron Components reports a ransomware incident that disrupted shipments','cyber'),
    news('e','Asteron Components recalls defective bearings','quality'),
    news('f','Asteron Components files for insolvency','financial'),
    news('g','Port of Exampleton suspends cargo operations','logistics')
  ];
  const result = run(reports);
  assert.equal(result.items.length,7);
  assert.deepEqual(result.matches.map(m=>m.event.category),['production','labor','logistics','cyber','quality','financial']);
  assert(result.matches.every(m=>m.kind==='company-only' && m.decision==='watch' && m.namedSite===false));
  assert.equal(result.matches[0].event.sources[0].url,reports[0].url);
});

test('limits shortened company references to the named locality and excludes conflicting structured evidence',()=>{
  const nearby = row('2','Asteron Automotive Ltd','Lyon');
  const other = row('3','Asteron Automotive Ltd','Tours');
  const unrelated = row('4','Asteron University','Lyon');
  const branches=[nearby,other,unrelated];
  const title='Asteron halts production at Lyon plant';
  assert.deepEqual(run([news('a',title,'production')],branches).matches.map(m=>m.supplier.id),['2']);
  assert.deepEqual(run([news('a',title,'production',{entities:['Other Inc']})],branches).matches,[]);
  assert.deepEqual(run([news('a',title,'production',{country:'United Kingdom'})],branches).matches,[]);
  assert.deepEqual(run([news('b','Asteron halts production','production')],branches).matches,[]);
});

test('admits issuer notices with a structured legal entity and ignores incidental references and geographic-only leads',()=>{
  const reports=[
    news('a','Bankruptcy filing by equipment supplier','financial',{entities:['Asteron Components S.A.S.'],country:'France'}),
    news('b','Asteron Components supplier files for bankruptcy','financial'),
    news('c','Unrelated supplier recalls defective pump used by Asteron Components','quality'),
    news('d','Unrelated Components plant fire in Lyon','production',{country:'France',locality:'Lyon'}),
    news('e','Lyon port terminal closed to freight','logistics',{country:'France',locality:'Lyon'})
  ];
  assert.deepEqual(run(reports).matches.map(m=>[m.event.id,m.kind]),[['ops-a','company-only'],['ops-e','locality']]);
});

test('avoids generic names, undifferentiated abbreviations, partial names and unrelated branch mentions',()=>{
  const businesses=[row('a','THE GROUP Ltd'),row('b','ARC Inc.'),row('c','Aster Ltd'),named];
  const reports=[
    news('a','The group recalls batteries','quality'),
    news('b','ARC recalls chemical','quality'),
    news('c','Asteroid factory halts production','production'),
    news('d','Asteron Components plant closes in New York','production')
  ];
  assert.deepEqual(run(reports,businesses).matches,[]);
  assert.equal(run([news('e','Factory fire at Asteron Components','production')]).matches[0].kind,'company-only');
});

test('filters recovery, threats, subthreshold short actions, misleading subjects, duplicate and stale publications',()=>{
  const reports=[
    news('a','Asteron Components resumes production following cyberattack','cyber'),
    news('b','Asteron Components workers vote on strike','labor'),
    news('c','Asteron Components workers begin 4-hour strike','labor'),
    news('c2','Asteron Components workers announce eight-hour rail strike','labor'),
    news('c3','Asteron Components workers strike for five hours','labor'),
    news('d','Asteron Components files for bankruptcy','financial',{publishedAt:'2026-11-20T11:59:58Z'}),
    news('e','Asteron Components recalls defective bearings','quality',{url:'javascript:bad'}),
    news('f','How to prevent a cyberattack at Asteron Components','cyber'),
    news('g','Asteron Components investment doubles','financial'),
    news('g1','Over a century later, victims of a mine explosion are being memorialized','production'),
    news('g2','Asteron Components introduces a ransomware recovery platform','cyber'),
    news('g3','Asteron Components workers may strike after talks collapse','labor'),
    news('g4','How to bypass a shutdown at an Asteron Components plant','production'),
    news('h','Asteron Components files for bankruptcy','financial'),
    news('i','Asteron Components files for bankruptcy','financial',{url:'https://press.example/h'}),
    news('j','ASTERON COMPONENTS FILES FOR BANKRUPTCY','financial',{url:'https://syndication.example/article'})
  ];
  assert.deepEqual(run(reports).items.map(r=>r.id),['h']);
});

test('distinguishes discovery timestamps from publication dates and never marks a headline red',()=>{
  const {items,matches} = run([news('1','Asteron Components confirms data breach that disrupted operations','cyber',{
    publishedAt:undefined,seenAt:publishedAt,dateBasis:'first-seen',operationalImpactVerified:true,namedSite:true
  })]);
  assert.equal(items[0].publishedAt,undefined);
  assert.equal(items[0].seenAt,publishedAt);
  assert.equal(matches[0].event.sources[0].published,undefined);
  assert.match(matches[0].event.sources[0].role,/First seen/);
  assert.equal(matches[0].namedSite,false);
  assert.deepEqual(run([news('2','Asteron Components confirms data breach','cyber')]).matches,[]);
  assert.equal(run([news('3','Asteron Components: appointment of administrators','financial',{entities:['Asteron Components Ltd']})]).matches.length,1);
});

test('chooses freshest usable fixed snapshot, caches only public data and handles partial and failed sources',async()=>{
  const urls=[];
  const failure={...coverage[0],id:'missing',name:'Unavailable feed',status:'unavailable'};
  const data=snapshot([news('a','Asteron Components halts production at Lyon plant','production')],{coverage:[...coverage,failure]});
  const fetcher=async(url,options)=>{
    urls.push(String(url));
    assert.equal(options.credentials,'omit');
    assert.equal(options.referrerPolicy,'no-referrer');
    assert.equal(options.body,undefined);
    return {ok:true,json:async()=> url===operationalSourceURL ? data : {...data,generatedAt:'2026-11-22T09:00:00Z',reports:[]}};
  };
  const first=await loadOperationalLeads([named],{fetcher,now});
  const second=await loadOperationalLeads([row('b','Others Ltd')],{fetcher,now});
  assert.equal(first.matches.length,1);assert.deepEqual(second.matches,[]);
  assert.deepEqual(urls.sort(),['./data/operational-risks.json',operationalSourceURL].sort());
  assert.match(first.coverage,/Partial coverage/);
  assert.throws(()=>matchOperationalLeads([], {...data,coverage:[failure]},{now}),/unavailable/);
  assert.throws(()=>matchOperationalLeads([], {...data,generatedAt:'2026-11-10T09:00:00Z'},{now}),/older than/);
});

test('uses a fixed anonymous GDELT request when both snapshots lack a usable source',async()=>{
  const urls=[];
  const stale=snapshot([],{generatedAt:'2026-11-01T09:00:00Z'});
  const unavailable=snapshot([],{coverage:[{...coverage[0],status:'unavailable'}]});
  const fetcher=async(url,options)=>{
    urls.push(String(url));
    assert.equal(options.credentials,'omit');
    assert.equal(options.body,undefined);
    if (url === operationalSourceURL || url === './data/operational-risks.json')
      return {ok:true,json:async()=>url === operationalSourceURL ? stale : unavailable};
    assert.equal(new URL(url).hostname,'api.gdeltproject.org');
    assert(!decodeURIComponent(url).includes('Asteron'));
    return {ok:true,json:async()=>({articles:[{title:'Asteron Components GmbH files for bankruptcy',
      url:'https://press.example/filing',seendate:'20261122T090000Z',language:'English'}]})};
  };
  const result=await loadOperationalLeads([named],{now,fetcher});
  assert.equal(urls.length,3);
  assert.equal(result.items[0].dateBasis,'first-seen');
  assert.equal(result.matches.length,1);
  assert.match(result.coverage,/Partial coverage.*GDELT/);
  assert.equal(new URL(result.sourceURL).hostname,'api.gdeltproject.org');
});
