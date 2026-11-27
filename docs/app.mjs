import {norm,parseSuppliers,csvExport,point} from './core.mjs';
import {AuthClient,configured,AccessError,ConflictError} from './auth-core.mjs?v=20261124-1';
import {setIdentity} from './auth-state.mjs';
import {createSupplierMap} from './map-view.mjs?v=20261127-2';
const $=id=>document.getElementById(id),NS='http://www.w3.org/2000/svg';let lastLookupAt=0;let rows=[],world=[],cities=[],cityIndex=new Map(),countryIndex=new Map(),cache=new Map(),selected=null,busy=false,cancel=false,view=[0,0,1000,500];
let auth=null,identity=null,revision=0,dirty=false,saving=false,loading=false,loaded=false,epoch=0,checking=false,lookupAbort=null;
let detailMap=null,detailReady=false,mapAttempt=0,mapAbort=null,detailLoading=false;
let pendingDuns = '', linkedPopupRow = null;
let reportLocations = [], pendingReport = '', selectedReport = '';
import {createScreeningPanel} from './screening-panel.mjs?v=20261127-2';
import {readPrivateRegister} from './screen-register.mjs';
import {loadHazardLeads} from './screen-hazards.mjs?v=20261123-1';
import {loadGdacs} from './screen-gdacs.mjs?v=20261123-1';
import {loadOperationalLeads} from './screen-operations.mjs?v=20261127-2';
import {projectAssessment} from './screen-policy.mjs';
import {matchSuppliers} from './screen-matches.mjs?v=20261118-3';
let signalsById = new Map(), screeningState = 'idle', registerPage = 0;
const registerPageSize = 1000;
const onlyFlagged = $('onlyFlagged');
const signalColors = {red:'#c53735', yellow:'#f5c542', neutral:'#64748b'};
const signalLabels = {red:'Active site incident', yellow:'Needs review', neutral:'Other supplier'};
const levelOrder = {red:2, yellow:1, neutral:0};
const screeningPanel = createScreeningPanel({
  document, readPrivateRegister, matchSuppliers, countryCode:getCode,
  loadHazardLeads, loadGdacs, loadOperationalLeads, projectAssessment, canReadProject: () => identity?.role === 'owner',
  onReportLocations: updateReportLocations, onShowReport: focusReport,
  onSignals: updateSignals, onShowMap: focusSupplier, loadAgentScan: options => auth.loadAgentScan(options),
  loadProject: () => identity?.role === 'owner' ? auth.loadScreeningRegister() : null
});
const canEdit=()=>identity&&['owner','editor'].includes(identity.role);
function controls(){updatePreviousExport();screeningPanel.setRows(identity && loaded && !loading ? rows : null);for(const node of document.querySelectorAll('[data-edit]'))node.disabled=!canEdit()||saving||loading||busy||!loaded;$('reloadButton').disabled=!identity||saving||loading||busy;$('exportButton').disabled=!identity||loading;$('saveButton').disabled=!canEdit()||saving||loading||busy||!dirty||!loaded;$('roleNote').textContent=identity?.role==='viewer'?'View-only access':'';$('saveState').textContent=loading?'Loading shared list…':saving?'Saving shared list…':!loaded?'Shared list has not loaded. Reload to try again.':dirty?'Unsaved changes — save to share with your team.':'Shared list is up to date.';$('saveState').classList.toggle('unsaved',dirty);}
function changed(){dirty=true;controls();}
function editable(){if(!canEdit()||saving||loading||busy||!loaded){notice('Editing is unavailable while viewing or processing the shared list.',true);return false;}return true;}
function lock(message='Sign in with your invited account.'){epoch++;pendingDuns='';pendingReport='';selectedReport='';reportLocations=[];linkedPopupRow=null;onlyFlagged.checked=true;registerPage=0;screeningPanel.reset();stopDetailedMap();cancel=true;lookupAbort?.abort();lookupAbort=null;identity=null;setIdentity(null);rows=[];cache.clear();selected=null;dirty=false;loading=false;loaded=false;saving=false;busy=false;revision=0;$('cancelButton').hidden=true;$('pasteInput').value='';$('fileInput').value='';$('search').value='';$('lookupConsent').checked=false;$('mapPopup').hidden=true;$('mapPopup').replaceChildren();notice('Sign in to access your supplier list.');if($('editDialog').open)$('editDialog').close();$('editName').textContent='';$('editLocation').textContent='';$('editLat').value='';$('editLon').value='';$('candidateList').replaceChildren();$('workspaceMain').hidden=true;$('authGate').hidden=false;$('accountInfo').hidden=true;$('accountInfo').textContent='';$('logoutButton').hidden=true;$('authNotice').textContent=message;render();controls();}
async function failAccess(error){if(error instanceof AccessError){lock(error.message);await auth?.signOut();return true;}return false;}
function safeRows(input){if(!Array.isArray(input)||input.length>10000)throw Error('The shared supplier list is invalid.');const text=v=>typeof v==='string'?v:'';return input.map((r,i)=>{if(!r||typeof r!=='object'||Array.isArray(r))throw Error('The shared supplier list contains an invalid row.');const valid=Number.isFinite(r.lat)&&Number.isFinite(r.lon)&&Math.abs(r.lat)<=90&&Math.abs(r.lon)<=180;return {id:'s'+(i+1),name:text(r.name),duns:text(r.duns),country:text(r.country),city:text(r.city),lat:valid?r.lat:null,lon:valid?r.lon:null,precision:valid?(r.precision==='Approximate city'?'Approximate city':'Provided coordinates'):text(r.precision)||'Unresolved',source:text(r.source),warnings:Array.isArray(r.warnings)?r.warnings.filter(x=>typeof x==='string'):[],candidates:Array.isArray(r.candidates)?r.candidates.filter(c=>c&&Number.isFinite(c.lat)&&Number.isFinite(c.lon)&&Math.abs(c.lat)<=90&&Math.abs(c.lon)<=180).map(c=>({lat:c.lat,lon:c.lon,label:text(c.label),source:text(c.source)})):[]};});}
async function loadShared(){if(!identity||loading||saving||busy)return;if(dirty&&!confirm('Discard unsaved changes and load the latest shared list?'))return;const requestEpoch=epoch;loading=true;controls();try{const data=await auth.loadShared();if(requestEpoch!==epoch)return;if(!Number.isSafeInteger(data.revision)||data.revision<0)throw Error('The shared list revision is invalid.');rows=safeRows(data.suppliers);revision=data.revision;loaded=true;dirty=false;$('mapPopup').hidden=true;render();fit();notice('Loaded '+rows.length+' suppliers from your private shared workspace.');}catch(e){if(requestEpoch!==epoch)return;if(!await failAccess(e))notice(e.message,true);}finally{if(requestEpoch===epoch){loading=false;controls();}}}
async function saveShared(){if(!editable()||!dirty)return;const requestEpoch=epoch;saving=true;controls();try{const data=await auth.saveShared(rows,revision);if(requestEpoch!==epoch)return;rows=safeRows(data.suppliers);revision=data.revision;dirty=false;render();notice('Saved '+rows.length+' suppliers. Your team can reload to see the changes.');}catch(e){if(requestEpoch!==epoch)return;if(!await failAccess(e))notice(e instanceof ConflictError?'Someone else saved a newer list. Export your changes if needed, then reload the shared list before saving.':e.message,true);}finally{if(requestEpoch===epoch){saving=false;controls();}}}
async function openWorkspace(member){pendingDuns=linkedDuns();pendingReport=linkedReport();identity=member;setIdentity(member);const requestEpoch=++epoch;$('loginPassword').value='';$('authGate').hidden=true;$('workspaceMain').hidden=false;$('accountInfo').textContent=member.name+' · '+member.role;$('accountInfo').hidden=false;$('logoutButton').hidden=false;controls();void startDetailedMap(requestEpoch);await prepareMap();if(requestEpoch===epoch)await loadShared();}
async function recheck(){if(!identity||checking)return;const requestEpoch=epoch;checking=true;try{const member=await auth.verify();if(requestEpoch!==epoch)return;if(member.role!==identity.role)screeningPanel.reset();identity=member;setIdentity(member);controls();}catch(e){if(requestEpoch===epoch&&!await failAccess(e))notice('Account access could not be checked. Reconnect before saving.',true);}finally{checking=false;}}
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')recheck();});
window.addEventListener('pageshow',()=>{if(identity)recheck();});
setInterval(recheck,60000);
const notice=(text,error=false)=>{$('notice').textContent=text;$('notice').style.color=error?'#a04848':'';};
const hasPoint=r=>Number.isFinite(r.lat)&&Number.isFinite(r.lon);const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
function download(name,content){const u=URL.createObjectURL(new Blob(['\uFEFF'+content],{type:'text/csv;charset=utf-8'}));const a=el('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
const previousListKey='supplier-atlas-v1';
function updatePreviousExport() {
  const button=$('exportPreviousButton');
  button.hidden=true;
  if(identity?.role!=='owner') return;
  try {
    const stored=window.localStorage;
    for(let i=0;i<stored.length;i++) {
      if(stored.key(i)===previousListKey) {button.hidden=false;break;}
    }
  } catch { /* Browser storage can be disabled. */ }
}
$('exportPreviousButton').onclick=()=>{
  if(identity?.role!=='owner') return;
  try {
    const previous=JSON.parse(window.localStorage.getItem(previousListKey));
    if(!Array.isArray(previous?.rows) || !previous.rows.every(row=>row && typeof row.name==='string' && Array.isArray(row.warnings)))
      throw Error('The previous browser list could not be read.');
    download('previous-browser-suppliers.csv',csvExport(previous.rows));
  } catch { notice('The previous browser list could not be exported.',true); }
};
window.addEventListener('storage',event=>{if(event.key===previousListKey || event.key===null)updatePreviousExport();});
function getCode(s){return countryIndex.get(norm(s))||(/^[A-Za-z]{2}$/.test(s.trim())?s.trim().toUpperCase():null);}
function buildIndex(){for(const c of world){for(const n of [c.name,c.iso2,c.iso3,...(c.aliases||[])])countryIndex.set(norm(n),c.iso2);}for(const [code,names] of Object.entries({CZ:['Czechia','Czech Republic','Česko','Česká republika','Tschechien'],DE:['Germany','Deutschland','Německo'],SK:['Slovakia','Slovensko','Slowakei'],AT:['Austria','Österreich','Rakousko'],GB:['UK','United Kingdom','Great Britain','Velká Británie'],US:['USA','United States','United States of America','Spojené státy'],KR:['South Korea','Republic of Korea','Korea, Republic of'],CN:['China','Čína'],MX:['Mexico','Mexiko'],PL:['Poland','Polsko','Polen'],HU:['Hungary','Maďarsko','Ungarn'],ES:['Spain','Španělsko','Spanien'],IT:['Italy','Itálie','Italien'],FR:['France','Francie','Frankreich'],NL:['Netherlands','Nizozemsko','Niederlande'],IN:['India','Indie'],TR:['Turkey','Türkiye','Turecko']})){for(const n of names)countryIndex.set(norm(n),code);}try{for(const locale of ['en','cs','de','fr','es']){const dn=new Intl.DisplayNames(locale,{type:'region'});for(const code of new Set([...world.map(c=>c.iso2),...cities.map(c=>c[5])])){countryIndex.set(norm(code),code);countryIndex.set(norm(dn.of(code)),code);}}}catch{}
 for(const c of cities){for(const name of new Set([c[0],c[1],...(c[2]||'').split(',')].map(norm).filter(Boolean))){const key=c[5]+'|'+name;if(!cityIndex.has(key))cityIndex.set(key,[]);cityIndex.get(key).push(c);}}
}
function offlineMatch(r){if(hasPoint(r))return;const code=getCode(r.country);if(!code)return;const matches=cityIndex.get(code+'|'+norm(r.city))||[];const unique=[...new Map(matches.map(c=>[c[3]+','+c[4],c])).values()];r.candidates=unique.map(c=>({lat:c[3],lon:c[4],label:`${c[0]} · ${c[5]} · region ${c[6]}`,source:'GeoNames cities15000'}));if(unique.length===1)chooseCandidate(r,r.candidates[0]);else if(unique.length>1)r.precision='Ambiguous city';}
function chooseCandidate(r,c){r.lat=Number(c.lat);r.lon=Number(c.lon);r.precision='Approximate city';r.source=c.source||'OpenStreetMap Nominatim';r.candidates=[];r.warnings=r.warnings.filter(w=>w!=='Invalid coordinates');}
function linkedDuns() {
  const match = /^#duns=(\d{9}|\d{2}-\d{3}-\d{4})$/.exec(window.location.hash);
  return match ? match[1].replaceAll('-', '') : '';
}
function linkedReport() {
  return /^#report=([a-z0-9-]{1,160})$/.exec(window.location.hash)?.[1] || '';
}

function openLinkedReport() {
  if (!identity || !loaded || loading || detailLoading || !pendingReport) return;
  if (reportLocations.some(report => report.id === pendingReport)) focusReport(pendingReport);
  else if (['partial','complete','unavailable'].includes(screeningState)) {
    pendingReport = '';
    $('mapStatus').textContent = 'This company report is unavailable in the current feed.';
  }
}

function updateReportLocations(reports) {
  if (JSON.stringify(reportLocations) !== JSON.stringify(reports)) {
    reportLocations = reports;
    if (selectedReport && !reports.some(report => report.id === selectedReport)) closeMapPopup();
    detailMap?.updateReports?.(reports);
    renderDots();
  }
  openLinkedReport();
}

function focusReport(id) {
  const report = reportLocations.find(item => item.id === id);
  if (!identity || !report) return;
  if (detailLoading) { pendingReport = id; return; }
  closeMapPopup();
  pendingReport = '';
  pendingDuns = '';
  selectedReport = id;
  if (detailReady && detailMap) detailMap.focusReport(report);
  else {
    const p = point(report.lat,report.lon);
    setView([p.x - 4,p.y - 2,8,4]);
  }
  const box = $('mapPopup');
  const close = el('button','×','close');
  close.setAttribute('aria-label','Close');
  close.onclick = closeMapPopup;
  const links = el('div',undefined,'map-link-actions');
  for (const [label,url] of [['Incident report',report.url],['Company location',report.sourceURL]]) {
    const link = el('a',label);
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    links.append(link);
  }
  box.append(close,el('b',report.name),el('div',report.city),el('p',report.basis),el('p',report.title),links);
  box.hidden = false;
  $('mapwrap').scrollIntoView?.({behavior:'smooth',block:'center'});
}

function openLinkedSupplier() {
  if (!pendingDuns || !identity || !loaded || loading || detailLoading || screeningState === 'idle') return;
  const duns = pendingDuns;
  const matches = rows.filter(row => row.duns.replaceAll('-', '') === duns);
  if (screeningState === 'scanning' && (!matches.length || matches.some(row => !signalsById.has(row.id)))) return;
  pendingDuns = '';
  if (!matches.length) {
    notice('This DUNS is absent from the shared supplier list.');
    return;
  }
  if (onlyFlagged.checked && matches.some(row => !signalsById.has(row.id))) {
    onlyFlagged.checked = false;
    renderTable();
    renderDots();
  }
  const [row] = matches;
  if (matches.length === 1 && hasPoint(row)) {
    focusSupplier(row, true);
    return;
  }
  $('search').value = duns;
  $('countryFilter').value = '';
  $('statusFilter').value = '';
  registerPage = 0;
  renderTable();
  $('supplierRegister').open = true;
  $('search').focus?.();
  notice(matches.length > 1 ? 'Several supplier rows share this DUNS. Select a site in the register.' :
    'This supplier has no mapped coordinates. Its record is open in the register.');
}
window.addEventListener('hashchange', () => {
  pendingDuns = linkedDuns();
  pendingReport = linkedReport();
  if (identity) {
    closeMapPopup();
    if (loaded && !loading && (pendingDuns && identity.role === 'owner' || pendingReport && !reportLocations.some(report => report.id === pendingReport))) screeningPanel.refreshSaved();
    openLinkedSupplier();
    openLinkedReport();
  }
});
function displayRows() {
  return onlyFlagged.checked ? rows.filter(row => signalsById.has(row.id)) : rows;
}
function signalEmptyMessage() {
  switch (screeningState) {
    case 'scanning': return 'Scanning suppliers for signals…';
    case 'unavailable': return 'Screening sources are unavailable.';
    case 'partial': return 'No yellow or red signals in the sources checked. Coverage is partial.';
    case 'complete': return 'No yellow or red signals in the sources checked.';
    default: return 'Waiting for supplier screening.';
  }
}
function filtered(){const q=norm($('search').value),country=$('countryFilter').value,status=$('statusFilter').value;return displayRows().filter(r=>(!q||norm([r.name,r.duns,r.country,r.city].join(' ')).includes(q))&&(!country||r.country===country)&&(!status||(status==='mapped'?hasPoint(r):status==='warnings'?r.warnings.length:!hasPoint(r))));}
function render(){const mapped=rows.filter(hasPoint);$('countAll').textContent=rows.length.toLocaleString();$('countMapped').textContent=mapped.length.toLocaleString();$('countCountries').textContent=new Set(rows.map(r=>getCode(r.country)||norm(r.country)).filter(Boolean)).size;$('countReview').textContent=rows.length-mapped.length;const old=$('countryFilter').value;$('countryFilter').replaceChildren(new Option('All countries',''));[...new Set(rows.map(r=>r.country).filter(Boolean))].sort().forEach(c=>$('countryFilter').add(new Option(c,c)));$('countryFilter').value=old;renderTable();renderDots();}
function renderTable() {
  const list=filtered(), body=$('tableBody'), empty=$('emptyTable');
  body.replaceChildren();
  empty.hidden=list.length>0;
  empty.textContent=!rows.length?'Your imported suppliers will appear here.':
    onlyFlagged.checked && !signalsById.size?signalEmptyMessage():'No suppliers match the current filters.';
  const pageCount=Math.ceil(list.length/registerPageSize);
  registerPage=Math.min(registerPage,Math.max(0,pageCount-1));
  const start=registerPage*registerPageSize, page=list.slice(start,start+registerPageSize);
  for (const row of page) {
    const tr=el('tr'), supplier=el('td');
    supplier.append(el('b',row.name||'Unnamed supplier'),el('small',row.duns||'No DUNS'));
    const level=signalsById.get(row.id);
    if (level) {
      const status=el('small'), dot=el('i',undefined,'dot signal-'+level);
      dot.setAttribute('aria-hidden','true');
      status.append(dot,el('span',' '+signalLabels[level]));
      supplier.append(status);
    }
    const location=el('td',row.city||'No city');
    location.append(el('small',row.country||'No country'));
    const mapped=hasPoint(row), precision=el('td');
    const badge=mapped?(row.precision==='Approximate city'?'':'blue'):'warn';
    precision.append(el('span',row.precision,'badge '+badge));
    if (mapped) precision.append(el('small',row.lat.toFixed(4)+', '+row.lon.toFixed(4)));
    const review=el('td');
    review.append(el('small',row.warnings.length?row.warnings.join(' · '):mapped?row.source:'Location not resolved'));
    const actions=el('td');
    if (mapped) {
      const show=el('button','Show on map','quiet smallbtn');
      show.onclick=()=>focusSupplier(row);
      actions.append(show);
    }
    const editLocation=el('button','Review','quiet');
    editLocation.setAttribute('data-edit','');
    editLocation.disabled=!canEdit()||saving||loading||busy||!loaded;
    editLocation.onclick=()=>edit(row.id);
    actions.append(editLocation);
    tr.append(supplier,location,precision,review,actions);
    body.append(tr);
  }
  $('rowCount').textContent=list.length.toLocaleString()+' of '+rows.length.toLocaleString()+' suppliers'+
    (pageCount>1?' · '+(start+1).toLocaleString()+'–'+(start+page.length).toLocaleString()+' shown':'');
  $('registerPages').hidden=pageCount<2;
  $('previousRows').disabled=registerPage===0;
  $('nextRows').disabled=registerPage+1>=pageCount;
}
function svg(tag,attrs){const e=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))e.setAttribute(k,v);return e;}
function closeMapPopup() {
  selectedReport = '';
  linkedPopupRow = null;
  $('mapPopup').hidden=true;
  $('mapPopup').replaceChildren();
}
function updateSignals(groups,{state}={state:'idle'}) {
  const previousState=screeningState;
  screeningState=state;
  const changed=groups.length!==signalsById.size || groups.some(group=>signalsById.get(group.supplier.id)!==group.level);
  if (!changed && state===previousState) return;
  if (changed) {
    const previousLevel = linkedPopupRow && signalsById.get(linkedPopupRow.id);
    signalsById=new Map(groups.filter(group=>group.level==='red'||group.level==='yellow').map(group=>[group.supplier.id,group.level]));
    if (linkedPopupRow && !$('mapPopup').hidden && rows.includes(linkedPopupRow) &&
        (!onlyFlagged.checked || signalsById.has(linkedPopupRow.id))) {
      if (previousLevel !== signalsById.get(linkedPopupRow.id)) popup([linkedPopupRow], true);
    } else if (!selectedReport) closeMapPopup();
  }
  renderTable();
  renderDots();
  if (onlyFlagged.checked && signalsById.size && previousState==='scanning' && state!=='scanning' && !linkedDuns() && !selectedReport && !pendingReport) fit();
  openLinkedSupplier();
  openLinkedReport();
}
function mapDisplayRows() {
  return displayRows().map(row => signalsById.has(row.id) ? {...row, screeningLevel:signalsById.get(row.id)} : row);
}
if (typeof ResizeObserver === 'function') {
  new ResizeObserver(() => { if (!detailReady && identity && rows.length) renderDots(); }).observe($('mapwrap'));
}
function renderDots() {
  const displayRows = mapDisplayRows();
  const mapped=displayRows.filter(hasPoint);
  $('mapVisibleCount').textContent=mapped.length.toLocaleString()+' of '+rows.length.toLocaleString()+' suppliers on map'+(reportLocations.length ? ' · '+reportLocations.length+' company report'+(reportLocations.length===1?'':'s') : '');
  $('reportLegend').hidden=!reportLocations.length;
  $('mapTitle').textContent=reportLocations.length?'Supplier and company locations':'Supplier locations';
  $('neutralLegend').hidden=onlyFlagged.checked;
  $('emptyMap').hidden=!!(mapped.length || reportLocations.length);
  if (!mapped.length) {
    const noSignals=rows.length && onlyFlagged.checked && !displayRows.length;
    $('emptyMapTitle').textContent=noSignals?signalEmptyMessage():'No mapped suppliers';
    $('emptyMapHint').textContent=!rows.length?'Import a list to place your suppliers on the map.':
      noSignals?'Clear “Yellow or red suppliers only” to show all suppliers.':'Review the locations in the supplier register.';
  }
  detailMap?.update(displayRows);
  const dots = $('dots');
  dots.replaceChildren();
  if (detailReady) return;
  const groups = new Map();
  const rect = $('map').getBoundingClientRect();
  const scale = rect.width && rect.height ? Math.max(view[2]/rect.width, view[3]/rect.height) : view[2]/1000;
  for (const row of mapped) {
    const p = point(row.lat,row.lon);
    const key = Math.round(p.x / (18 * scale)) + ',' + Math.round(p.y / (18 * scale));
    if (!groups.has(key)) groups.set(key, {members:[], x:0, y:0, level:'neutral'});
    const group = groups.get(key), level = row.screeningLevel || 'neutral';
    group.members.push(row);
    group.x += p.x; group.y += p.y;
    if (levelOrder[level] > levelOrder[group.level]) group.level = level;
  }
  // Draw flagged clusters last so nearby neutral markers cannot cover them.
  const sorted = [...groups.values()].sort((a,b) => levelOrder[a.level] - levelOrder[b.level]);
  for (const {members,x,y,level} of sorted) {
    const count = members.length;
    const label = count === 1 ? members[0].name + ', ' + members[0].city :
      count + ' suppliers near ' + members[0].city;
    const pin = svg('g', {transform:'translate('+x/count+' '+y/count+')', tabindex:0, role:'button',
      'aria-label':label+' · '+signalLabels[level]});
    pin.append(svg('circle',{r:(count > 1 ? 10 : level === 'neutral' ? 4.5 : 6.5)*scale,
      fill:signalColors[level],stroke:level === 'yellow' ? '#705617' : '#fff','stroke-width':1.4*scale}));
    if (count > 1) {
      const number = svg('text',{x:0,y:0,style:'font-size:'+10*scale+'px;fill:'+(level === 'yellow' ? '#211a08' : '#fff')});
      number.textContent = count;
      pin.append(number);
    }
    pin.append(svg('circle',{r:12*scale,fill:'transparent'}));
    pin.onclick = event => { event.stopPropagation(); popup(members); };
    pin.onkeydown = event => { if (['Enter',' '].includes(event.key)) { event.preventDefault(); popup(members); } };
    dots.append(pin);
  }
  for (const report of reportLocations) {
    const p = point(report.lat,report.lon);
    const pin = svg('g', {transform:'translate('+p.x+' '+p.y+')',tabindex:0,role:'button',
      'aria-label':report.name+', '+report.city+' · Company report'});
    pin.append(svg('circle',{r:7*scale,fill:'#2869bb',stroke:'#fff','stroke-width':1.7*scale}));
    pin.append(svg('circle',{r:12*scale,fill:'transparent'}));
    pin.onclick = event => { event.stopPropagation(); focusReport(report.id); };
    pin.onkeydown = event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); focusReport(report.id); }
    };
    dots.append(pin);
  }
}
function focusSupplier(row, linked=false){if(!hasPoint(row)||(onlyFlagged.checked&&!signalsById.has(row.id)))return;pendingDuns='';if(detailReady&&detailMap)detailMap.focus(row);else{const p=point(row.lat,row.lon);setView([p.x-22.5,p.y-11.25,45,22.5]);}popup([row], linked);$('mapwrap').scrollIntoView?.({behavior:'smooth',block:'center'});}
function popup(members, linked=false) {
  pendingDuns = '';
  pendingReport = '';
  selectedReport = '';
  linkedPopupRow = linked ? members[0] : null;
  const box = $('mapPopup');
  box.replaceChildren();
  const close = el('button','×','close');
  close.setAttribute('aria-label','Close');
  close.onclick = () => { box.hidden = true; };
  box.append(close);
  if (members.length > 1) box.append(el('b',members.length+' suppliers'));
  const level = row => signalsById.get(row.id) || 'neutral';
  const ordered = [...members].sort((a,b) => levelOrder[level(b)] - levelOrder[level(a)]);
  for (const row of ordered.slice(0,30)) {
    const item = el('div');
    item.style.marginTop = '10px';
    item.append(el('b',row.name),el('div',[row.city,row.country].filter(Boolean).join(', ')),el('small','DUNS '+row.duns));
    if (signalsById.has(row.id)) {
      const status = el('div'), dot = el('i',undefined,'dot signal-'+level(row));
      dot.setAttribute('aria-hidden','true');
      status.append(dot,el('span',' '+signalLabels[level(row)]));
      const evidence = el('button','View screening evidence','textbutton');
      evidence.onclick = () => { if (screeningPanel.showSupplier(row.id)) box.hidden = true; };
      item.append(status,evidence);
    } else {
      item.append(el('small',row.precision));
    }
    if (canEdit()) {
      const editSite = el('button','Review location','textbutton');
      editSite.setAttribute('data-edit','');
      editSite.disabled = saving || loading || busy || !loaded;
      editSite.onclick = () => edit(row.id);
      item.append(el('br'),editSite);
    }
    box.append(item);
  }
  if (members.length > 30) box.append(el('p',(members.length-30)+' more suppliers. Open the register to see all rows.'));
  box.hidden = false;
}
function setView(v){view=v;$('map').setAttribute('viewBox',v.join(' '));renderDots();}
function zoom(f){if(detailReady&&detailMap)return detailMap.zoom(f);const w=Math.min(1500,Math.max(10,view[2]*f)),h=w/2;setView([view[0]+(view[2]-w)/2,view[1]+(view[3]-h)/2,w,h]);}
function fit(){if(detailReady&&detailMap)return detailMap.fit(mapDisplayRows());const pts=displayRows().filter(hasPoint).map(r=>point(r.lat,r.lon));if(!pts.length)return setView([0,0,1000,500]);const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y),xmin=Math.min(...xs),xmax=Math.max(...xs),ymin=Math.min(...ys),ymax=Math.max(...ys),w=Math.min(1100,Math.max(45,(xmax-xmin)*1.35,(ymax-ymin)*2.7));setView([(xmin+xmax-w)/2,(ymin+ymax-w/2)/2,w,w/2]);}
function edit(id){if(!editable())return;selected=rows.find(r=>r.id===id);if(!selected)return;$('editName').textContent=selected.name;$('editLocation').textContent=`${selected.city}, ${selected.country} · DUNS ${selected.duns}`;$('editLat').value=selected.lat??'';$('editLon').value=selected.lon??'';const list=$('candidateList');list.replaceChildren();if(selected.candidates?.length){list.append(el('p','Review the location candidates and select the correct city:'));for(const candidate of selected.candidates){const b=el('button',candidate.label,'quiet');b.type='button';b.onclick=()=>{if(!editable()||!selected)return;chooseCandidate(selected,candidate);changed();$('editDialog').close();render();notice('City selected. This dot is approximate.');};list.append(b);}}$('editDialog').showModal();}
function importText(text){if(!editable())return;try{const imported=parseSuppliers(text);if(rows.length&&!confirm('Replace the working list with this import? The shared list changes only when you save.'))return;for(const r of imported)offlineMatch(r);rows=imported;$('search').value='';$('statusFilter').value='';$('countryFilter').value='';$('mapPopup').hidden=true;changed();render();fit();notice('Imported '+rows.length+' suppliers. '+rows.filter(hasPoint).length+' mapped; '+rows.filter(r=>!hasPoint(r)).length+' need review. Save shared list to keep these changes.');}catch(e){notice(e.message,true);}}
async function locate(){if(!editable())return;const requestEpoch=epoch;if(!$('lookupConsent').checked){notice('Select the city + country lookup checkbox first.',true);return;}const candidates=rows.filter(r=>!hasPoint(r)&&r.city&&r.country&&!r.candidates?.length);const keys=[...new Set(candidates.map(r=>norm(r.country)+'|'+norm(r.city)))].slice(0,20);if(!keys.length){notice('No unresolved city names to look up. Review ambiguous matches in the register.');return;}busy=true;cancel=false;controls();$('cancelButton').hidden=false;$('locateButton').disabled=true;let count=0;try{for(const key of keys){if(cancel||requestEpoch!==epoch)break;const r=candidates.find(r=>norm(r.country)+'|'+norm(r.city)===key);let matches=cache.get(key);if(!matches){const pause=Math.max(0,1200-(Date.now()-lastLookupAt));if(pause)await new Promise(res=>setTimeout(res,pause));if(cancel||requestEpoch!==epoch)break;const url=new URL('https://nominatim.openstreetmap.org/search');url.searchParams.set('city',r.city);url.searchParams.set('country',r.country);url.searchParams.set('format','jsonv2');url.searchParams.set('addressdetails','1');url.searchParams.set('limit','5');const code=getCode(r.country);if(code)url.searchParams.set('countrycodes',code.toLowerCase());notice(`Looking up ${++count}/${keys.length}: ${r.city}, ${r.country}…`);lastLookupAt=Date.now();lookupAbort=new AbortController();const timer=setTimeout(()=>lookupAbort?.abort(),15000);let response;try{response=await fetch(url,{signal:lookupAbort.signal,credentials:'omit',referrerPolicy:'strict-origin-when-cross-origin'});}finally{clearTimeout(timer);}if(requestEpoch!==epoch||cancel)break;if(!response.ok)throw Error(`Lookup service returned ${response.status}. Existing locations are preserved; try later or enter coordinates.`);const results=await response.json();matches=results.filter(m=>String(m.lat??'').trim()!==''&&String(m.lon??'').trim()!==''&&Number.isFinite(Number(m.lat))&&Number.isFinite(Number(m.lon))&&Math.abs(Number(m.lat))<=90&&Math.abs(Number(m.lon))<=180&&(!code||m.address?.country_code?.toUpperCase()===code)).map(m=>({lat:Number(m.lat),lon:Number(m.lon),label:m.display_name,source:'OpenStreetMap Nominatim'}));matches=[...new Map(matches.map(m=>[m.lat+','+m.lon,m])).values()];if(requestEpoch!==epoch||cancel)break;cache.set(key,matches);}for(const match of candidates.filter(a=>norm(a.country)+'|'+norm(a.city)===key)){match.candidates=matches;match.precision=matches.length?'Review city match':'Unresolved';}changed();render();}if(requestEpoch!==epoch)return;notice(cancel?'Lookup stopped. Completed locations are preserved.':'Lookup complete. Review unmatched or ambiguous rows; save to keep your list.');}catch(e){if(requestEpoch!==epoch)return;notice(cancel?'Lookup stopped.':e.message==='Failed to fetch'?'City lookup is unavailable. Use offline matches or enter coordinates in Review.':e.message,true);}finally{if(requestEpoch===epoch){busy=false;lookupAbort=null;$('cancelButton').hidden=true;controls();}}}
$('importButton').onclick=()=>importText($('pasteInput').value);
$('fileInput').onchange=async e=>{if(!editable())return;const requestEpoch=epoch;const f=e.target.files[0];if(!f)return;if(f.size>15000000){e.target.value='';return notice('File is too large. Use a CSV below 15 MB.',true);}try{const text=await f.text();if(requestEpoch===epoch)importText(text);}catch{notice('The file could not be read. Try a CSV or paste your table.',true);}finally{e.target.value='';}};
$('templateButton').onclick=()=>download('supplier-template.csv','Name,DUNS,Country,City,Latitude,Longitude\r\n');
$('exportButton').onclick=()=>{if(identity)download('supplier-locations.csv',csvExport(filtered()));};
$('locateButton').onclick=locate;$('cancelButton').onclick=()=>{cancel=true;lookupAbort?.abort();};
$('saveButton').onclick=saveShared;$('reloadButton').onclick=loadShared;
$('clearButton').onclick=()=>{if(!editable())return;if(rows.length&&!confirm('Clear the working list? Click Save shared list afterwards to remove it for everyone.'))return;rows=[];cache.clear();$('pasteInput').value='';$('mapPopup').hidden=true;changed();render();if(detailReady)detailMap.world();else setView([0,0,1000,500]);notice('Working list cleared. This is unsaved; reload to restore the shared list or save to clear it for everyone.');};
onlyFlagged.onchange=()=>{registerPage=0;closeMapPopup();renderTable();renderDots();fit();};
for(const id of ['search','countryFilter','statusFilter'])$(id).addEventListener('input',()=>{registerPage=0;renderTable();});
$('previousRows').onclick=()=>{if(registerPage>0){registerPage--;renderTable();}};
$('nextRows').onclick=()=>{if(!$('nextRows').disabled){registerPage++;renderTable();}};
$('worldButton').onclick=()=>detailReady?detailMap.world():setView([0,0,1000,500]);$('europeButton').onclick=()=>detailReady?detailMap.europe():setView([440,60,220,110]);$('fitButton').onclick=fit;$('zoomIn').onclick=()=>zoom(.7);$('zoomOut').onclick=()=>zoom(1.4);
$('closeEdit').onclick=()=>$('editDialog').close();
$('removeLocation').onclick=()=>{if(!editable()||!selected)return;selected.lat=null;selected.lon=null;selected.precision='Unresolved';selected.source='';selected.candidates=[];$('editDialog').close();changed();render();};
$('editForm').onsubmit=e=>{e.preventDefault();if(!editable()||!selected)return;const lat=Number($('editLat').value),lon=Number($('editLon').value);if(!$('editLat').value.trim()||!$('editLon').value.trim()||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)return;selected.lat=lat;selected.lon=lon;selected.precision='Provided coordinates';selected.source='Manually supplied; not independently verified';selected.candidates=[];selected.warnings=selected.warnings.filter(w=>w!=='Invalid coordinates');$('editDialog').close();changed();render();notice('Coordinates updated. Save shared list to keep this change.');};
$('helpButton').onclick=()=>$('helpDialog').showModal();$('closeHelp').onclick=()=>$('helpDialog').close();
$('loginForm').onsubmit=async event=>{event.preventDefault();if(!auth||$('loginButton').disabled)return;const requestEpoch=++epoch;$('loginButton').disabled=true;$('authNotice').textContent='Signing in…';try{const member=await auth.signIn($('loginEmail').value.trim(),$('loginPassword').value);if(requestEpoch===epoch)await openWorkspace(member);}catch(e){if(requestEpoch===epoch){lock(e.message);$('loginPassword').value='';}}finally{$('loginButton').disabled=false;}};
$('logoutButton').onclick=async()=>{if(dirty&&!confirm('Sign out and discard unsaved changes?'))return;lock('You have signed out.');await auth?.signOut();$('loginPassword').value='';};
let drag=null;$('map').addEventListener('pointerdown',e=>{if(e.button!==0||e.target.closest('#dots'))return;drag={x:e.clientX,y:e.clientY,v:[...view]};$('map').setPointerCapture(e.pointerId);});$('map').addEventListener('pointermove',e=>{if(!drag)return;const rect=$('map').getBoundingClientRect(),scale=Math.min(rect.width/drag.v[2],rect.height/drag.v[3]);if(!scale)return;setView([drag.v[0]-(e.clientX-drag.x)/scale,drag.v[1]-(e.clientY-drag.y)/scale,drag.v[2],drag.v[3]]);});$('map').addEventListener('pointerup',()=>drag=null);$('map').addEventListener('pointercancel',()=>drag=null);$('map').addEventListener('lostpointercapture',()=>drag=null);$('map').addEventListener('wheel',e=>{e.preventDefault();zoom(e.deltaY>0?1.12:.89);},{passive:false});$('map').addEventListener('keydown',e=>{if(e.target!==$('map'))return;const step=view[2]*.08;if(e.key==='+'||e.key==='=')zoom(.7);else if(e.key==='-')zoom(1.4);else if(e.key==='Home')setView([0,0,1000,500]);else if(e.key==='ArrowLeft')setView([view[0]-step,view[1],view[2],view[3]]);else if(e.key==='ArrowRight')setView([view[0]+step,view[1],view[2],view[3]]);else if(e.key==='ArrowUp')setView([view[0],view[1]-step,view[2],view[3]]);else if(e.key==='ArrowDown')setView([view[0],view[1]+step,view[2],view[3]]);else return;e.preventDefault();});document.addEventListener('keydown',e=>{if(e.key==='Escape')$('mapPopup').hidden=true;});
async function loadCities(){
 const manifestResponse=await fetch('./cities/manifest.json');if(!manifestResponse.ok)throw Error('City index unavailable.');const manifest=await manifestResponse.json();
 if(!Array.isArray(manifest.parts)||!manifest.parts.length||manifest.parts.length>1000||!Number.isSafeInteger(manifest.recordCount)||manifest.recordCount<1||manifest.parts.some(path=>typeof path!=='string'||!/^part-\d{3,}\.json$/.test(path))||new Set(manifest.parts).size!==manifest.parts.length)throw Error('City index is invalid.');
 const chunks=new Array(manifest.parts.length);let next=0;
 const workers=Array.from({length:Math.min(4,manifest.parts.length)},async()=>{while(next<manifest.parts.length){const index=next++,response=await fetch('./cities/'+manifest.parts[index]);if(!response.ok)throw Error('City data unavailable.');const chunk=await response.json();if(!Array.isArray(chunk)||chunk.some(row=>!Array.isArray(row)))throw Error('City data is invalid.');chunks[index]=chunk;}});
 const outcomes=await Promise.allSettled(workers);if(outcomes.some(result=>result.status==='rejected'))throw Error('City data did not fully load.');
 const records=chunks.flat();if(records.length!==manifest.recordCount)throw Error('City data is incomplete.');return records;
}

