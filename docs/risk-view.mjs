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

export function reportTimestamp(report) {
  return report.publishedAt || report.seenAt || report.updatedAt || report.occurredAt || '';
}
const timeLabels = {'first-seen':'First seen ', updated:'Updated ', 'event-time':'Event time '};
// Feature the newest report in each covered category before additional stories
// of the same type. The filtered view stays chronological.
export function orderReports(items, category) {
  const reports = items.filter(item => !category || item.category === category)
    .sort((a,b) => Date.parse(reportTimestamp(b)) - Date.parse(reportTimestamp(a)));
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

export function createReportView(document, onShowReport) {
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
      meta.textContent = [riskNames[report.category], report.publisher,
        (timeLabels[report.dateBasis] || '') + reportTimestamp(report).slice(0,10)].filter(Boolean).join(' · ');
      entry.append(meta,link);
      if (report.summary) {
        const summary=document.createElement('p');summary.textContent=report.summary;entry.append(summary);
      }
      if (onShowReport && report.mapLocation) {
        const mapLink=document.createElement('button');
        mapLink.type='button';mapLink.className='textbutton';mapLink.textContent='Show company on map';
        mapLink.onclick=()=>onShowReport(report.id);entry.append(mapLink);
      }
      const details=[report.confirmation, report.eventStatus,
        [report.eventStart,report.eventEnd].filter(Boolean).join(' – '),
        report.severity, Number.isFinite(report.magnitude)?'Magnitude '+report.magnitude:''].filter(Boolean);
      if (details.length) {
        const context=document.createElement('small');context.textContent=details.join(' · ');entry.append(context);
      }
      const otherSources=report.evidence?.filter(ref=>ref.url!==report.url) || [];
      if (otherSources.length) {
        const evidence=document.createElement('details'), heading=document.createElement('summary');
        heading.textContent='Additional sources ('+otherSources.length+')';evidence.append(heading);
        for (const ref of otherSources) {
          const row=document.createElement('div'), anchor=document.createElement('a');
          anchor.textContent=ref.name;anchor.href=ref.url;anchor.target='_blank';anchor.rel='noopener noreferrer';
          row.append(anchor);
          if(ref.date) {const stamp=document.createElement('small');stamp.textContent=(timeLabels[ref.dateBasis] || '')+ref.date.slice(0,10);row.append(stamp);}
          evidence.append(row);
        }
        entry.append(evidence);
      }
      list.append(entry);
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
