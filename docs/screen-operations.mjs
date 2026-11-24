import {countryName, entityName, words} from './screen-matches.mjs';
import {reportTimestamp} from './risk-view.mjs?v=20261124-1';

export const operationalSourceURL = 'https://raw.githubusercontent.com/KaptinOdium/supplier-atlas/main/docs/data/operational-risks.json';
const localSnapshot = './data/operational-risks.json';
const hour = 3600000;
const maxAge = 72 * hour;
const categories = new Set(['production','labor','logistics','cyber','quality','financial']);
const evidence = {
  production: /\b(?:fire|explosion|outage|shortage|shutdown|shut down|shuts|closed?|closes|closure|evacuat\w*|suspend\w*|halt\w*|pause[sd]?|interrupt\w*|stoppage|force majeure|idles?|idle[d]?|layoffs?|job cuts|cut[s]? production)\b/,
  labor: /\b(?:strik(?:e|es|ing)|walkouts?|walks? out|stoppages?|lockouts?|industrial action|work stoppage)\b/,
  logistics: /\b(?:block(?:ed|ade|age)?|interrupt\w*|congestion|outage|closed?|closes|closure|disrupt\w*|shut\w*|cancel\w*|suspend\w*|delay\w*|halt\w*|derail\w*|grounded|restrictions?|force majeure)\b/,
  cyber: /\b(?:ransomware|cyber ?attacks?|cyber incident|security incident|data breach|data theft|cybersecurity incident|systems? outage|cyber disruption|hacked)\b/,
  quality: /\b(?:recalls?|recalling|recalled|stop sale|stop ship|quality hold|safety defects?|contaminat\w*|defective|stop use|withdraws?|withdrawal)\b/,
  financial: /\b(?:insolven\w*|bankrupt\w*|chapter (?:11|7)|liquidat\w*|receivership|enters administration|appointment of (?:joint )?administrators?|administrators? appointed|file[ds]? for (?:administration|creditor protection)|ceases? (?:operations|trading)|winding up)\b/
};
const facility = /\b(?:plant|factory|warehouse|facility|facilities|mill|mine|refinery|operations?|supply|production|manufactur\w*|deliver\w*|output|assembly|industrial|power|workforce|workers?)\b/;
const transport = /\b(?:freight|cargo|ports?|terminal|canal|rail\w*|shipping|shipments?|container|logistics|pipelines?|ferr(?:y|ies)|bridge|motorway|border crossing|airport|highway|road|trucking|vessel|flights?)\b/;
const stopped = /\b(?:resumes?|resumed|reopens?|reopened|restored|back to normal|returns? to normal|outage ends?|strike (?:ends?|averted|called off)|(?:cancelled|suspended|averted|calls? off|ends?) (?:the )?(?:planned )?(?:strike|walkout)|no (?:longer|operational impact|disruption)|false alarm|emerges? from (?:bankruptcy|administration)|ends? (?:the |its )?(?:strike|stoppage|blockade)|no plans to (?:close|shut)|rules? out (?:a )?(?:shutdown|strike)|recall lifted)\b/;
const commentary = /\b(?:simulation|simulated|drill|anniversary|commemorat\w*|memoriali[sz]\w*|centur(?:y|ies) (?:ago|later)|case study|lessons learned|years? ago|last year|last month|what if|how to|step by step|exploit code|proof of concept|tutorial|market forecast|stock price|stock market|share price|typical victim)\b/;
const speculative = /\b(?:could|might|may|would) (?:have|cause|bring|prompt|spark|lead|force|face|trigger|close|shut|disrupt|halt|strike|recall|knock out)|\b(?:strike threat|threat of (?:a )?(?:strike|outage|closure)|risk of bankruptcy|possible strike|prepare for .*attack|averting strike|lifts? (?:a |the )?ground stop|remain operational|report for work .*despite lockout)\b/;
const marketing = /\b(?:introduc\w*|launch\w*|unveil\w*|showcas\w*|demonstrat\w*|promot\w*)\b.*\b(?:platform|solution|toolkit|framework|webinar|product line|software|campaign)\b/;
const cyberService = /\b(?:systems?|services?|operations?|production|shipments?|freight|deliveries|flights?|factories|factory|manufacturing|plants?|orders?|portals?|supplies|network|payment processing)\b/;
const cyberDisruption = /\b(?:outage|halt\w*|disrupted?|disrupts?|disruption|down|offline|suspend\w*|unavailable|interrupt\w*|paraly[sz]\w*|closed|delays?|delayed|cancelled|disabled)\b/;
const ordinary = new Set(('the and of co company group global international national industrial industries industry systems system service services technology technologies transport logistics engineering automotive components parts auto motor motors steel electric electronics metal works production manufacturing manufacturer suppliers supplier port rail power united general union plant factory new south north east west central first holdings operations city').split(' '));
const trailingUnits = / (?:automotive|components|logistics|group|technologies|technology|industrial|international|manufacturing|systems|holdings|parts|electronics|supply|solutions)$/;
const directAfter = /^(?:s |at |of )?(?:plant|factory|facility|workers?|employees?|unit|warehouse|mill|operations|site|terminal|supplier portal|files?|filed|enters?|entered|ceases?|halts?|pauses?|suspends?|forced|reports?|reveals?|confirms?|warns?|issues?|recalls?|shuts?|stops?|closes?|hit|faces?|facing|suffers?|suffered|falls?|goes?|affected|struck|discloses?|announces?|declares?|is|was|has|will|to|industrial action|strike|ransomware|cyberattack|data breach|outage|bankrupt\w*|shutdown|walkout|recall|fire|explosion)\b/;
const namedObject = /(?:\b(?:hits?|strikes?|affects?|targets?|at|against|disrupts?)|(?:workers|employees) (?:of|at)|(?:cyberattack|ransomware attack|breach) (?:hits|on|at)) $/;
const association = /^(?:(?:s|owned|affiliated) )?(?:suppliers?|vendors?|clients?|contractors?|customers?|rivals?|partners?|ransomware gang|ransomware group)\b/;
const titleLegalForms = /^(?:(?:gmbh(?: and co kg)?|s a s|s p a|s r o|co ltd|plc|llc|limited|incorporated|ltd|corp|inc|ag|sas|sa|bv|nv) )+/;
const shortNumber = '(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|half)';
const durationFirst = new RegExp('\\b'+shortNumber+' (?:hours?|hrs?) (?:long )?(?:(?:rail|dock|port|factory|warning) )?(?:strike|walkout|stoppage)\\b');
const durationLast = new RegExp('\\b(?:strike|walkout|stoppage) (?:for |lasting |of )?'+shortNumber+' (?:hours?|hrs?)\\b');

