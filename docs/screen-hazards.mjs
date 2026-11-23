import {countryName, entityName, words} from './screen-matches.mjs';

export const hazardSourceURL = 'https://globalincidenttracker.com/api/incidents.php?format=list&days=1';
const day = 86400000;
const defaultFetch = (...args) => fetch(...args);
const feeds = new WeakMap();
const physicalHazards = new Set([
  'earthquake', 'flood', 'storm', 'hurricane', 'cyclone', 'tornado', 'wildfire', 'fire', 'gas-leak',
  'chemical-spill', 'industrial-accident', 'power-outage', 'landslide', 'explosion', 'mining-accident',
  'building-collapse', 'bridge-collapse', 'volcano', 'tsunami', 'maritime-accident', 'train-accident',
  'maritime', 'mine-accident', 'rail-accident', 'road-accident', 'air-crash', 'cyber-attack',
]);
const transportTypes = new Set(['maritime','maritime-accident','rail-accident','train-accident','road-accident','air-crash']);
const freightImpact = /\b(?:freight|cargo|port|terminal|railway|railroad|rail line|highway|motorway|airport|shipping lane|bridge|delivery route)\b/i;
const interruption = /\b(?:clos(?:ed|ures?)|block(?:ed|age)|suspend\w*|halt\w*|disrupt\w*|shut\w*|shut down|outages?|interrupt\w*|delay\w*|cancel\w*)\b/i;
const cyberOperations = /\b(?:systems?|operations?|production|deliveries|shipping|orders?|network|services?)\b/i;
const warningProviders = new Set(['meteoalarm', 'nws', 'caphub', 'glofas']);
const reportedImpact = /\b(?:damage[d]?|destroyed|injured|closed|closure|power outage|evacuat\w*|tsunami warning)\b/i;
const usesSite = /\b(?:plant|factory|warehouse|facility|terminal|mine|production|operations|manufacturing|evacuat\w*|damage[d]?|shutdown|interrupted|suspend\w*|halt\w*)\b/i;

function sourceLink(value) {
  try {
    const url = new URL(value);
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) return url;
  } catch {}
  return null;
}
function occurredAt(value) {
  // The publisher's list endpoint uses UTC without an explicit zone.
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:Z)?$/.test(value)) return NaN;
  return Date.parse(value.replace(' ', 'T').replace(/Z?$/, 'Z'));
}
const usStateNames = new Set(('Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming').toLowerCase().split('|'));

