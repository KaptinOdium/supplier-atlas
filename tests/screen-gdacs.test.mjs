import assert from 'node:assert/strict';
import test from 'node:test';
import {gdacsSourceURL, loadGdacs, matchGdacs} from '../docs/screen-gdacs.mjs';

const now = Date.parse('2026-11-18T10:00:00Z');
const date = '2026-11-17T21:00:00';
const event = {eventtype: 'FL', eventid: 1104253, episodeid: 6, iscurrent: 'true', istemporary: 'false',
  alertlevel: 'Green', episodealertlevel: 'Green', datemodified: date, todate: date,
  affectedcountries: [{iso2: 'ID', countryname: 'Indonesia'}]};
const supplier = {name: 'Example Components', country: 'Indonesia', city: 'Test city',
  lon: 106.5, lat: -6.5, precision: 'Approximate city'};
const outer = [[106,-7],[107,-7],[107,-6],[106,-6],[106,-7]];
const hole = [[106.6,-6.4],[106.8,-6.4],[106.8,-6.2],[106.6,-6.2],[106.6,-6.4]];
const feature = (properties, geometry) => ({type: 'Feature', properties, geometry});
const record = p => feature({...event, ...p}, {type: 'Point', coordinates: [106.5,-6.5]});
const shape = (p = {}, geometry = {type:'Polygon',coordinates:[outer,hole]}) =>
  feature({...event, Class:'Poly_Affected', polygondate:date, ...p}, geometry);
const collection = features => ({type: 'FeatureCollection', features});
const response = data => ({ok:true, json:async () => data});

test('requires an actual mapped polygon and correct country, and preserves city-centre uncertainty', () => {
  const suppliers = [supplier, {...supplier,country:'Malaysia'}, {...supplier,lon:108},
    {...supplier,lon:106.7,lat:-6.3}, {...supplier,lon:null,lat:null}];
  const checked = matchGdacs(suppliers, collection([record(),shape()]), {now});
  assert.deepEqual(checked.matches.map(x => [x.supplier,x.decision]), [[supplier,'unreviewed']]);
  assert.match(checked.matches[0].basis, /Approximate city centre/);
  assert.equal(checked.matches[0].event.sources[0].url,
    'https://www.gdacs.org/report.aspx?eventtype=FL&eventid=1104253&episodeid=6');
  assert.equal(matchGdacs(suppliers,collection([record()]),{now}).matches.length,0);
});
test('rejects stale episodes, inactive and temporary alerts, outdated footprints and unrelated geometries', () => {
  for (const p of [{datemodified:'2026-01-01T00:00:00'}, {todate:'2026-01-01T00:00:00'},
    {iscurrent:false}, {istemporary:true}, {episodealertlevel:'unknown'}, {datemodified:'2026-12-01T00:00:00'}]) {
    assert.deepEqual(matchGdacs([supplier],collection([record(p),shape()]),{now}).matches,[]);
  }
  for (const props of [{polygondate:'2026-10-30T01:00:00'},{Class:'Poly_Global'},{Class:'Poly_Cones'},
    {Class:'Point_Centroid'},{episodeid:7},{polygondate:'2026-11-20T00:00:00'}]) {
    assert.deepEqual(matchGdacs([supplier],collection([record(),shape(props)]),{now}).matches,[]);
  }
  const dateLine = [[[179,4],[-179,4],[-179,-7],[179,-7],[179,4]]];
  assert.deepEqual(matchGdacs([supplier],collection([record(),shape({}, {type:'Polygon',coordinates:dateLine})]),{now}).matches,[]);
});
test('matches only strong shaking and refuses generic earthquake circles and under-threshold earthquakes', () => {
  const p = {eventtype:'EQ',severitydata:{severity:6.2}};
  const data = level => collection([record(p),shape({...p,Class:level},{type:'MultiPolygon',coordinates:[[outer]]})]);
  assert.equal(matchGdacs([supplier], data('Poly_SMPInt_6.5'), {now}).matches.length,1);
  assert.equal(matchGdacs([supplier], data('Poly_SMPInt_4.5'), {now}).matches.length,0);
  assert.equal(matchGdacs([supplier], data('Poly_Circle'), {now}).matches.length,0);
  const small = {...p, severitydata:{severity:4.5}};
  assert.equal(matchGdacs([supplier],collection([record(small),shape({...small,Class:'Poly_SMPInt_6.5'})]),{now}).matches.length,0);
});
test('independently fetches only official public endpoints, coalesces concurrent reads and attributes retrieval time', async () => {
  const urls = [];
  const fetcher = async (url, options) => {
    urls.push(url);
    assert.equal(options.credentials,'omit'); assert.equal(options.referrerPolicy,'no-referrer');
    assert.equal(options.body,undefined);
    return response(collection(url === gdacsSourceURL ? [record({url:{geometry:'https://external.invalid/trap'}})] : [shape()]));
  };
  const [first,empty] = await Promise.all([loadGdacs([supplier],{fetcher,now}),loadGdacs([],{fetcher,now})]);
  assert.deepEqual(urls, [gdacsSourceURL,
    'https://www.gdacs.org/gdacsapi/api/polygons/getgeometry?eventtype=FL&eventid=1104253&episodeid=6']);
  assert.equal(first.matches.length,1); assert.equal(empty.matches.length,0);
  assert.equal((await loadGdacs([], {fetcher,now:now+1000})).checkedAt,first.checkedAt);
  await loadGdacs([], {fetcher,now:now+1000,force:true});
  assert.deepEqual(urls.slice(2),[gdacsSourceURL]);
});
test('reads all eligible public outlines even for a large returned sample', async () => {
  const records = Array.from({length:25},(_,i)=>record({eventid:i+1}));
  let requests = 0;
  const fetcher = async url => {
    if (url===gdacsSourceURL) return response(collection(records));
    requests++;
    return response(collection([shape({eventid:Number(new URL(url).searchParams.get('eventid'))})]));
  };
  const results = await loadGdacs([supplier], {fetcher,now});
  assert.equal(requests,25); assert.equal(results.matches.length,25);
  assert.match(results.coverage,/25 of 25 eligible/);
});
test('distinguishes feed or footprint failure from successful empty coverage and describes partial reads', async () => {
  await assert.rejects(loadGdacs([], {fetcher:async()=>response({}),now}), /unsupported/);
  await assert.rejects(loadGdacs([], {fetcher:async url=>url===gdacsSourceURL ?
    response(collection([record()])) : {ok:false},now}), /all footprint requests failed/);
  const empty = await loadGdacs([], {fetcher:async()=>response(collection([])),now});
  assert.equal(empty.recordCount,0);
  const fetcher = async url => {
    if (url===gdacsSourceURL) return response(collection([record(),record({eventid:1104254})]));
    if (url.includes('1104254')) return {ok:false};
    return response(collection([shape()]));
  };
  const partial = await loadGdacs([supplier], {fetcher,now});
  assert.equal(partial.matches.length,1); assert.match(partial.coverage,/1 footprint requests failed/);
});