function showDetailedMap(ready){
 detailReady=ready;
 $('mapwrap').classList.toggle('enhanced-map-ready',ready);
 $('map').hidden=ready;
 $('fallbackAttribution').hidden=ready;
}
function stopDetailedMap(){
 detailLoading=false;mapAttempt++;mapAbort?.abort();mapAbort=null;
 const previous=detailMap;detailMap=null;try{previous?.destroy();}catch{}
 showDetailedMap(false);
 $('detailMap').replaceChildren();
 $('mapStatus').textContent='';
}
async function startDetailedMap(requestEpoch){
 detailLoading=true;
 const attempt=++mapAttempt;
 mapAbort?.abort();const abort=new AbortController();mapAbort=abort;
 const current=()=>attempt===mapAttempt&&requestEpoch===epoch&&!!identity;
 let ready=false;
 $('mapStatus').textContent='Loading detailed map…';
 try{
  const controller=await createSupplierMap({
   container:$('detailMap'),signal:abort.signal,
   onReportSelect:id=>{if(current())focusReport(id);},
   onSelect:ids=>{if(current()){const selectedIds=new Set(ids);const selected=displayRows().filter(r=>selectedIds.has(r.id));if(selected.length)popup(selected);}},
   onStatus:(message,error=false)=>{if(current()){$('mapStatus').textContent=message;$('mapStatus').classList.toggle('map-error',error);}},
   onReady:()=>{ready=true;if(current()&&detailMap){showDetailedMap(true);detailMap.update(mapDisplayRows());detailMap.fit(mapDisplayRows());}}
  });
  if(!current()){controller.destroy();return;}
  detailMap=controller;
  detailMap.updateReports?.(reportLocations);
  detailMap.update(mapDisplayRows());
  if(ready){showDetailedMap(true);detailMap.resize();detailMap.fit(mapDisplayRows());}
 }catch(error){
  if(!current())return;
  detailMap?.destroy();detailMap=null;showDetailedMap(false);
  $('detailMap').replaceChildren();
  $('mapStatus').textContent='Detailed maps are unavailable. The basic world map still works; reload to retry.';
  $('mapStatus').classList.toggle('map-error',true);
 } finally {
  if(current()){detailLoading=false;openLinkedSupplier();openLinkedReport();}
 }
}