function localities(title, warning, country) {
  const dash = title.match(/\s[—–]\s(.+)$/u);
  const trailing = title.match(/\b(?:in|at|near) ([\p{L}\p{M}][\p{L}\p{M}'’ .-]*)(?=$|[,;|])/iu);
  const part = dash?.[1] || trailing?.[1] || '';
  // Czech warnings put the named warning areas inside parentheses after
  // the region. The publisher occasionally truncates long lists mid-name.
  const czechAreas = warning && /^(?:czechia|czech republic)$/u.test(countryName(country)) &&
    part.match(/^.+?\bkraj\s*\(([^)]*)(\))?$/iu);
  const area = czechAreas ? czechAreas[1] : part;
  const parts = warning ? area.split(/[,;/]/u) : [area.split(/[,;]/u)[0]];
  if (czechAreas && !czechAreas[2]) parts.pop();
  return new Set(parts.map((part, index) => {
    const name = words(part.replace(/\s*\(Stadt\)$/iu, ''));
    if (index > 0 && countryName(country) === 'united states' && usStateNames.has(name)) return '';
    return name;
  }).filter(name => name.length > 2 && !/\b(?:county|district|province|region|nationwide|state|coast|offshore|near|kraj)\b/.test(name)));
}
function scopeOf(row, now) {
  if (!physicalHazards.has(row.type) || typeof row.title !== 'string' || !row.country || row.id == null) return null;
  const time = occurredAt(row.occurred_at);
  const warning = warningProviders.has(row.source) || /\b(?:forecast|warning|outlook|watch)\b/i.test(row.title);
  if (!Number.isFinite(time) || time < now - day || time > now + (warning ? day : 0)) return null;
  if (row.type === 'earthquake' && !reportedImpact.test(row.title)) return null;
  if (transportTypes.has(row.type) && !(freightImpact.test(row.title) && interruption.test(row.title))) return null;
  if (row.type === 'cyber-attack' && !(cyberOperations.test(row.title) && interruption.test(row.title))) return null;
  if (row.type === 'mine-accident' && !/\b(?:mine|mining|colliery)\b/i.test(row.title)) return null;
  const link = sourceLink(row.permalink);
  if (link?.origin !== 'https://globalincidenttracker.com' || !link.pathname.startsWith('/incident/')) return null;
  return {time, warning, link, cities: localities(row.title, warning, row.country)};
}

async function publicFeed(fetcher, now, force) {
  if (!feeds.has(fetcher)) feeds.set(fetcher, {});
  const cache = feeds.get(fetcher);
  if (cache.pending) return cache.pending;
  if (!force && cache.latest && now >= cache.latest.time && now - cache.latest.time < 300000) return cache.latest;
  cache.pending = (async () => {
    const response = await fetcher(hazardSourceURL, {
      method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw Error('Global Incident Tracker is unavailable.');
    const data = await response.json();
    if (!Array.isArray(data?.incidents) || !Number.isSafeInteger(data.count) || data.count < data.incidents.length) {
      throw Error('Global Incident Tracker returned an unsupported feed.');
    }
    cache.latest = {data, time: now};
    return cache.latest;
  })();
  try { return await cache.pending; }
  finally { cache.pending = null; }
}

export async function loadHazardLeads(suppliers, {fetcher = defaultFetch, now = Date.now(), countryCode, force = false} = {}) {
  const {data, time} = await publicFeed(fetcher, now, force);
  const checkedAt = new Date(time).toISOString();
  const byCountry = new Map();
  for (const supplier of suppliers) {
    const country = countryName(supplier.country, countryCode);
    if (!country) continue;
    const name = entityName(supplier.name);
    const city = words(String(supplier.city ?? '').split(',')[0]);
    if (!byCountry.has(country)) byCountry.set(country, []);
    byCountry.get(country).push({supplier, name, city});
  }

  const matches = [];
  const ids = new Set();
  let consideredCount = 0;
  for (const row of data.incidents) {
    if (!row || ids.has(row.id)) continue;
    const scope = scopeOf(row, now);
    if (!scope) continue;
    ids.add(row.id);
    consideredCount++;
    const country = countryName(row.country, countryCode);
    const headline = ' ' + words(row.title) + ' ';
    const original = sourceLink(row.url);
    const sources = [{name: 'Global Incident Tracker (CC BY 4.0)', url: scope.link.href}];
    if (original && original.origin !== scope.link.origin) sources.push({name: String(row.source || original.hostname), url: original.href});
    const occurred = new Date(scope.time).toISOString();
    const date = occurred.slice(0,10);
    const event = {
      id: 'git-' + String(row.id), country: row.country, date,
      category: transportTypes.has(row.type) ? 'logistics' : row.type === 'cyber-attack' ? 'cyber' : row.type,
      title: String(row.type_label || row.type) + (scope.warning ? ' warning' : ' report'),
      sources, lastChecked: checkedAt.slice(0,10)
    };
    const reason = (scope.warning ? 'Forecast for a warning area. A district can share the city name. Verify the warning boundaries and site or freight impact.' : 'Tracker report; verify facility, access or freight disruption with an operator or authority.') +
      ' Tracker severity: ' + String(row.severity_label || 'unspecified') + '. Reported event time: ' + occurred.slice(0,16).replace('T',' ') + ' UTC.';
    for (const {supplier, city, name} of byCountry.get(country) || []) {
      const locality = row.type !== 'cyber-attack' && !!city && city !== country && scope.cities.has(city);
      // Require a full multiword company name in a headline about a facility
      // or operations; avoid brand-name fragments and incidental street names.
      const company = !scope.warning && name.length >= 6 && name.includes(' ') && name !== city &&
        (usesSite.test(row.title) || row.type === 'cyber-attack' || transportTypes.has(row.type)) && headline.includes(' ' + name + ' ');
      if (!locality && !company) continue;
      const kind = company ? (locality ? 'company-city' : 'company-only') : 'locality';
      const basis = company ? (locality ? 'Company and locality named; confirm the facility' : 'Company named in headline; confirm the facility')
        : scope.warning ? 'Warning area shares the supplier city name; its boundaries may cover only part of the district'
        : 'Reported locality shares the supplier city name; verify facility, access or freight impact';
      const location = locality ? String(supplier.city).split(',')[0].trim() : row.country;
      const title = scope.warning ? event.title + ' · ' + location + ' · ' + occurred.slice(11,16) + ' UTC' : row.title.slice(0,300);
      matches.push({supplier, event: {...event, title, site: location}, decision: 'unreviewed', reason, basis, kind});
    }
  }
  const recordCount = data.incidents.length;
  const reportedTimes = data.incidents.map(row => occurredAt(row?.occurred_at)).filter(Number.isFinite);
  const hasRecent = reportedTimes.some(t => t >= now - day && t <= now);
  const coverage = 'Global Incident Tracker returned ' + recordCount + ' records from its one-day list. ' +
    consideredCount + ' distinct reports qualified for locality or company comparison. ' +
    (data.count > recordCount || recordCount >= 800 ? 'Coverage is partial; this check covers only the returned sample. ' : 'The returned sample can omit events. ') +
    (!hasRecent ? 'No returned records carry event times in the last 24 hours. ' : '') +
    'Reports use a 24-hour lookback and warnings a further 24-hour outlook. ' +
    'Coverage depends on reported places, names and available upstream sources.';
  return {matches, checkedAt, recordCount, consideredCount, coverage, sourceURL: hazardSourceURL};
}
