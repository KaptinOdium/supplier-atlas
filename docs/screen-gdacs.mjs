import {countryName} from './screen-matches.mjs';

const origin = 'https://www.gdacs.org';
export const gdacsSourceURL = origin + '/gdacsapi/api/events/geteventlist/events4app';
const day = 86400000;
const severity = {green: 1, orange: 2, red: 3};
const hazards = {EQ: 'Earthquake', FL: 'Flood', TC: 'Tropical cyclone', WF: 'Wildfire'};
const defaultFetch = (...args) => fetch(...args);
const feeds = new WeakMap();

function utc(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z?$/.test(value)) return NaN;
  return Date.parse(value.endsWith('Z') ? value : value + 'Z');
}
function episodeKey(p) {
  if (!Object.hasOwn(hazards, p?.eventtype) || !Number.isSafeInteger(p.eventid) || p.eventid <= 0 ||
      !Number.isSafeInteger(p.episodeid) || p.episodeid < 0) return '';
  return p.eventtype + '-' + p.eventid + '-' + p.episodeid;
}
function episodeParams(p) {
  return new URLSearchParams({eventtype: p.eventtype, eventid: p.eventid, episodeid: p.episodeid});
}
function recentEpisodes(data, now) {
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw Error('GDACS returned an unsupported feed.');
  const episodes = new Map();
  for (const row of data.features) {
    const p = row?.properties;
    const key = episodeKey(p);
    if (!key || row.geometry?.type !== 'Point' || String(p.iscurrent) !== 'true' || String(p.istemporary) === 'true') continue;
    const updated = utc(p.datemodified), end = utc(p.todate);
    if (!(updated >= now - 3 * day && updated <= now && end >= now - 3 * day && end <= now + 3 * day)) continue;
    const level = severity[String(p.episodealertlevel || p.alertlevel).toLowerCase()];
    if (!Number.isInteger(level) || (p.eventtype === 'EQ' && !(Number(p.severitydata?.severity) >= 5.5))) continue;
    const id = p.eventtype + '-' + p.eventid;
    if (!episodes.has(id) || episodes.get(id).updated < updated) episodes.set(id, {p, key, updated, level});
  }
  return [...episodes.values()].sort((a, b) => b.level - a.level || b.updated - a.updated);
}

