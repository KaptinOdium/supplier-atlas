export const riskNames = {
  production: 'Production and utilities',
  labor: 'Labor action',
  logistics: 'Transport and logistics',
  cyber: 'Cyber and IT',
  quality: 'Quality and recalls',
  financial: 'Financial distress',
  weather: 'Weather',
  natural: 'Other natural hazards',
  other: 'Other risks'
};

export function riskType(event) {
  if (Object.hasOwn(riskNames, event.category)) return event.category;
  const type = String(event.category || '').toLowerCase();
  if (/strike|labor|labour|industrial action/.test(type)) return 'labor';
  if (/cyber|ransomware|it outage/.test(type)) return 'cyber';
  if (/flood|storm|cyclone|wind|hurricane|tornado|weather|heat-wave|cold-wave|drought/.test(type)) return 'weather';
  if (/earthquake|volcan|tsunami|landslide|wildfire/.test(type)) return 'natural';
  if (/rail|logistic|freight|maritime|transport|port closure|supplier delivery/.test(type)) return 'logistics';
  if (/recall|quality|product safety/.test(type)) return 'quality';
  if (/insolven|bankrupt|liquidat|financial/.test(type)) return 'financial';
  if (/production|utility|shortage|outage|fire|accident|explosion|spill|leak|collapse/.test(type)) return 'production';
  return 'other';
}

// Feature the newest report in each covered category before additional stories
// of the same type. The filtered view stays chronological.
export function orderReports(items, category) {
  const reports = items.filter(item => !category || item.category === category)
    .sort((a,b) => Date.parse(b.publishedAt || b.seenAt) - Date.parse(a.publishedAt || a.seenAt));
  if (category) return reports;
  const seen = new Set(), first = [], rest = [];
  for (const item of reports) {
    (seen.has(item.category) ? rest : first).push(item);
    seen.add(item.category);
  }
  return first.concat(rest);
}

export function setRiskOptions(select, counts, document) {
  const previous = select.value;
  select.replaceChildren();
  for (const [value,label] of [['','All risk types'], ...Object.entries(riskNames)]) {
    if (value && !counts.has(value)) continue;
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value ? label + ' (' + counts.get(value) + ')' : label;
    select.append(option);
  }
  select.value = counts.has(previous) ? previous : '';
  select.disabled = counts.size === 0;
}

export function createReportView(document) {
  const filter = document.getElementById('industryFilter');
  const list = document.getElementById('industryList');
  const status = document.getElementById('industryStatus');
  const more = document.getElementById('moreReports');
  let run, limit = 6;
  function display() {
    list.replaceChildren();
    more.hidden = true;
    if (!run || run.state !== 'ready') {
      status.textContent = !run ? '' : run.state === 'unavailable' ? 'Industry reports unavailable. Try scanning again.' : 'Checking industry reports…';
      return;
    }
    const items = orderReports(run.items || [], filter.value);
    const stamp = run.date ? new Date(run.date) : null;
    const time = stamp && Number.isFinite(stamp.getTime()) ? ' · Updated ' +
      stamp.toLocaleString('en-GB',{timeZone:'Europe/Prague',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) + ' Prague' : '';
    status.textContent = (items.length ? items.length + ' current public report' + (items.length === 1 ? '' : 's') :
      'No current qualifying reports in the sources checked') + time + '. Supplier matches appear under Supplier findings.';
    for (const report of items.slice(0,limit)) {
      const entry = document.createElement('li'), link = document.createElement('a'), meta = document.createElement('small');
      link.textContent = report.title; link.href = report.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      const observed = report.dateBasis === 'first-seen';
      meta.textContent = [riskNames[report.category], report.publisher,
        (observed ? 'First seen ' : '') + (report.publishedAt || report.seenAt || '').slice(0,10)].filter(Boolean).join(' · ');
      entry.append(meta,link); list.append(entry);
    }
    more.hidden = items.length <= limit;
  }
  filter.onchange = () => {limit = 6; display();};
  more.onclick = () => {limit += 12; display();};
  return next => {
    if (run === next) return;
    run = next; limit = 6;
    const counts = new Map();
    for (const item of run?.items || []) counts.set(item.category, (counts.get(item.category) || 0) + 1);
    setRiskOptions(filter, counts, document);
    display();
  };
}