function safeURL(value, allowHTTP=false) {
  try {
    const url = new URL(value);
    if ((url.protocol === 'https:' || allowHTTP && url.protocol==='http:') && !url.username && !url.password) return url.href;
  } catch {}
  return '';
}
function recent(value, now, age=maxAge) {
  const time = typeof value === 'string' && Date.parse(value);
  return Number.isFinite(time) && time <= now && time >= now-age;
}
function usableTitle(title, category) {
  const normalized = words(title);
  if (title.includes('?') || commentary.test(normalized) || speculative.test(normalized) || marketing.test(normalized) ||
      stopped.test(normalized) || !evidence[category].test(normalized)) return false;
  if (category === 'production' && !facility.test(normalized)) return false;
  if (category === 'logistics' && !transport.test(normalized)) return false;
  if (category === 'labor') {
    if (/\b(?:vote[sd]?|ballot|threatens?|averts?|considering|strike price|missile strike|air ?strike|student workers)\b/.test(normalized)) return false;
    const duration = normalized.match(durationFirst) || normalized.match(durationLast);
    if (duration && !(Number(duration[1]) >= 24) && !/\b(?:production halted|halts production|shipments cancelled|deliveries suspended)\b/.test(normalized)) return false;
  }
  return true;
}
function legalName(value) {
  return entityName(value).replace(/^the /,'').replace(/ (?:co|s de rl de cv|sp z o o|pvt|pty|kft|s l u|gmbh u co kg)$/, '');
}
function isDistinct(name) {
  return name.length >= 3 && name.split(' ').some(part => part.length >= 3 && !ordinary.has(part));
}
function baseName(name, city, country, countryCode) {
  let base = city && name.endsWith(' '+city) ? name.slice(0,-city.length-1) : name;
  const parts = base.split(' ');
  for (let length=Math.min(3,parts.length-1);length>0;length--) {
    if (countryName(parts.slice(-length).join(' '),countryCode) === country) {
      base=parts.slice(0,-length).join(' ');
      break;
    }
  }
  while (trailingUnits.test(base)) base = base.replace(trailingUnits,'');
  return base !== name && isDistinct(base) ? base : '';
}
function supplierIndex(suppliers, countryCode) {
  const byToken = new Map(), byCity = new Map();
  for (const supplier of suppliers) {
    const name = legalName(supplier.name), country = countryName(supplier.country,countryCode);
    if (!name || !country) continue;
    const city = words(String(supplier.city || '').split(',')[0]);
    const entry = {supplier, name, city, country, alias:baseName(name,city,country,countryCode)};
    const token = name.split(' ')[0];
    if (!byToken.has(token)) byToken.set(token,[]);
    byToken.get(token).push(entry);
    if (city) {
      const key = country+'|'+city;
      if (!byCity.has(key)) byCity.set(key,[]);
      byCity.get(key).push(entry);
    }
  }
  return {byToken,byCity};
}