async function initializeMap(){const results=await Promise.allSettled([fetch('./world-map.json').then(r=>{if(!r.ok)throw Error();return r.json();}),loadCities()]);if(results[0].status==='fulfilled')world=results[0].value;for(const c of world)$('countries').append(svg('path',{d:c.d}));if(results[1].status==='fulfilled')cities=results[1].value;buildIndex();if(results.some(r=>r.status==='rejected'))notice('Some map resources could not load. Imported coordinates still work; reload to retry.',true);}
let mapReady=null;
function prepareMap(){return mapReady??=initializeMap().catch(()=>notice('Map resources could not load. Reload to try again.',true));}
async function start(){controls();try{const response=await fetch('./config.json',{cache:'no-store'});if(!response.ok)throw Error('Login setup is not finished yet. The supplier workspace remains locked.');const config=configured(await response.json());if(!config)throw Error('Login setup is not finished yet. The supplier workspace remains locked until the account service is connected.');let storage=null;try{storage=sessionStorage;}catch{}auth=new AuthClient(config,{storage});$('loginForm').hidden=false;$('authNotice').textContent='Sign in with your invited account.';if(auth.session){try{await openWorkspace(await auth.verify());}catch(e){lock(e.message);await auth.signOut();}}}catch(e){$('loginForm').hidden=true;lock(e.message);}render();}start();
