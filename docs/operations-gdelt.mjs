// The browser requests a fixed public topic search. Company and location
// comparisons happen after retrieval in the signed-in Atlas workspace.
const api = 'https://api.gdeltproject.org/api/v2/doc/doc';
const phrases = [
  'factory fire', 'plant shutdown', 'production halted', 'component shortage',
  'workers strike', 'industrial action', 'rail strike', 'port strike',
  'port closure', 'freight disruption', 'ransomware disruption', 'cyberattack disrupted',
  'safety recall', 'product recall', 'files for bankruptcy', 'enters administration'
];
const query = '(' + phrases.map(phrase => '"' + phrase + '"').join(' OR ') + ') sourcelang:english';
const params = new URLSearchParams({
  query, mode:'artlist', format:'json', timespan:'3d', maxrecords:'250', sort:'hybridrel'
});
export const gdeltDocURL = api + '?' + params;

const disruption = /\b(?:disrupt\w*|outage[s]?|shut(?:s|ting)? down|halts?|halted|suspend\w*|interrup\w*|closure[s]?|close[sd]?|delay\w*|cancel\w*|offline|paraly[sz]\w*)\b/i;
const workplace = /\b(?:factory|factories|plant|workforce|workers?|employees?|unions?|assembly|engineers?|dockers?|dockworkers?|longshore\w*|rail\w*|ports?|freight|production|pilots?|drivers?|airlines?)\b/i;
const cyber = /\b(?:ransomware|cyber[ -]?(?:attack|incident)|IT outage|network outage|systems? outage)\b/i;
const transport = /\b(?:ports?|terminals?|rail(?:road|way|ways)?|freight|cargo|shipping|canal|motorway|highway|airports?|deliveries|shipments?)\b/i;
const industrial = /\b(?:factory|factories|plant|refinery|facility|warehouse|assembly line|production|manufacturing|smelter|mine|grid|power supply|auto(?:maker|motive)|supplier|parts shortage|components?)\b/i;
const ignored = /\b(?:could have|anniversary|historical overview|simulation|exercise drill|avert(?:s|ed)?|calls? off|called off|settles?|settlement reached|end(?:s|ed)? (?:the |a )?strike|strike (?:ends|ended|averted)|resum(?:e|es|ed) (?:full |normal )?(?:operations?|production|service[s]?)|(?:operations?|production|services?) (?:fully )?resum(?:e|es|ed)|back to normal|reopens?|reopened|declares? (?:an? )?all[ -]clear|without (?:an? )?(?:outage|disruption)|no (?:operational )?(?:impact|disruption)|no longer affected|how to|how do|tips for|what is (?:a |an )?|movie review)\b/i;

function headlineCategory(title) {
  if (ignored.test(title) || /\?$/.test(title)) return '';
  if (cyber.test(title) && disruption.test(title)) return 'cyber';
  if (workplace.test(title) && /\b(?:strikes?|striking|walkouts?|work stoppages?|industrial action|down tools|picket\w*)\b/i.test(title) &&
      !/\b(?:air[ -]?strikes?|missile|drone|lightning|strikes? (?:deal|a deal|agreement)|strike price)\b/i.test(title)) return 'labor';
  if (/\b(?:recalls?\b.{0,50}\b(?:vehicles?|products?|parts?|batches|tires?|tyres?|batteries|components?|over|due to)|(?:product|vehicle|safety|component|nationwide) recalls?\b|stop[ -](?:sale|ship|delivery) order|recalled (?:over|after|due to))\b/i.test(title)) return 'quality';
  if (/\b(?:fil(?:es|ed|ing) (?:for )?(?:chapter (?:7|11)|bankruptcy|insolvency)|(?:enters?|entered|falls? into|fell into|placed (?:in|into)) (?:insolvency|liquidation|administration)|declares? bankruptcy|ceases? trading)\b/i.test(title)) return 'financial';
  if (transport.test(title) && (disruption.test(title) || /\b(?:closure|derail\w*|blockad\w*|blocked|bottleneck)\b/i.test(title))) return 'logistics';
  if (industrial.test(title) && (disruption.test(title) || /\b(?:fire|explosion|shutdown|shortage|blackout|evacuat\w*|force majeure)\b/i.test(title))) return 'production';
  return '';
}

function firstSeen(value) {
  if (typeof value !== 'string' || !/^\d{8}T\d{6}Z$/.test(value)) return null;
  const utc = value.replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/, '$1-$2-$3T$4:$5:$6.000Z');
  const milliseconds = Date.parse(utc);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== utc) return null;
  return milliseconds;
}

function articleURL(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      !/\.(?:[a-z]{2,}|xn--[a-z0-9-]+)$/i.test(url.hostname) ||
      /\.(?:localhost|local|internal)$/i.test(url.hostname)) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.*|fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
    }
    return url;
  } catch { return null; }
}

export async function fetchGdeltSnapshot(fetcher = fetch, now = Date.now()) {
  const response = await fetcher(gdeltDocURL, {
    method:'GET', mode:'cors', credentials:'omit', referrerPolicy:'no-referrer',
    cache:'no-store', signal:AbortSignal.timeout(30000)
  });
  if (response.status === 429) throw Error('GDELT is rate-limiting live news requests. Try again later.');
  if (!response.ok) throw Error('Live GDELT industry news is unavailable.');
  const data = await response.json();
  if (!Array.isArray(data?.articles)) throw Error('GDELT returned an unsupported response.');
  const generatedAt = new Date(now).toISOString();
  const reports = [], titles = new Set(), urls = new Set();
  for (const article of data.articles.slice(0,250)) {
    if (typeof article?.title !== 'string') continue;
    const title = article.title.replace(/\s+/g, ' ').trim();
    const url = articleURL(article.url);
    const time = firstSeen(article.seendate);
    if (title.length < 12 || title.length > 500 || !url || time === null ||
        time > now || time < now - 3 * 86400000) continue;
    const category = headlineCategory(title);
    const key = title.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (!category || urls.has(url.href) || titles.has(key)) continue;
    urls.add(url.href);
    titles.add(key);
    reports.push({
      id:'gdelt-doc-' + url.href, sourceId:'gdelt-doc', category, title,
      publisher:url.hostname.replace(/^www\./, ''), url:url.href,
      dateBasis:'first-seen', seenAt:new Date(time).toISOString()
    });
  }
  return {version:1, generatedAt, reports, coverage:[{
    id:'gdelt-doc', name:'GDELT DOC – live industry news', url:gdeltDocURL, status:'ok',
    checkedAt:generatedAt, received:data.articles.length, retained:reports.length,
    detail:'A three-day sample of English-language headlines. Dates represent when GDELT first saw an article. Publisher links provide the underlying evidence.'
  }]};
}