function affectedMention(text,name) {
  if (!name) return false;
  const index = text.indexOf(' '+name+' ');
  if (index < 0) return false;
  const after = text.slice(index+name.length+2).replace(titleLegalForms,'');
  if (association.test(after)) return false;
  return directAfter.test(after) || namedObject.test(text.slice(0,index+1));
}
function cityAtSite(text, city) {
  if (!city) return false;
  const literal = city.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return new RegExp('(?:^|\\b(?:in|near|at|outside|port of) )'+literal+'(?:$| (?:plant|factory|port|terminal|facility|site|after|following|during|amid|over|as|on|until|due|for)\\b)').test(text.trim());
}
function candidates(item, index, countryCode) {
  const title = ' '+words(item.title)+' ';
  // A headline naming a victim can prompt research. Supplier flags need a
  // reported operational effect, such as interrupted production or deliveries.
  const claim = item.category==='cyber' && item.confirmation==='unverified claim' && item.entities.length>0;
  if (item.category==='cyber' && !claim && !(cyberService.test(title) && cyberDisruption.test(title))) return [];
  const country = item.country ? countryName(item.country,countryCode) : '';
  const city = words(item.locality);
  const entities = new Set(item.entities.map(legalName).filter(Boolean));
  const names = entities.size ? [...entities].join(' ') : title;
  const considered = new Set();
  for (const token of new Set(names.trim().split(' '))) {
    for (const entry of index.byToken.get(token) || []) considered.add(entry);
  }
  const siteSpecific = ['production','labor','logistics'].includes(item.category) && (facility.test(title) || transport.test(title));
  const locations = siteSpecific ? title.split(/\b(?:at|in|near|outside) /).slice(1)
    .filter(part => !/^(?:a|an|its|their|several|two|three|multiple|response|protest|support|talks|production|operations|the (?:plant|site|factory|facility|warehouse))\b/.test(part)) : [];
  const matches = new Map();
  for (const entry of considered) {
    const {country:registeredCountry, city:registeredCity, name, alias} = entry;
    if (country && registeredCountry !== country || city && registeredCity !== city) continue;
    const sameCity = !!registeredCity && (city === registeredCity || cityAtSite(title,registeredCity));
    const exact = entities.size ? entities.has(name) : isDistinct(name) && affectedMention(title,name);
    const shortened = !claim && !exact && sameCity && alias && (entities.size ? entities.has(alias) : affectedMention(title,alias));
    if (!exact && !shortened) continue;
    // "At <company>" identifies an employer; "at <city> plant" identifies a branch.
    const otherLocation = locations.some(part => !part.startsWith(name+' ') && !(alias && part.startsWith(alias+' ')));
    if (!sameCity && (otherLocation || !isDistinct(name) || !entities.size && !name.includes(' ') && name.length < 5)) continue;
    matches.set(entry, {kind:sameCity ? 'company-city' : 'company-only', basis:shortened ?
      'Shortened company name and locality agree. Verify the legal entity and affected site.' :
      sameCity ? 'Company name and locality agree. Verify operating-site impact.' :
      'Company name appears in the report. Verify the legal entity, operating site and buyer exposure.'});
  }
  // A specifically reported transport closure can affect freight locally. A
  // country, a publisher's headquarters or a headline city alone is insufficient.
  if (item.category === 'logistics' && country && city && /\b(?:closed|closure|suspended|blocked|blockade|shut|halted)\b/.test(title)) {
    for (const entry of index.byCity.get(country+'|'+city) || []) {
      if (!matches.has(entry)) matches.set(entry, {kind:'locality',basis:'A transport disruption is reported in the supplier city. Check whether this site uses the affected route.'});
    }
  }
  return matches;
}
function validFeed(data, now) {
  return data?.version === 1 && recent(data.generatedAt,now) && Array.isArray(data.coverage) && Array.isArray(data.reports);
}
function sourceStatuses(data,now) {
  return data.coverage.filter(s => s && typeof s.id === 'string' && typeof s.name === 'string' &&
    ['ok','unavailable'].includes(s.status) && Number.isFinite(Date.parse(s.checkedAt)) && safeURL(s.url))
    .map(s => ({id:s.id,name:s.name,url:safeURL(s.url),status:recent(s.checkedAt,now) ? s.status : 'unavailable',checkedAt:s.checkedAt,
      received:Number.isSafeInteger(s.received) ? s.received : 0,retained:Number.isSafeInteger(s.retained) ? s.retained : 0}));
}
export function matchOperationalReports(suppliers, reports, {checkedAt, now=Date.now(), countryCode, agent=false}) {
  const index = supplierIndex(suppliers,countryCode);
  const matches = [], items = [], ids = new Set(), links = new Set(), titles = new Set();
  const today=new Date(now).toISOString().slice(0,10);
  for (const report of reports) {
    const regional = agent && report?.category === 'regional';
    if (!report || typeof report.id !== 'string' || !report.id || typeof report.title !== 'string' ||
        (!regional && !categories.has(report.category)) || typeof report.publisher !== 'string' || !report.publisher.trim()) continue;
    const firstSeen = report.dateBasis === 'first-seen';
    const dateField = firstSeen ? 'seenAt' : agent && report.dateBasis === 'updated' ? 'updatedAt' :
      agent && report.dateBasis === 'event-time' ? 'occurredAt' : 'publishedAt';
    const time = report[dateField];
    const reportTime = dateField === 'publishedAt' ? {publishedAt:time} : {dateBasis:report.dateBasis,[dateField]:time};
    const url = safeURL(report.url,agent);
    const titleKey = words(report.title);
    const endDay=typeof report.eventEnd==='string' ? report.eventEnd.slice(0,10) : '';
    const currentStrike=agent && report.category==='labor' && ['announced','ongoing'].includes(report.eventStatus) &&
      recent(checkedAt,now) && (!endDay || endDay>=today);
    if ((agent && endDay && endDay<today) ||
        !recent(time,now,currentStrike ? 7*24*hour : maxAge) || !url || !titleKey || ids.has(report.id) || links.has(url) || titles.has(titleKey)) continue;
    const eligible = regional || usableTitle(report.title,report.category);
    if (!eligible && !agent) continue;
    const category = !regional ? report.category : report.hazardType==='power-outage' ? 'production' :
      /storm|cyclone|tornado|flood|hurricane|wind|weather/i.test(report.hazardType || '') ? 'weather' : 'natural';
    const item = {id:report.id,title:report.title,url,publisher:report.publisher,category,
      ...reportTime,
      entities:Array.isArray(report.entities) ? report.entities.filter(x=>typeof x==='string' && x.trim()) : [],
      country:typeof report.country==='string' ? report.country : '',locality:typeof report.locality==='string' ? report.locality : ''};
    if (agent) {
      for (const key of ['summary','confirmation','eventStart','eventEnd','eventStatus','severity','hazardType'])
        if (typeof report[key]==='string' && report[key]) item[key]=report[key];
      if (Number.isFinite(report.magnitude)) item.magnitude=report.magnitude;
      const cited = new Set();
      item.evidence=[];
      for (const ref of Array.isArray(report.evidence) ? report.evidence : []) {
        const href=safeURL(ref?.url,true);
        if (!href || cited.has(href) || typeof ref.name !== 'string') continue;
        item.evidence.push({name:ref.name,url:href,date:typeof ref.date==='string'?ref.date:'',
          dateBasis:['first-seen','event-time','updated','published'].includes(ref.dateBasis)?ref.dateBasis:''});
        cited.add(href);
      }
    }
    ids.add(item.id);links.add(url);titles.add(titleKey);items.push(item);
    if (!eligible) continue;
    const date = new Date(time).toISOString().slice(0,10);
    const source = {name:item.publisher,url,...reportTime};
    if (dateField === 'publishedAt') source.published=date;
    else source.role=({seenAt:'First seen ',updatedAt:'Updated ',occurredAt:'Event time '})[dateField]+date;
    const event = {id:'ops-'+item.id, title:item.title, category:item.category, country:item.country, site:item.locality,
      ...(agent ? {summary:item.summary,confirmation:item.confirmation} : {}),
      date, lastChecked:checkedAt.slice(0,10), ...reportTime,
      sources:[source]};
    for (const extra of item.evidence || []) if(extra.url!==url) event.sources.push(extra);
    const reason = 'Check current operational impact with the operator before a buyer alert.' +
      (firstSeen ? ' The report date shows when the source first recorded the article.' : '') +
      (item.category === 'labor' ? ' Verify a continuous 24-hour stoppage or documented material disruption.' : '');
    if (regional) {
      const city = words(item.locality), country = countryName(item.country,countryCode);
      if (city && country && city !== country) {
        for (const {supplier} of index.byCity.get(country+'|'+city) || []) matches.push({supplier,event,decision:'unreviewed',
          kind:'locality',basis:'The reported locality and country match the supplier register. Verify the affected area and operating site.',reason,namedSite:false});
      }
      continue;
    }
    for (const [entry,match] of candidates(item,index,countryCode)) {
      matches.push({...match, supplier:entry.supplier,event,decision:'watch',reason,namedSite:false});
    }
  }
  items.sort((a,b) => Date.parse(reportTimestamp(b))-Date.parse(reportTimestamp(a)));
  return {matches,items};
}
export function matchOperationalLeads(suppliers, data, {now=Date.now(), countryCode}={}) {
  if (!validFeed(data,now)) throw Error('The operational news feed is unavailable or older than three days.');
  const sources = sourceStatuses(data,now);
  if (!sources.some(s=>s.status==='ok')) throw Error('Operational news sources are unavailable.');
  const {matches,items} = matchOperationalReports(suppliers,data.reports,{checkedAt:data.generatedAt,now,countryCode});
  const healthy = sources.filter(s=>s.status==='ok').length;
  const age = now-Date.parse(data.generatedAt);
  const coverage = healthy+' of '+sources.length+' operational news feeds checked. '+items.length+' recent reports eligible for review.'+
    (healthy<sources.length ? ' Partial coverage; some news sources are unavailable.' : '') +
    (data.liveFallback ? ' Partial coverage: live GDELT discovery was used because the scheduled source snapshot was unavailable or stale.' : '')+
    (age>24*hour ? ' Snapshot is over 24 hours old.' : '')+' Headline matches require source verification.';
  const sourceURL = data.liveFallback ? sources[0].url : operationalSourceURL;
  return {matches,items,sources,checkedAt:data.generatedAt,recordCount:data.reports.length,consideredCount:items.length,coverage,sourceURL};
}
const defaultFetch = (...args) => fetch(...args);
const feeds = new WeakMap();
async function readSnapshot(fetcher, now) {
  const options = {credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',signal:AbortSignal.timeout(10000)};
  const candidates = await Promise.allSettled([operationalSourceURL,localSnapshot].map(async url => {
    const response = await fetcher(url,options);
    if (!response.ok) throw Error('News snapshot request failed.');
    const data = await response.json();
    if (!validFeed(data,now) || !sourceStatuses(data,now).some(s=>s.status==='ok')) throw Error('No current news coverage.');
    return data;
  }));
  const available = candidates.filter(r=>r.status==='fulfilled').map(r=>r.value)
    .sort((a,b)=>Date.parse(b.generatedAt)-Date.parse(a.generatedAt));
  if (available.length) return available[0];
  const {fetchGdeltSnapshot} = await import('./operations-gdelt.mjs');
  const feed = await fetchGdeltSnapshot(fetcher,now);
  return {...feed,liveFallback:true};
}
export async function loadOperationalLeads(suppliers, {fetcher=defaultFetch,now=Date.now(),countryCode,force=false}={}) {
  if (!feeds.has(fetcher)) feeds.set(fetcher,{});
  const cache = feeds.get(fetcher);
  if (!cache.pending && (force || !cache.data || now<cache.time || now-cache.time>=300000)) {
    cache.pending = readSnapshot(fetcher,now).then(data=>{
      if (!validFeed(data,now)) throw Error('No current operational news feed is available.');
      cache.data=data;cache.time=now;
    }).finally(()=>{cache.pending=null;});
  }
  if (cache.pending) await cache.pending;
  return matchOperationalLeads(suppliers,cache.data,{now,countryCode});
}
