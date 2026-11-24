import {summarizeSignals} from './screen-signals.mjs';
import {decisionNames} from './screen-policy.mjs';
import {createReportView, riskNames, riskType, setRiskOptions} from './risk-view.mjs?v=20261124-1';
import {matchOperationalReports} from './screen-operations.mjs?v=20261124-1';

const signalLabels = { red: 'Active site incident', yellow: 'Needs review' };
const projectSource = 'Project register';
const operationsSource = 'Industry reports';
const agentSource = 'Agent scan';
const dayFormat = new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Prague', year:'numeric', month:'2-digit', day:'2-digit'});
const timeFormat = new Intl.DateTimeFormat('en-GB', {timeZone:'Europe/Prague', dateStyle:'medium', timeStyle:'short'});
const number = value => value.toLocaleString('en-US');

export function createScreeningPanel({document, loadProject, readPrivateRegister, matchSuppliers,
  countryCode, loadHazardLeads, loadGdacs, loadOperationalLeads, loadAgentScan, canReadProject, projectAssessment, onSignals = () => {}, onShowMap}) {
  const get = id => document.getElementById(id);
  const node = (tag, text, cls) => {
    const item = document.createElement(tag);
    if (text !== undefined) item.textContent = text;
    if (cls) item.className = cls;
    return item;
  };
  const button = get('refreshScreening'), fileInput = get('privateRegister'), removeFile = get('removeRegister');
  const status = get('scanStatus'), coverage = get('scanCoverage'), sources = get('screeningSources'), results = get('screeningResults');
  const findingsFilter = get('findingsFilter'), renderReports = createReportView(document);
  let rows = null, sourceRuns = [], localRegister = null, localName = '', localResult = null, groups = [], completed = null;
  let generation = 0, fileGeneration = 0, busy = false, activePolicy = null;
  let latestAgent = null, pendingAgent = null, agentController = new AbortController(), manualScan = false;
  let visibleLimit = 40;
  const disclosures = new Map();
  let displayed = [];

  function controls() {
    button.disabled = !rows || manualScan;
    button.textContent = manualScan ? 'Scanning…' : 'Scan all suppliers';
    fileInput.disabled = !rows?.length;
    removeFile.hidden = !localRegister;
    removeFile.disabled = !rows?.length;
  }

  function safeLink(parent, source) {
    if (!source || typeof source !== 'object') return;
    let url;
    try { url = new URL(source.url); } catch { /* Some sources are named internal systems. */ }
    const line = node('li');
    if (url && ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) {
      const anchor = node('a', source.name || url.hostname);
      anchor.href = url.href; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer';
      line.append(anchor);
    } else line.append(node('span', source.name || 'Source reference'));
    for (const detail of [source.published, source.role, source.checkStatus].filter(Boolean)) line.append(node('small', detail));
    parent.append(line);
  }

  function renderRules(parent, rules, label = '') {
    if (Array.isArray(rules)) {
      for (const rule of rules) renderRules(parent, rule, label);
    } else if (rules && typeof rules === 'object') {
      if (typeof rules.url === 'string') { const list = node('ul'); safeLink(list, rules); parent.append(list); return; }
      for (const [key,value] of Object.entries(rules)) {
        const name = key.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_',' ');
        renderRules(parent,value, [label, name].filter(Boolean).join(' · '));
      }
    } else if (typeof rules === 'string' && rules.trim()) {
      const p = node('p');
      if (label) p.append(node('b', label + ' — '));
      p.append(node('span',rules)); parent.append(p);
    }
  }

  function sourceDetail(run) {
    const section = node('details',undefined,'scan-source');
    const phase = run.state === 'ready' ? run.date || 'Checked' : run.state === 'loading' ? 'Checking…' : 'Unavailable';
    section.append(node('summary',run.name + ' · ' + phase));
    if (run.note) section.append(node('p',run.note));
    if (run.model) section.append(node('small','Scan model · '+run.model));
    if (run.sources?.length) {
      const list = node('ul');
      for (const source of run.sources) safeLink(list,{
        name:source.name,url:source.url,checkStatus:source.status === 'ok' ? 'Checked · ' + source.retained + ' reports' : 'Unavailable',
        published:source.checkedAt
      });
      section.append(list);
    }
    if (run.register) {
      if (run.register.coverageNote) section.append(node('p',run.register.coverageNote));
      if (run.register.screeningRules) {
        const rules = node('details'); rules.append(node('summary','Screening rules')); renderRules(rules,run.register.screeningRules); section.append(rules);
      }
      if (run.register.sourceRegistry?.length) {
        const registry = node('details'), list = node('ul');
        registry.append(node('summary','Registered sources'));
        for (const item of run.register.sourceRegistry) safeLink(list,item);
        registry.append(list); section.append(registry);
      }
    }
    if (run.sourceURL) {const list=node('ul');safeLink(list,{url:run.sourceURL,name:run.name});section.append(list);}
    return section;
  }

  function incident(groupItem, today) {
    const {match,source} = groupItem, {event,reason,basis,decision} = match;
    const item = node('article',undefined,'scan-incident');
    item.append(node('b',event.title || event.company || 'Screened event'));
    item.append(node('small',[riskNames[riskType(event)],source,event.date,event.site || event.country].filter(Boolean).join(' · ')));
    if(event.confirmation) item.append(node('small',event.confirmation));
    if(event.summary) item.append(node('p',event.summary));
    const label = decisionNames[decision] || decision;
    item.append(node('p',[label,reason].filter(Boolean).join(' — ')),node('p',basis));
    const assessment = activePolicy && projectAssessment?.(match,activePolicy,today);
    if (assessment) item.append(node('p',assessment));
    const checked = event.lastChecked || event.reviewedAt;
    item.append(node('small',checked ? 'Source checked ' + checked : 'Source check date unavailable'));
    if (event.sources?.length) {
      const refs=node('ul');for(const fact of event.sources)safeLink(refs,fact);item.append(refs);
    }
    return item;
  }

  function renderResults(today) {
    results.replaceChildren(); disclosures.clear();
    const filter = findingsFilter.value;
    displayed = filter ? groups.map(group => {
      const items = group.items.filter(item=>riskType(item.match.event)===filter);
      return {...group,items,level:items.some(item=>item.level==='red')?'red':'yellow'};
    }).filter(group=>group.items.length).sort((a,b)=>Number(b.level==='red')-Number(a.level==='red')) : groups;
    if (!displayed.length) return;
    const wrap=node('div',undefined,'tablewrap'), table=node('table',undefined,'scan-table');
    table.setAttribute('aria-label','Supplier findings');
    const head=node('thead'), tr=node('tr'), body=node('tbody');
    for (const name of ['Signal','Supplier','Site','Evidence']) tr.append(node('th',name));
    head.append(tr);table.append(head,body);wrap.append(table);results.append(wrap);
    const more=node('button','Show more suppliers','quiet');more.type='button';
    let shown=0;
    function appendThrough(limit) {
      const last=Math.min(limit,displayed.length);
      while(shown<last) {
        const {supplier,level,items}=displayed[shown++], row=node('tr'), indicator=node('td');
        const marker=node('i',undefined,'scan-dot');marker.setAttribute('aria-hidden','true');marker.setAttribute('data-level',level);
        indicator.append(marker,node('span',signalLabels[level]),node('small',[...new Set(items.map(item=>riskNames[riskType(item.match.event)]))].join(' · ')));
        const who=node('td');who.append(node('b',supplier.name || 'Unnamed supplier'),node('small','DUNS ' + (supplier.duns || 'unavailable')));
        const site=node('td',[supplier.city,supplier.country].filter(Boolean).join(', '));
        const cell=node('td'), detail=node('details',undefined,'scan-evidence');
        const first=items[0]?.match.event;
        const heading=node('summary',(first?.title || 'View evidence') + (items.length>1 ? ' (+' + (items.length-1) + ' more)' : ''));
        detail.append(heading);
        // Evidence links are built when the user expands a supplier, including keyboard or map access.
        let built = false;
        function fill() {
          if(!detail.open || built)return;
          built = true;
          if(onShowMap && Number.isFinite(supplier.lat) && Number.isFinite(supplier.lon)) {
            const mapLink=node('button','Show on map','textbutton');
            mapLink.type='button';mapLink.onclick=()=>onShowMap(supplier);detail.append(mapLink);
          }
          for(const item of items) detail.append(incident(item,today));
        }
        detail.addEventListener('toggle',fill);
        disclosures.set(supplier.id || supplier.duns,{detail,heading,fill});
        cell.append(detail);row.append(indicator,who,site,cell);body.append(row);
      }
      more.hidden=shown>=displayed.length;
    }
    more.onclick=()=>{visibleLimit+=40;appendThrough(visibleLimit);};
    appendThrough(visibleLimit);results.append(more);
  }

  function showSupplier(id) {
    const isSupplier = group => (group.supplier.id || group.supplier.duns) === id;
    if (!displayed.some(isSupplier) && groups.some(isSupplier)) {
      findingsFilter.value = ''; renderResults(dayFormat.format(new Date()));
    }
    const index = displayed.findIndex(isSupplier);
    if (index<0) return false;
    if (!disclosures.has(id)) {visibleLimit=Math.max(visibleLimit,index+1);renderResults(dayFormat.format(new Date()));}
    const {detail,heading,fill}=disclosures.get(id);
    detail.open=true;fill();heading.focus?.();detail.scrollIntoView?.({behavior:'smooth',block:'center'});return true;
  }

  function registerResult(name,register,suppliers,note) {
    return {name,state:'ready',date:register.asOf,note,register,
      matches:matchSuppliers(suppliers,register,dayFormat.format(new Date()),countryCode)};
  }

  async function agentRun(start, suppliers) {
    const controller = agentController;
    if (start && !pendingAgent) pendingAgent=loadAgentScan({start:true,signal:controller.signal})
      .finally(() => { if (controller === agentController) pendingAgent = null; });
    let result = null, failure = '';
    try {
      result = await (pendingAgent || loadAgentScan({start:false,signal:controller.signal}));
      if (controller === agentController && result && (!latestAgent || Date.parse(result.checkedAt)>=Date.parse(latestAgent.checkedAt)))
        latestAgent=result;
    }
    catch (error) {
      failure = 'Agent scan ' + (start ? 'failed' : 'could not be loaded') + '. ' + error.message;
      if (!latestAgent) return {name:agentSource,state:'unavailable',note:failure};
      result = latestAgent;
    }
    if (!result) return {name:agentSource,state:'empty',note:'Start a scan to check current sources.'};
    const {matches,items} = matchOperationalReports(suppliers,result.reports,{checkedAt:result.checkedAt,countryCode,agent:true});
    const stamp = timeFormat.format(new Date(result.checkedAt))+' Prague';
    const label = failure ? ' Showing the last successful scan' : start ? 'Agent scan completed' : 'Last agent scan';
    const summary = label+' '+stamp+' · '+number(result.sourcesChecked)+' sources checked · '+number(result.reports.length)+' reports returned';
    const partial = !!(result.sourcesFailed.length || failure);
    const note = failure+summary+(result.sourcesFailed.length ? ' · Unavailable sources include '+result.sourcesFailed.join(', ') : '')+'.';
    return {name:agentSource,state:'ready',date:stamp,checkedAt:result.checkedAt,note,model:result.model,partial,matches,items,
      sources:Array.isArray(result.coverage) ? result.coverage.filter(s=>s && typeof s.name==='string') : []};
  }

  function industryReports(runs) {
    const scheduled = runs.find(run=>run.name===operationsSource), agent = runs.find(run=>run.name===agentSource);
    if (agent?.state !== 'ready') return scheduled;
    if (scheduled?.state !== 'ready') return {...agent,date:agent.checkedAt};
    const urls = new Set(), titles = new Set();
    const items = [...agent.items,...(scheduled.items || [])].filter(report => {
      const title = report.title.trim().toLowerCase();
      if (urls.has(report.url) || titles.has(title)) return false;
      urls.add(report.url);titles.add(title);return true;
    });
    const date = Date.parse(scheduled.date) > Date.parse(agent.checkedAt) ? scheduled.date : agent.checkedAt;
    return {state:'ready',date,items};
  }

  function render() {
    sources.replaceChildren();
    if (!rows) {
      status.textContent = '';
      get('agentStatus').textContent='';coverage.textContent='';results.replaceChildren();disclosures.clear();groups=[];displayed=[];
      setRiskOptions(findingsFilter,new Map(),document);renderReports(null);onSignals(groups,{state:'idle'});return;
    }
    const runs=[...sourceRuns];
    if(localRegister) {
      localResult ??= registerResult(localName,localRegister,rows,'Private register loaded in this tab.');
      runs.push(localResult);
    }
    for(const run of runs) if(run.state!=='empty') sources.append(sourceDetail(run));
    const agent = runs.find(run=>run.name===agentSource);
    get('agentStatus').textContent = agent?.note || '';
    renderReports(industryReports(runs));
    const owner=canReadProject();
    sources.append(node('p',owner
      ? 'Private and manually reviewed sources use saved evidence. Only the public feeds are refreshed during this scan.'
      : 'This account can scan live public reports and registers opened in this tab. The saved project register requires owner access.'));
    activePolicy=sourceRuns.find(run=>run.name===projectSource)?.register?.assessmentPolicy || localRegister?.assessmentPolicy || null;
    const ready=runs.filter(run=>run.state==='ready');
    const failure=runs.filter(run=>run.state==='unavailable');
    const today=dayFormat.format(new Date());
    const findings=ready.flatMap(run=>run.matches.map(match=>({source:run.name,match})));
    groups=summarizeSignals(findings,activePolicy,today);
    const counts = new Map();
    for (const group of groups) {
      for (const category of new Set(group.items.map(item=>riskType(item.match.event))))
        counts.set(category,(counts.get(category) || 0) + 1);
    }
    setRiskOptions(findingsFilter,counts,document);
    const red=groups.filter(group=>group.level==='red').length, yellow=groups.length-red;
    if (!rows.length) {
      status.textContent='No suppliers loaded for matching.';
    } else if(busy) {
      status.textContent='Checking '+number(rows.length)+' suppliers…';
    } else if (ready.length) {
      status.textContent=number(rows.length)+' suppliers scanned · '+number(red)+' red · '+number(yellow)+' yellow'+
        (completed?' · '+timeFormat.format(completed)+' Prague':'');
    } else status.textContent='Scan unavailable. Try scanning again.';
    const limited=runs.filter(run=>run.state==='ready' && (run.partial || /unavailable|fallback|partial|snapshot|only the returned sample/i.test(run.note || '')));
    coverage.textContent=failure.length?'Partial coverage · '+failure.map(run=>run.name).join(', ')+' unavailable.':
      owner ? 'Partial coverage · private sources use saved reviews' : limited.length ? 'Limited public feed coverage' : 'Public feed coverage';
    renderResults(today);
    if(rows.length && !groups.length && !busy && ready.length)results.append(node('p','No supplier signals in the sources checked.','scan-empty'));
    const state = busy ? 'scanning' : !ready.length ? 'unavailable' : failure.length || limited.length ? 'partial' : 'complete';
    onSignals(groups,{state});
  }

  async function scan(force=false) {
    if (!rows || busy && (!force || manualScan)) return;
    const serial=++generation, owner=canReadProject(), supplierRows=rows;
    busy=true;manualScan=force || !!pendingAgent;activePolicy=null;completed=null;visibleLimit=40;localResult=null;
    const work=[];
    work.push([agentSource,()=>agentRun(force,supplierRows)]);
    if(owner && rows.length) {
      work.push([projectSource,async()=>{
        const register=await loadProject();
        if(!register) throw Error('No project register has been saved.');
        return registerResult(projectSource,register,supplierRows,'Saved project reviews. Open a source below for its latest documented check.');
      }]);
    }
    const feeds = rows.length || force ? [[operationsSource,loadOperationalLeads],['Global Incident Tracker',loadHazardLeads],['GDACS',loadGdacs]] : [];
    for(const [name,load] of feeds) {
      work.push([name,async()=>{
        const payload=await load(supplierRows,{countryCode,force});
        return {name,state:'ready',date:payload.checkedAt,note:payload.coverage,sourceURL:payload.sourceURL,matches:payload.matches,
          items:payload.items,sources:payload.sources};
      }]);
    }
    sourceRuns=work.map(([name])=>({name,state:'loading',note:name===agentSource && force ? 'Agent scan in progress…' : ''}));controls();render();
    await Promise.all(work.map(async([name,load],i)=>{
      let result;
      try { result=await load(); }
      catch(error) { result={name,state:'unavailable',note:error.message || 'Source unavailable.'}; }
      if(serial!==generation || supplierRows!==rows || owner!==canReadProject())return;
      sourceRuns[i]=result;
      if(sourceRuns.some(run=>run.state==='loading')) render();
    }));
    if(serial!==generation || supplierRows!==rows || owner!==canReadProject())return;
    busy=false;manualScan=false;completed=new Date();controls();render();
  }

  function clearFile() {
    fileGeneration++;localName='';localRegister=null;localResult=null;fileInput.value='';get('registerStatus').textContent='';
  }
  function reset() {
    agentController.abort();agentController=new AbortController();latestAgent=null;pendingAgent=null;manualScan=false;
    generation++;rows=null;busy=false;completed=null;activePolicy=null;sourceRuns=[];clearFile();controls();render();
  }
  function setRows(next) {
    if(next===rows)return;
    generation++;fileGeneration++;rows=next;sourceRuns=[];activePolicy=null;busy=false;manualScan=false;completed=null;visibleLimit=40;
    get('registerStatus').textContent='';fileInput.value='';
    controls();
    if(rows) void scan(); else render();
  }

  fileInput.onchange=async e=>{
    const file=e.target.files?.[0];
    if(!rows?.length || !file)return;
    const serial=++fileGeneration;
    try {
      if(file.size>5_000_000)throw Error('Choose a register under 5 MB.');
      const text=await file.text();
      if(serial!==fileGeneration)return;
      const register=readPrivateRegister(text);
      localResult=registerResult(file.name,register,rows,'Private register loaded in this tab.');
      localRegister=register;localName=file.name;get('registerStatus').textContent='Included in this scan: '+file.name;
      render();
    } catch(error) {
      if(serial===fileGeneration)get('registerStatus').textContent='Could not load the register. '+error.message;
    } finally {
      if(serial===fileGeneration) {fileInput.value='';controls();}
    }
  };
  button.onclick=()=>scan(true);
  findingsFilter.onchange=()=>{visibleLimit=40;renderResults(dayFormat.format(new Date()));};
  removeFile.onclick=()=>{clearFile();controls();render();};
  controls();
  return {setRows, reset, showSupplier};
}