function footprint(feature, now) {
  const p = feature?.properties, g = feature?.geometry;
  if (!p || !g || !['Polygon', 'MultiPolygon'].includes(g.type) || !Array.isArray(g.coordinates)) return [];
  const time = utc(p.polygondate);
  if (!(time >= now - 3 * day && time <= now + (p.eventtype === 'TC' ? day : 0))) return [];
  // Ignore centroids, country outlines, global extent, generic radius and track cones.
  const intensity = /^Poly_SMPInt_(\d+(?:\.\d+)?)$/.exec(p.Class || '');
  const qualifies = p.eventtype === 'FL' && p.Class === 'Poly_Affected' ||
    p.eventtype === 'WF' && p.Class === 'Poly_area' ||
    p.eventtype === 'EQ' && intensity && Number(intensity[1]) >= 6 ||
    p.eventtype === 'TC' && ['Poly_Orange', 'Poly_Red'].includes(p.Class);
  if (!qualifies) return [];
  const result = [];
  for (const rings of g.type === 'Polygon' ? [g.coordinates] : g.coordinates) {
    if (!Array.isArray(rings) || !rings.length) continue;
    let west = 180, east = -180, north = -90, south = 90;
    const valid = rings.every(ring => Array.isArray(ring) && ring.length >= 4 && ring.every(pt => {
      if (!Array.isArray(pt) || !Number.isFinite(pt[0]) || !Number.isFinite(pt[1]) ||
          Math.abs(pt[0]) > 180 || Math.abs(pt[1]) > 90) return false;
      west = Math.min(west, pt[0]); east = Math.max(east, pt[0]);
      south = Math.min(south, pt[1]); north = Math.max(north, pt[1]);
      return true;
    }) && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]);
    // Unsplit dateline rings wrap in planar coordinates; do not use them for a match.
    if (valid && east - west < 180) result.push({rings, west, east, south, north});
  }
  return result;
}
function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 1; i < ring.length; i++) {
    const [x, y] = ring[i], [x0, y0] = ring[i - 1];
    if ((y > lat) !== (y0 > lat) && lon < (x0 - x) * (lat - y) / (y0 - y) + x) inside = !inside;
  }
  return inside;
}
function contains(shape, lon, lat) {
  return lon >= shape.west && lon <= shape.east && lat >= shape.south && lat <= shape.north &&
    inRing(lon, lat, shape.rings[0]) && !shape.rings.slice(1).some(hole => inRing(lon, lat, hole));
}
export function matchGdacs(suppliers, data, {now = Date.now(), checkedAt = new Date(now).toISOString(), countryCode} = {}) {
  const episodes = recentEpisodes(data, now);
  const layers = new Map();
  for (const row of data.footprints || data.features) {
    const key = episodeKey(row?.properties);
    const polygons = key && footprint(row, now);
    if (!polygons?.length) continue;
    if (!layers.has(key)) layers.set(key, []);
    layers.get(key).push(...polygons);
  }
  const matches = [];
  let consideredCount = 0;
  for (const {p, key} of episodes) {
    const shapes = layers.get(key);
    if (!shapes) continue;
    consideredCount++;
    const countries = new Set((p.affectedcountries || []).flatMap(c => [c.countryname, c.iso2])
      .filter(Boolean).map(c => countryName(c, countryCode)));
    const level = p.episodealertlevel || p.alertlevel;
    const date = p.datemodified.slice(0, 10);
    for (const supplier of suppliers) {
      if (!Number.isFinite(supplier.lon) || !Number.isFinite(supplier.lat) ||
          !countries.has(countryName(supplier.country, countryCode)) ||
          !shapes.some(shape => contains(shape, supplier.lon, supplier.lat))) continue;
      const site = supplier.city || supplier.country;
      const approximate = supplier.precision === 'Approximate city';
      const basis = (approximate ? 'Approximate city centre' : 'Register coordinates') +
        ' inside a GDACS hazard footprint. Verify the operating site and local conditions.';
      const hazardEvidence = p.eventtype === 'TC' ? 'Modelled cyclone winds can include forecasts for the next 24 hours.'
        : p.eventtype === 'EQ' ? 'GDACS maps strong shaking here. Check official damage or access reports.' : 'GDACS maps an affected area here.';
      matches.push({supplier, kind: 'locality', decision: 'unreviewed', basis,
        reason: level + ' GDACS alert updated ' + date + '. ' + hazardEvidence +
          ' Verify local operational effects and current purchasing exposure.',
        event: {id: 'gdacs-' + p.eventtype + '-' + p.eventid, country: supplier.country, site, date, category: hazards[p.eventtype].toLowerCase(),
          title: hazards[p.eventtype] + ' · ' + site, lastChecked: checkedAt.slice(0, 10),
          sources: [{name: 'GDACS · ' + level + ' alert', url: origin + '/report.aspx?' + episodeParams(p)}]}});
    }
  }
  const recordCount = data.features.filter(f => f?.geometry?.type === 'Point').length;
  const requested = data.requested ?? episodes.length;
  const coverage = 'GDACS returned ' + recordCount + ' event records. ' + consideredCount +
    ' current episodes had a usable mapped footprint. Retrieved outlines for ' + (requested - (data.failed || 0)) + ' of ' + episodes.length +
    ' eligible episodes. ' +
    (data.failed ? data.failed + ' footprint requests failed. ' : '') +
    'Coverage is limited to the published sample and recent flood, wildfire, cyclone wind and strong shaking areas. City-centre overlaps require site verification.';
  return {matches, checkedAt, recordCount, consideredCount, coverage, sourceURL: gdacsSourceURL};
}
async function read(fetcher, url, deadline) {
  const timeout = AbortSignal.timeout(10000);
  const response = await fetcher(url, {method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer',
    cache: 'no-store', signal: deadline ? AbortSignal.any([timeout, deadline]) : timeout});
  if (!response.ok) throw Error('GDACS is unavailable.');
  const data = await response.json();
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw Error('GDACS returned an unsupported feed.');
  return data;
}
async function fetchPublicData(fetcher, now, previousShapes) {
  const data = await read(fetcher, gdacsSourceURL);
  const pending = recentEpisodes(data, now);
  const shapeCache = new Map();
  const footprints = [];
  const deadline = AbortSignal.timeout(30000);
  let cursor = 0, failed = 0;
  // Selection and requests are identical for every supplier register.
  async function readFootprints() {
    while (cursor < pending.length) {
      const {p, key, updated} = pending[cursor++];
      try {
        let features = previousShapes?.get(key)?.updated === updated ? previousShapes.get(key).features : null;
        if (!features) {
          if (deadline.aborted) { failed++; continue; }
          const shapes = await read(fetcher, origin + '/gdacsapi/api/polygons/getgeometry?' + episodeParams(p), deadline);
          features = shapes.features.filter(f => episodeKey(f?.properties) === key && ['Polygon', 'MultiPolygon'].includes(f.geometry?.type));
        }
        shapeCache.set(key, {updated, features});
        footprints.push(...features);
      } catch { failed++; }
    }
  }
  await Promise.all(Array.from({length: Math.min(4, pending.length)}, readFootprints));
  if (failed && failed === pending.length) throw Error('GDACS event list loaded, but all footprint requests failed.');
  return {data: {...data, footprints, requested: pending.length, failed}, shapeCache};
}
export async function loadGdacs(suppliers, {fetcher = defaultFetch, now = Date.now(), countryCode, force = false} = {}) {
  if (!feeds.has(fetcher)) feeds.set(fetcher, {});
  const cache = feeds.get(fetcher);
  if (!cache.pending && (force || !cache.data || now < cache.time || now - cache.time >= 300000)) {
    cache.pending = fetchPublicData(fetcher, now, cache.shapeCache).then(result => { Object.assign(cache, result); cache.time = now; })
      .finally(() => { cache.pending = null; });
  }
  if (cache.pending) await cache.pending;
  return matchGdacs(suppliers, cache.data, {now, countryCode, checkedAt: new Date(cache.time).toISOString()});
}
