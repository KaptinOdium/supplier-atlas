import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {norm,parseSuppliers,csvExport,point} from '../docs/core.mjs';
import {AccessError,ConflictError,configured} from '../docs/auth-core.mjs';

import {createScreeningPanel} from '../docs/screening-panel.mjs';
import {matchSuppliers} from '../docs/screen-matches.mjs';
import {decisionNames} from '../docs/screen-policy.mjs';
import {loadHazardLeads,hazardSourceURL} from '../docs/screen-hazards.mjs';
const source=await readFile(new URL('../docs/app.mjs',import.meta.url),'utf8');
const html=await readFile(new URL('../docs/index.html',import.meta.url),'utf8');
class Element {
  constructor(id=''){this.id=id;this.value='';this.hidden=false;this.disabled=false;this.checked=false;this.textContent='';this.children=[];this.style={};this.attrs={};this.classList={toggle(){}};this.listeners={};this.open=false;}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=nodes;}
  add(node){this.append(node);}
  setAttribute(k,v){this.attrs[k]=v;}
  addEventListener(k,v){this.listeners[k]=v;}
  setPointerCapture(){}
  getBoundingClientRect(){return {width:300,height:600};}
  showModal(){this.open=true;}
  close(){this.open=false;}
}
async function fixture({hash='',configuredService=true,role='owner',loadFailure=false,cityPartCount=1,failedCityPart=null,detailedMap=false,deferMap=false,teardownFailure=false,assess=()=>"",hazardLoad=async()=>{throw Error("Unavailable");},gdacsLoad=async()=>{throw Error("Unavailable");},opsLoad=async()=>{throw Error("Unavailable");},sharedRows=[],projectLoad=async()=>null,
  agentLoad=async({start})=>start ? {checkedAt:new Date().toISOString(),sourcesChecked:2,sourcesFailed:[],model:'test',reports:[]} : null}={}){
  const nodes=new Map([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Element(m[1])]));
  nodes.get('onlyFlagged').checked=/<input id="onlyFlagged"[^>]*\bchecked\b/.test(html);
  nodes.get('workspaceMain').hidden=true;nodes.get('loginForm').hidden=true;
  const editable=new Set([...html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*data-edit[^>]*>/g)].map(m=>nodes.get(m[1])));
  let saves=0,identity=null;
  const mapCalls={created:0,destroyed:0,updates:[],fits:[],focused:[],options:null};
  let completeMap;
  const createSupplierMap=async options=>{
    mapCalls.created++;mapCalls.options=options;
    if(!detailedMap)throw Error('Detailed map unavailable in this fixture.');
    const controller={update:rows=>mapCalls.updates.push(structuredClone(rows)),fit:rows=>mapCalls.fits.push(structuredClone(rows)),focus:row=>mapCalls.focused.push(row.id),destroy:()=>{mapCalls.destroyed++;if(teardownFailure)throw Error('Map teardown failed');},resize(){},world(){},europe(){},zoom(){}};
    if(deferMap)await new Promise(resolve=>completeMap=resolve);
    options.onReady();return controller;
  };
  const dataset={id:'main',revision:2,suppliers:sharedRows};
  class Auth {
    constructor(){this.session=null;}
    async signIn(email,password){if(password!=='valid-password')throw new AccessError('Sign-in failed.');return {id:'member',email,name:'Test member',role};}
    async signOut(){this.session=null;}
    async loadScreeningRegister(){return projectLoad();}
    async loadAgentScan(options){return agentLoad(options);}
    async verify(){return {id:'member',email:'member@example.com',name:'Test member',role};}
    async loadShared(){if(loadFailure)throw Error('Service unavailable.');return structuredClone(dataset);}
    async saveShared(rows,revision){saves++;assert.equal(revision,dataset.revision);dataset.suppliers=structuredClone(rows);dataset.revision++;return structuredClone(dataset);}
  }
  let cityRequests=0,maxCityRequests=0,totalCityRequests=0;
  const requestedPaths=[];
  const parts=Array.from({length:cityPartCount},(_,i)=>'part-'+String(i+1).padStart(3,'0')+'.json');
  const fetcher=async path=>{
    requestedPaths.push(String(path));
    if(path==='./config.json')return {ok:true,json:async()=>configuredService?{supabaseUrl:'https://test.supabase.co',supabaseAnonKey:'sb_publishable_test'}:{}};
    if(path==='./cities/manifest.json')return {ok:true,json:async()=>({recordCount:parts.length,parts})};
    if(path.startsWith('./cities/part-')){
      totalCityRequests++;cityRequests++;maxCityRequests=Math.max(maxCityRequests,cityRequests);
      await new Promise(resolve=>setTimeout(resolve,0));cityRequests--;
      return {ok:!path.endsWith(failedCityPart||'MISSING'),json:async()=>[['Prague','Prague','Praha',50.0755,14.4378,'CZ','52']]};
    }
    if(path==='./world-map.json')return {ok:true,json:async()=>[]};
    throw Error('Unexpected fetch '+path);
  };
  const windowListeners = {};
  const window = {location:{hash},addEventListener:(event,listener)=>{windowListeners[event]=listener;}};
  const context=vm.createContext({createScreeningPanel,projectAssessment:assess,loadHazardLeads:hazardLoad,loadGdacs:gdacsLoad,loadOperationalLeads:opsLoad,matchSuppliers,readPrivateRegister:JSON.parse,console,Map,Set,Intl,Number,String,Object,Array,Math,Date,URL,Blob,AbortController,AbortSignal,Promise,Error,Option:class extends Element{constructor(text,value){super();this.textContent=text;this.value=value;}},norm,parseSuppliers,csvExport,point,AccessError,ConflictError,configured,AuthClient:Auth,createSupplierMap,setIdentity:v=>identity=v,confirm:()=>true,setInterval:()=>0,setTimeout,clearTimeout,sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},window,document:{visibilityState:'visible',getElementById:id=>{if(!nodes.has(id))throw Error('Missing DOM id '+id);return nodes.get(id);},querySelectorAll:()=>[...editable,...[...nodes.values()].flatMap(n=>n.children).filter(n=>n?.attrs?.['data-edit']!==undefined)],createElement:()=>new Element(),createElementNS:()=>new Element(),addEventListener(){}},fetch:fetcher});
  vm.runInContext(source.replace(/^import .*;\r?\n/gm,'').replace(/start\(\);\s*$/,'globalThis.ready=start();')+'\nglobalThis.state=()=>({rows,dirty,identity,loaded,view,detailReady});',context);
  await context.ready;
  const login=async password=>{nodes.get('loginEmail').value='member@example.com';nodes.get('loginPassword').value=password;await nodes.get('loginForm').onsubmit({preventDefault(){}});};
  return {nodes,context,login,mapCalls,requestedPaths,setHash(value){window.location.hash=value;windowListeners.hashchange();},setRole:value=>{role=value;},completeMap:()=>completeMap?.(),saves:()=>saves,identity:()=>identity,cityRequests:()=>totalCityRequests,maxCityRequests:()=>maxCityRequests};
}
test('unconfigured deployment stays locked and does not offer a pretend login',async()=>{const f=await fixture({configuredService:false});assert.equal(f.nodes.get('workspaceMain').hidden,true);assert.equal(f.nodes.get('loginForm').hidden,true);assert.match(f.nodes.get('authNotice').textContent,/setup is not finished/i);assert.equal(f.context.state().rows.length,0);});
test('failed login stays locked and clears password',async()=>{const f=await fixture();await f.login('wrong');assert.equal(f.nodes.get('workspaceMain').hidden,true);assert.equal(f.nodes.get('loginPassword').value,'');assert.equal(f.identity(),null);});
test('owner imports DUNS safely, maps an offline city, and saves only on explicit action',async()=>{const f=await fixture();await f.login('valid-password');assert.equal(f.nodes.get('workspaceMain').hidden,false);f.nodes.get('pasteInput').value='Name,DUNS,Country,City\nSupplier A,001234567,Czechia,Praha';f.nodes.get('importButton').onclick();assert.equal(f.context.state().rows[0].duns,'001234567');assert.equal(f.context.state().rows[0].lat,50.0755);assert.equal(f.context.state().rows[0].precision,'Approximate city');assert.equal(f.saves(),0);assert.equal(f.context.state().dirty,true);await f.nodes.get('saveButton').onclick();assert.equal(f.saves(),1);assert.equal(f.context.state().dirty,false);});
test('viewer cannot import or save even if handlers are invoked directly',async()=>{const f=await fixture({role:'viewer'});await f.login('valid-password');f.nodes.get('pasteInput').value='Name,DUNS,Country,City\nSupplier A,001234567,Czechia,Praha';f.nodes.get('importButton').onclick();await f.nodes.get('saveButton').onclick();assert.equal(f.context.state().rows.length,0);assert.equal(f.saves(),0);assert.equal(f.nodes.get('importButton').disabled,true);});
test('failed initial dataset load does not allow editing an assumed empty list',async()=>{const f=await fixture({loadFailure:true});await f.login('valid-password');assert.equal(f.context.state().loaded,false);assert.equal(f.nodes.get('importButton').disabled,true);assert.match(f.nodes.get('saveState').textContent,/not loaded/);});
test('logout removes working supplier data and private form contents',async()=>{const f=await fixture();await f.login('valid-password');f.nodes.get('pasteInput').value='Name,DUNS,Country,City\nPrivate Supplier,001234567,Czechia,Praha';f.nodes.get('importButton').onclick();await f.nodes.get('logoutButton').onclick();assert.equal(f.context.state().rows.length,0);assert.equal(f.nodes.get('workspaceMain').hidden,true);assert.equal(f.nodes.get('pasteInput').value,'');assert.equal(f.nodes.get('tableBody').children.length,0);assert.equal(f.identity(),null);});
test('map dragging follows the pointer equally on both axes in a tall viewport',async()=>{const f=await fixture();const map=f.nodes.get('map');map.listeners.pointerdown({button:0,clientX:0,clientY:0,pointerId:1,target:{closest:()=>null}});map.listeners.pointermove({clientX:30,clientY:30});assert.deepEqual(Array.from(f.context.state().view),[-100,-100,1000,500]);map.listeners.lostpointercapture();map.listeners.pointermove({clientX:60,clientY:60});assert.deepEqual(Array.from(f.context.state().view),[-100,-100,1000,500]);});
test('correcting an invalid location clears only the resolved coordinate warning',async()=>{const f=await fixture();await f.login('valid-password');f.nodes.get('pasteInput').value='Name,DUNS,Country,City,Latitude,Longitude\nSupplier A,bad,Czechia,Praha,999,14\nSupplier B,001234567,Germany,Unknown town,999,14';f.nodes.get('importButton').onclick();const [offline,manual]=f.context.state().rows;assert.equal(offline.lat,50.0755);assert.equal(offline.warnings.length,1);assert.match(offline.warnings[0],/DUNS/);assert.equal(manual.warnings[0],'Invalid coordinates');f.context.edit(manual.id);f.nodes.get('editLat').value='52.5';f.nodes.get('editLon').value='13.4';f.nodes.get('editForm').onsubmit({preventDefault(){}});assert.equal(manual.lat,52.5);assert.equal(manual.warnings.length,0);});

test('city shards load only after login, with at most four requests active',async()=>{const f=await fixture({cityPartCount:9});assert.equal(f.cityRequests(),0);await f.login('valid-password');assert.equal(f.cityRequests(),9);assert.equal(f.maxCityRequests(),4);await f.nodes.get('logoutButton').onclick();await f.login('valid-password');assert.equal(f.cityRequests(),9);});
test('missing city shard disables offline matches while imported coordinates remain usable',async()=>{const f=await fixture({cityPartCount:5,failedCityPart:'part-002.json'});await f.login('valid-password');f.nodes.get('pasteInput').value='Name,DUNS,Country,City,Latitude,Longitude\nNeeds lookup,001234567,Czechia,Praha,,\nProvided,001234568,Czechia,Praha,50,14';f.nodes.get('importButton').onclick();assert.equal(f.context.state().rows[0].lat,null);assert.equal(f.context.state().rows[1].lat,50);assert.equal(f.context.state().loaded,true);});


test('detailed maps initialize only after successful login and keep all sites when the register is filtered',async()=>{
 const f=await fixture({detailedMap:true});assert.equal(f.mapCalls.created,0);
 await f.login('wrong');assert.equal(f.mapCalls.created,0);
 await f.login('valid-password');assert.equal(f.mapCalls.created,1);assert.equal(f.context.state().detailReady,true);
 f.nodes.get('pasteInput').value='Name,DUNS,Country,City,Latitude,Longitude\nSupplier A,001234567,Czechia,Prague,50,14\nSupplier B,001234568,Germany,Berlin,52,13';f.nodes.get('importButton').onclick();
 assert.equal(f.nodes.get('onlyFlagged').checked,true);
 assert.equal(f.mapCalls.updates.at(-1).length,0);
 const toggle=f.nodes.get('onlyFlagged');toggle.checked=false;toggle.onchange();
 assert.equal(f.mapCalls.updates.at(-1).length,2);
 f.nodes.get('search').value='Supplier B';f.nodes.get('search').listeners.input();
 assert.deepEqual(f.mapCalls.updates.at(-1).map(row=>row.name),['Supplier A','Supplier B']);assert.equal(f.nodes.get('tableBody').children.length,1);
 await f.nodes.get('logoutButton').onclick();assert.equal(f.mapCalls.destroyed,1);assert.equal(f.context.state().detailReady,false);assert.equal(f.nodes.get('map').hidden,false);
});
test('signing out during map startup discards the late map and keeps private details cleared',async()=>{
 const f=await fixture({detailedMap:true,deferMap:true});await f.login('valid-password');
 await f.nodes.get('logoutButton').onclick();f.completeMap();await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(f.mapCalls.destroyed,1);assert.equal(f.mapCalls.updates.length,0);assert.equal(f.context.state().detailReady,false);assert.equal(f.nodes.get('mapPopup').hidden,true);
});
test('a detailed-map failure leaves the basic map and working supplier list available',async()=>{
 const f=await fixture();await f.login('valid-password');
 assert.equal(f.context.state().detailReady,false);assert.equal(f.nodes.get('map').hidden,false);assert.match(f.nodes.get('mapStatus').textContent,/basic world map/);assert.equal(f.context.state().loaded,true);
});

test('sign-out still clears private data if map teardown fails',async()=>{const f=await fixture({detailedMap:true,teardownFailure:true});await f.login('valid-password');f.nodes.get('pasteInput').value='Name,DUNS,Country,City\nPrivate Supplier,001234567,Czechia,Praha';f.nodes.get('importButton').onclick();await f.nodes.get('logoutButton').onclick();assert.equal(f.context.state().rows.length,0);assert.equal(f.identity(),null);assert.equal(f.nodes.get('workspaceMain').hidden,true);assert.equal(f.nodes.get('mapPopup').hidden,true);});
const supplierRow = (id,name) => ({id,name,duns:'01023456'+id.slice(-1),city:'Brno',country:'Czechia',warnings:[],lat:49,lon:16});
const today = new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const registerFor = (company,title='Reviewed factory incident',active=false) => ({
  asOf:today, watchlist:[],
  events:[{id:'action',title,company,country:'Czechia',site:'Brno',scope:'named-site',
    state:active?'ongoing':'risk',category:active?'industrial-accident':'flood',date:today,relevance:'supplier',
    screening:{decision:active?'candidate':'watch',operationalImpactVerified:active,
      reason:active?'Operator confirms production has stopped.':'Flooding reported near the site. Check operations.'},
    lastChecked:today,sources:[{name:'Employer statement',published:today,url:'https://example.org/notice'}]}],
  screeningRules:{summary:'Verify the named site.'},coverageNote:'Facility and authority notices reviewed.'
});
const nodeText = el => [el.textContent,...el.children.map(nodeText)].join(' ');
const descendants = el => [el,...el.children.flatMap(descendants)];
const settled = () => new Promise(resolve=>setTimeout(resolve,0));
const findings = f => f.nodes.get('screeningResults');
test('only an owner can export a prior browser list, keeping the shared list and local copy intact',async()=>{
  const f=await fixture({sharedRows:[supplierRow('s1','Current shared supplier')]});
  const storageKey='supplier-atlas-v1';
  const previous=supplierRow('s2','Prior private supplier');
  let reads=0;
  f.context.window.localStorage={
    length:1,key:i=>i===0?storageKey:null,
    getItem:key=>{assert.equal(key,storageKey);reads++;return JSON.stringify({rows:[previous],isDemo:false});}
  };
  const downloads=[];
  f.context.download=(name,csv)=>downloads.push({name,csv});
  const button=f.nodes.get('exportPreviousButton');
  assert.equal(button.hidden,true);
  button.onclick();assert.equal(reads,0);
  await f.login('valid-password');await settled();
  assert.equal(button.hidden,false);assert.equal(reads,0);
  button.onclick();
  assert.equal(reads,1);assert.equal(downloads[0].name,'previous-browser-suppliers.csv');
  assert.match(downloads[0].csv,/Prior private supplier/);assert.doesNotMatch(downloads[0].csv,/Current shared supplier/);
  assert.equal(f.context.state().rows[0].name,'Current shared supplier');assert.equal(f.saves(),0);assert.equal(f.context.state().dirty,false);
  f.context.window.localStorage.length=0;f.context.controls();assert.equal(button.hidden,true);
  f.context.window.localStorage.length=1;f.setRole('viewer');await f.context.recheck();
  assert.equal(button.hidden,true);button.onclick();assert.equal(reads,1);assert.equal(downloads.length,1);
});

function openEvidence(f) {
  for(const detail of descendants(findings(f)).filter(n=>n.className==='scan-evidence')) {
    detail.open=true;detail.listeners.toggle();
  }
  return nodeText(findings(f));
}

test('Atlas loads its own screening code and requests public incident feeds without sending supplier data',async()=>{
  const {loadGdacs}=await import('../docs/screen-gdacs.mjs');
  const forbidden=/auto[\s_-]*strike[\s_-]*watch|strike[\s_-]*core|screened-calendar\.json|\/api\/calendar|loadCalendar/i;
  assert.doesNotMatch(html,forbidden);
  const pending=[...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(m=>new URL(m[1],new URL('../docs/index.html',import.meta.url)));
  const checked=new Set();
  while(pending.length) {
    const url=pending.pop();
    if(checked.has(url.pathname)) continue;
    checked.add(url.pathname);
    const script=await readFile(url,'utf8');
    assert.doesNotMatch(script,forbidden,'Unexpected Auto Strike Watch dependency in '+url.pathname);
    for(const match of script.matchAll(/\bfrom\s+['"](\.[^'"]+)['"]/g)) pending.push(new URL(match[1],url));
  }
  const requests=[];
  const fetcher=async(url,options)=>{
    requests.push({url,options});
    return {ok:true,json:async()=>url===hazardSourceURL ? {count:0,incidents:[]} : {type:'FeatureCollection',features:[]}};
  };
  const f=await fixture({role:'viewer',sharedRows:[supplierRow('s1','Private Supplier')],
    hazardLoad:(rows,options)=>loadHazardLeads(rows,{...options,fetcher}),gdacsLoad:(rows,options)=>loadGdacs(rows,{...options,fetcher})});
  await f.login('valid-password');await settled();
  await f.nodes.get('refreshScreening').onclick();
  for(const path of f.requestedPaths) assert.doesNotMatch(path,forbidden);
  const gdacsURL='https://www.gdacs.org/gdacsapi/api/events/geteventlist/events4app';
  assert.deepEqual(requests.map(r=>r.url).sort(),[gdacsURL,gdacsURL,hazardSourceURL,hazardSourceURL].sort());
  for(const {options} of requests) {
    assert.equal(options.method??'GET','GET');assert.equal(options.body,undefined);assert.equal(options.credentials,'omit');
  }
});

test('the full-list scan updates yellow and red suppliers regardless of the register search',async()=>{
  let projectRequests=0;
  const hazardRequests=[],gdacsRequests=[];
  const rows=[supplierRow('s1','Example Automotive GmbH'),supplierRow('s2','Elsewhere AG'),supplierRow('s3','Unflagged supplier')];
  const project=registerFor('Example Automotive','Plant fire stops production',true);
  project.watchlist.push({...registerFor('Elsewhere','Project flood watch').events[0],id:'flood'});
  const f=await fixture({sharedRows:rows,detailedMap:true,
    projectLoad:async()=>{projectRequests++;return project;},
    hazardLoad:async(list,options)=>{hazardRequests.push([list.length,options.force]);return {
      coverage:'Live sample',checkedAt:today,matches:[{supplier:list[0],event:project.events[0],decision:'unreviewed',kind:'locality',basis:'City only',reason:'Local hazard lead.'}]};},
    opsLoad:async()=>({matches:[],items:[],coverage:'Industry reports',checkedAt:today}),
    gdacsLoad:async(list,options)=>{gdacsRequests.push([list.length,options.force]);return {
      coverage:'Public disaster feed',checkedAt:today,matches:[{supplier:list[1],event:{...project.watchlist[0],title:'Cyclone report'},decision:'unreviewed',kind:'locality',basis:'Area warning',reason:'Verify access.'}]};}
  });
  assert.equal(projectRequests,0);
  assert.deepEqual(hazardRequests,[]);
  assert.deepEqual(gdacsRequests,[]);
  await f.login('valid-password');await settled();
  f.nodes.get('search').value='Elsewhere';f.nodes.get('search').listeners.input();
  await f.nodes.get('refreshScreening').onclick();
  assert.deepEqual(hazardRequests,[[3,false],[3,true]]);
  assert.deepEqual(gdacsRequests,[[3,false],[3,true]]);
  assert.equal(projectRequests,2);
  assert.match(f.nodes.get('scanStatus').textContent,/3 suppliers scanned.*1 red.*1 yellow/);
  assert.deepEqual(descendants(findings(f)).filter(n=>n.className==='scan-dot').map(n=>n.attrs['data-level']),['red','yellow']);
  const details=openEvidence(f);
  for(const expected of ['Example Automotive GmbH','Elsewhere AG','Active site incident','Needs review','Plant fire stops production','Project flood watch','Employer statement','Global Incident Tracker','Local hazard lead.','GDACS','Cyclone report']) assert.ok(details.includes(expected),expected);
  assert.match(f.nodes.get('scanCoverage').textContent,/partial.*private sources use saved reviews/i);
  assert.deepEqual(f.mapCalls.updates.at(-1).map(r=>r.screeningLevel),['red','yellow']);
  assert.match(f.nodes.get('mapVisibleCount').textContent,/2 of 3/);
  assert.equal(f.nodes.get('tableBody').children.length,1);
  const toggle=f.nodes.get('onlyFlagged');
  const downloads=[];
  f.context.download=(name,csv)=>downloads.push(csv);
  f.nodes.get('exportButton').onclick();
  assert.match(downloads[0],/Elsewhere/);
  assert.doesNotMatch(downloads[0],/Example Automotive|Unflagged/);
  f.nodes.get('fitButton').onclick();
  assert.deepEqual(f.mapCalls.fits.at(-1).map(r=>r.id),['s1','s2']);
  f.mapCalls.options.onSelect(['s2','s3']);
  assert.match(nodeText(f.nodes.get('mapPopup')),/Elsewhere/);
  assert.doesNotMatch(nodeText(f.nodes.get('mapPopup')),/Unflagged/);
  toggle.checked=false;toggle.onchange();
  assert.equal(f.nodes.get('mapPopup').hidden,true);
  assert.deepEqual(f.mapCalls.fits.at(-1).map(r=>r.id),['s1','s2','s3']);
  assert.equal(f.nodes.get('tableBody').children.length,1);
  assert.equal(hazardRequests.length,2);
  assert.ok(!f.context.state().rows.some(r=>Object.hasOwn(r,'screeningLevel')),'scan indicators are transient');
  assert.doesNotMatch(html,/id="checkTracker"/);
  f.nodes.get('pasteInput').value='Name,DUNS,Country,City\nNew Supplier,001234567,Czechia,Brno';
  f.nodes.get('importButton').onclick();await settled();
  assert.doesNotMatch(nodeText(findings(f)),/Example Automotive|Elsewhere/);
});

test('the fallback map and register distinguish a pending scan, partial coverage and unmapped matches',async()=>{
  let report;
  const rows=[supplierRow('s1','Neutral site'),{...supplierRow('s2','Yellow site'),lat:null,lon:null}];
  const f=await fixture({sharedRows:rows,projectLoad:()=>new Promise(resolve=>{report=resolve;})});
  await f.login('valid-password');
  assert.match(f.nodes.get('emptyMapTitle').textContent,/Scanning/);
  assert.match(f.nodes.get('emptyTable').textContent,/Scanning/);
  assert.equal(f.nodes.get('dots').children.length,0);
  report(registerFor('Unrelated supplier'));await settled();
  assert.match(f.nodes.get('emptyMapTitle').textContent,/No yellow or red.*partial/);
  assert.equal(f.nodes.get('neutralLegend').hidden,true);
  const file={name:'risk.json',size:1024,text:async()=>JSON.stringify(registerFor('Yellow site'))};
  await f.nodes.get('privateRegister').onchange({target:{files:[file]}});
  assert.match(nodeText(f.nodes.get('tableBody')),/Yellow site.*Needs review/);
  assert.doesNotMatch(nodeText(f.nodes.get('tableBody')),/Neutral/);
  assert.equal(f.nodes.get('emptyMap').hidden,false);
  assert.match(f.nodes.get('emptyMapHint').textContent,/Review the locations/);
  const toggle=f.nodes.get('onlyFlagged');toggle.checked=false;toggle.onchange();
  assert.equal(f.nodes.get('neutralLegend').hidden,false);
  assert.equal(f.nodes.get('dots').children.length,1);
  assert.match(f.nodes.get('mapVisibleCount').textContent,/1 of 2/);
  f.nodes.get('dots').children[0].onclick({stopPropagation(){}});
  assert.match(nodeText(f.nodes.get('mapPopup')),/Neutral site/);
  toggle.checked=true;toggle.onchange();
  assert.equal(f.nodes.get('mapPopup').hidden,true);
  assert.equal(f.nodes.get('dots').children.length,0);
  assert.equal(f.nodes.get('tableBody').children.length,1);
});

test('register pagination and export follow the displayed suppliers without truncating the file',async()=>{
  const rows=Array.from({length:1001},(_,i)=>supplierRow('s'+(i+1),'Site '+String(i+1).padStart(4,'0')));
  const f=await fixture({sharedRows:rows,detailedMap:true});
  await f.login('valid-password');await settled();
  assert.match(f.nodes.get('emptyMapTitle').textContent,/sources are unavailable/);
  const toggle=f.nodes.get('onlyFlagged');toggle.checked=false;toggle.onchange();
  assert.equal(f.nodes.get('tableBody').children.length,1000);
  assert.equal(f.nodes.get('registerPages').hidden,false);
  f.nodes.get('nextRows').onclick();
  assert.equal(f.nodes.get('tableBody').children.length,1);
  assert.match(nodeText(f.nodes.get('tableBody')),/Site 1001/);
  const downloads=[];f.context.download=(name,csv)=>downloads.push(csv);
  f.nodes.get('exportButton').onclick();
  assert.match(downloads[0],/Site 0001/);assert.match(downloads[0],/Site 1001/);
  toggle.checked=true;toggle.onchange();
  assert.equal(f.nodes.get('registerPages').hidden,true);
  assert.equal(f.nodes.get('tableBody').children.length,0);
  f.nodes.get('exportButton').onclick();
  assert.doesNotMatch(downloads[1],/Site /);
  toggle.checked=false;toggle.onchange();
  assert.match(nodeText(f.nodes.get('tableBody').children[0]),/Site 0001/);
});

test('partial or unavailable sources remain explicit and a local file can supply independent evidence',async()=>{
  const f=await fixture({sharedRows:[supplierRow('s1','Private Supplier')],
    projectLoad:async()=>{throw Error('Register unavailable.');}});
  await f.login('valid-password');await settled();
  assert.match(f.nodes.get('scanStatus').textContent,/unavailable/i);
  assert.match(f.nodes.get('scanCoverage').textContent,/unavailable/i);
  assert.doesNotMatch(nodeText(findings(f)),/no supplier signals/i);
  const file={name:'register.json',size:500,text:async()=>JSON.stringify(registerFor('Private Supplier','Private observation'))};
  await f.nodes.get('privateRegister').onchange({target:{files:[file]}});
  assert.match(openEvidence(f),/Private observation/);
  assert.equal(f.nodes.get('removeRegister').hidden,false);
  f.nodes.get('removeRegister').onclick();
  assert.doesNotMatch(nodeText(findings(f)),/Private observation|Private Supplier/);
  assert.equal(f.nodes.get('removeRegister').hidden,true);
});

test('signout discards delayed source and file responses without restoring signals',async()=>{
  let publicDone,projectDone,fileDone;
  const f=await fixture({sharedRows:[supplierRow('s1','Private Supplier')],
    hazardLoad:()=>new Promise(r=>publicDone=r),projectLoad:()=>new Promise(r=>projectDone=r)});
  await f.login('valid-password');
  const file={name:'private.json',size:5,text:()=>new Promise(r=>fileDone=r)};
  const uploading=f.nodes.get('privateRegister').onchange({target:{files:[file]}});
  await f.nodes.get('logoutButton').onclick();
  const project=registerFor('Private Supplier');
  publicDone({matches:[],coverage:'Public hazards'});projectDone(project);fileDone(JSON.stringify(project));
  await uploading;await settled();
  for(const id of ['screeningResults','screeningSources','scanStatus','scanCoverage','registerStatus']) assert.equal(nodeText(f.nodes.get(id)).trim(),'');
  assert.equal(f.nodes.get('refreshScreening').disabled,true);
});

test('viewers scan their authorized list without requesting private owner sources',async()=>{
  let ownerRequests=0,publicRequests=0;
  const event=registerFor('Example Automotive','Storm warning').events[0];
  const f=await fixture({role:'viewer',sharedRows:[supplierRow('s1','Example Automotive')],
    projectLoad:()=>{ownerRequests++;},hazardLoad:async list=>{
      publicRequests++;return {coverage:'Public sample',checkedAt:today,
        matches:[{supplier:list[0],event,decision:'unreviewed',kind:'locality',basis:'City only',reason:'Check the site.'}]};
    }});
  await f.login('valid-password');await settled();
  assert.match(f.nodes.get('scanStatus').textContent,/1 yellow/);
  assert.equal(ownerRequests,0);assert.equal(publicRequests,1);
  assert.match(nodeText(f.nodes.get('screeningSources')),/Global Incident Tracker/);
  assert.match(nodeText(f.nodes.get('screeningSources')),/requires owner access/);
});

test('membership downgrade discards the old scan and clears confidential results',async()=>{
  const outstanding=[];
  const f=await fixture({sharedRows:[supplierRow('s1','Private Supplier')],
    projectLoad:async()=>registerFor('Private Supplier','Restricted internal finding'),
    hazardLoad:()=>new Promise(resolve=>outstanding.push(resolve))});
  await f.login('valid-password');await settled();
  assert.match(openEvidence(f),/Restricted internal finding/);
  f.setRole('viewer');await f.context.recheck();await settled();
  assert.equal(outstanding.length,2);
  outstanding[1]({matches:[],coverage:'New public scan'});await settled();
  outstanding[0]({matches:[],coverage:'Stale scan'});await settled();
  assert.match(nodeText(f.nodes.get('screeningSources')),/New public scan/);
  assert.doesNotMatch(nodeText(f.nodes.get('screeningSources')),/Stale scan/);
  assert.doesNotMatch(nodeText(findings(f)),/Restricted internal finding/);
});

test('owner policy, source provenance, and individual provider decisions remain available after grouping',async()=>{
  let finishProject;
  const hazard=registerFor('Example Automotive','Public finding');
  const project={...registerFor('Example Automotive','Private finding'),assessmentPolicy:{version:'rules v2'},
    screeningRules:{thresholds:{naturalHazards:['Verify roads and power.']}},
    sourceRegistry:[{name:'Private alerting system',role:'Discovery',checkStatus:'Manual review only'}]};
  const f=await fixture({sharedRows:[supplierRow('s1','Example Automotive')],projectLoad:()=>new Promise(r=>finishProject=r),
    assess:(match,policy)=>policy.version+' / '+match.decision,
    hazardLoad:async list=>({coverage:'Live tracker sample',checkedAt:today,
      matches:[{supplier:list[0],event:hazard.events[0],decision:'unreviewed',kind:'locality',basis:'City only',reason:'Check facilities.'}]})});
  await f.login('valid-password');await settled();finishProject(project);await settled();
  assert.equal(descendants(findings(f)).filter(n=>n.className==='scan-evidence').length,1);
  const evidence=openEvidence(f);
  for(const expected of ['Public finding','Private finding',decisionNames.watch,'rules v2 / watch','rules v2 / unreviewed',decisionNames.unreviewed])assert.ok(evidence.includes(expected),expected);
  const coverage=nodeText(f.nodes.get('screeningSources'));
  for(const expected of ['Verify roads and power.','Private alerting system','Discovery','Manual review only'])assert.ok(coverage.includes(expected),expected);
});

test('one scan displays industry coverage without requiring a supplier match and filters findings without rescanning',async()=>{
  const rows=[supplierRow('a','Example Manufacturing'),supplierRow('b','Elsewhere')];
  const now=new Date().toISOString();
  const reports=['production','labor','logistics','cyber','quality','financial'].map((category,i)=>({
    id:'news-'+i,title:'Published '+category+' incident',category,publishedAt:now,publisher:'Example publisher',url:'https://example.org/'+i
  }));
  let calls=0;
  const f=await fixture({role:'viewer',sharedRows:rows,
    opsLoad:async list=>{calls++;return {checkedAt:now,items:reports,coverage:'6 reports',
      matches:[{supplier:list[0],event:{...reports[1],date:today,sources:[]},decision:'watch',kind:'company-only',reason:'Confirm the site.'}]};},
    hazardLoad:async list=>({checkedAt:now,matches:[{supplier:list[1],event:{id:'wx',title:'Storm warning',category:'storm',sources:[]},decision:'unreviewed',kind:'locality'}]})
  });
  assert.equal(calls,0);
  await f.login('valid-password');await settled();
  assert.equal(calls,1);
  assert.match(f.nodes.get('scanStatus').textContent,/2 suppliers scanned.*2 yellow/);
  const feed=f.nodes.get('industryList');
  for(const item of reports)assert.ok(nodeText(feed).includes(item.title));
  const industryFilter=f.nodes.get('industryFilter');
  industryFilter.value='cyber';industryFilter.onchange();
  assert.match(nodeText(feed),/Published cyber incident/);
  assert.doesNotMatch(nodeText(feed),/Published labor/);
  const findingFilter=f.nodes.get('findingsFilter');
  findingFilter.value='labor';findingFilter.onchange();
  assert.match(nodeText(findings(f)),/Example Manufacturing/);
  assert.doesNotMatch(nodeText(findings(f)),/Elsewhere/);
  assert.equal(calls,1);
  await f.nodes.get('logoutButton').onclick();
  assert.equal(nodeText(feed),'');assert.equal(f.nodes.get('industryStatus').textContent,'');
});

test('one deliberate click runs the agent, merges current reports and restores the last success after reload',async()=>{
  const stamp=new Date(Date.now()-60000).toISOString();
  const active={id:'one',category:'production',title:'Atlas Precision factory fire halts production',
    publishedAt:stamp,url:'https://example.org/factory',publisher:'Factory operator',entities:['Atlas Precision'],country:'Czechia',locality:'Brno'};
  const regional={id:'two',category:'regional',hazardType:'flood',title:'Flood watch for Brno',dateBasis:'updated',updatedAt:stamp,
    url:'https://example.org/flood',publisher:'Regional authority',country:'Czechia',locality:'Brno'};
  const publicOnly={id:'three',category:'production',title:'Foreign plant closure',publishedAt:stamp,publisher:'Company',
    url:'https://example.org/foreign',summary:'A restart date has not been announced.',
    evidence:[{name:'Local authority',url:'https://example.org/response',date:stamp,dateBasis:'updated'}]};
  let latest=null,finish,startCount=0,readCount=0;
  const options={role:'viewer',sharedRows:[supplierRow('s1','Atlas Precision')],
    agentLoad:async({start})=>{
      if (!start) {readCount++;return latest;}
      startCount++; await new Promise(resolve=>finish=resolve);
      latest={checkedAt:stamp,sourcesChecked:5,sourcesFailed:['Feed B'],model:'test-model',reports:[active,regional,publicOnly]};return latest;
    },
    opsLoad:async()=>({matches:[],items:[active],coverage:'Public snapshot',checkedAt:stamp})};
  const f=await fixture(options);
  await f.login('valid-password');await settled();
  assert.equal(readCount,1);assert.equal(startCount,0);
  const button=f.nodes.get('refreshScreening'), click=button.onclick();
  assert.equal(button.disabled,true);assert.match(f.nodes.get('agentStatus').textContent,/in progress/);
  await button.onclick();assert.equal(startCount,1);
  finish();await click;assert.equal(button.disabled,false);
  assert.match(f.nodes.get('agentStatus').textContent,/Agent scan completed.*Prague.*5 sources checked.*3 reports returned.*Feed B/);
  assert.match(openEvidence(f),/Atlas Precision factory fire halts production/);
  assert.match(openEvidence(f),/Flood watch for Brno/);
  assert.equal(f.nodes.get('industryList').children.length,3);
  assert.match(nodeText(f.nodes.get('industryList')),/Updated /);
  assert.match(nodeText(f.nodes.get('industryList')),/A restart date has not been announced/);
  assert.ok(descendants(f.nodes.get('industryList')).some(n=>n.href==='https://example.org/response'));
  assert.match(nodeText(f.nodes.get('screeningSources')),/test-model/);
  const back=await fixture(options);await back.login('valid-password');await settled();
  assert.equal(readCount,2);assert.equal(startCount,1);
  assert.match(back.nodes.get('agentStatus').textContent,/Last agent scan/);
  assert.match(openEvidence(back),/Atlas Precision factory fire/);
});

test('an empty agent result, an unsuccessful attempt, and signout have distinct visible states',async()=>{
  const f=await fixture({role:'viewer',sharedRows:[supplierRow('s1','Atlas Precision')],agentLoad:async({start})=>{
    if (!start) return {checkedAt:new Date().toISOString(),sourcesChecked:3,sourcesFailed:[],model:'test-model',reports:[]};
    throw Error('No public sources responded.');
  }});
  await f.login('valid-password');await settled();
  assert.match(f.nodes.get('agentStatus').textContent,/Last agent scan.*3 sources checked.*0 reports returned/);
  await f.nodes.get('refreshScreening').onclick();
  assert.match(f.nodes.get('agentStatus').textContent,/Agent scan failed.*No public sources responded.*last successful scan/);
  assert.equal(f.nodes.get('refreshScreening').disabled,false);
  await f.nodes.get('logoutButton').onclick();
  assert.equal(f.nodes.get('agentStatus').textContent,'');
});

test('agent screening keeps named cyber claims yellow and current strike notices visible',async()=>{
  const now=Date.now(), recent=new Date(now-600000).toISOString(), older=new Date(now-4*86400000).toISOString();
  const future=new Date(now+2*86400000).toISOString().slice(0,10);
  const claim={id:'claim',category:'cyber',title:'Atlas Precision named in ransomware claim',confirmation:'unverified claim',
    entities:['Atlas Precision'],country:'Czechia',publisher:'Cyber tracker',url:'https://example.org/claim',dateBasis:'first-seen',
    seenAt:recent,summary:'Operations and deliveries are unconfirmed.'};
  const strike={id:'strike',category:'labor',title:'Machinists announce a 24-hour plant strike',publisher:'Union',url:'https://example.org/strike',
    publishedAt:older,eventStart:future,eventEnd:future,eventStatus:'announced'};
  const f=await fixture({role:'viewer',sharedRows:[supplierRow('s1','Atlas Precision GmbH'),supplierRow('s2','Another Precision')],
    agentLoad:async()=>({checkedAt:recent,sourcesChecked:3,sourcesFailed:[],model:'test',reports:[claim,strike]})});
  await f.login('valid-password');await settled();
  assert.match(f.nodes.get('scanStatus').textContent,/0 red · 1 yellow/);
  const details=openEvidence(f);
  assert.match(details,/unverified claim/);assert.match(details,/Operations and deliveries are unconfirmed/);
  assert.doesNotMatch(details,/Another Precision/);
  assert.match(nodeText(f.nodes.get('industryList')),/Machinists announce a 24-hour plant strike/);
});

test('a member with an empty register can start the agent while passive loading is pending',async()=>{
  let finishLoad,posts=0;
  const fresh={id:'plant',category:'production',title:'Factory fire reported',publishedAt:new Date().toISOString(),
    publisher:'Operator',url:'https://example.org/plant'};
  const f=await fixture({sharedRows:[],agentLoad:async({start})=>{
    if(!start) return new Promise(resolve=>finishLoad=resolve);
    posts++;return {checkedAt:new Date().toISOString(),sourcesChecked:2,sourcesFailed:[],model:'test',reports:[fresh]};
  }});
  await f.login('valid-password');
  const button=f.nodes.get('refreshScreening');
  assert.equal(button.disabled,false);await button.onclick();assert.equal(posts,1);
  finishLoad(null);await settled();
  assert.match(f.nodes.get('scanStatus').textContent,/No suppliers loaded/);
  assert.match(f.nodes.get('agentStatus').textContent,/Agent scan completed/);
  assert.match(nodeText(f.nodes.get('industryList')),/Factory fire reported/);
});


test('DUNS link waits for authentication, screening and the detailed map, then opens once', async()=>{
  let release, finishHazard;
  const agentStarts=[];
  const rows=[supplierRow('s1','Named plant'),supplierRow('s2','Unflagged site')];
  const f=await fixture({hash:'#duns=01-023-4561',sharedRows:rows,detailedMap:true,deferMap:true,
    agentLoad:async({start})=>{agentStarts.push(start);return null;},
    hazardLoad:list=>new Promise(resolve=>{finishHazard=()=>resolve({matches:[{supplier:list[0],
      event:registerFor('Named plant','Production stopped',true).events[0],decision:'candidate',namedSite:true}],
      coverage:'Source checked',checkedAt:today});}),
    projectLoad:()=>new Promise(resolve=>{release=resolve;})});
  assert.equal(f.mapCalls.created,0);
  assert.equal(f.context.state().rows.length,0);
  await f.login('valid-password');
  assert.deepEqual(f.mapCalls.focused,[]);
  release(registerFor('Named plant'));await settled();
  assert.deepEqual(f.mapCalls.focused,[]);
  f.completeMap();await settled();
  assert.deepEqual(f.mapCalls.focused,['s1']);
  assert.equal(f.nodes.get('onlyFlagged').checked,true);
  assert.match(nodeText(f.nodes.get('mapPopup')),/Named plant.*Needs review/);
  assert.match(f.nodes.get('scanStatus').textContent,/Checking/);
  finishHazard();await settled();
  assert.equal(f.nodes.get('mapPopup').hidden,false);
  assert.match(nodeText(f.nodes.get('mapPopup')),/Named plant.*Active site incident/);
  const scan=f.nodes.get('refreshScreening').onclick();
  release(registerFor('Named plant'));finishHazard();await scan;
  assert.deepEqual(f.mapCalls.focused,['s1']);
  f.setHash('#duns=010234562');
  assert.deepEqual(f.mapCalls.focused,['s1']);
  release(registerFor('Unrelated'));finishHazard();await settled();
  assert.deepEqual(agentStarts,[false,true,false]);
  assert.deepEqual(f.mapCalls.focused,['s1','s2']);
  assert.equal(f.nodes.get('onlyFlagged').checked,false);
  assert.match(nodeText(f.nodes.get('mapPopup')),/Unflagged site/);
  f.nodes.get('search').value='01-023-4562';
  f.nodes.get('search').listeners.input();
  assert.match(nodeText(f.nodes.get('tableBody')),/Unflagged site/);
  assert.doesNotMatch(nodeText(f.nodes.get('tableBody')),/Named plant/);
  await f.nodes.get('logoutButton').onclick();
  assert.equal(f.nodes.get('mapPopup').hidden,true);
  assert.equal(f.nodes.get('mapPopup').children.length,0);
  f.setHash('#duns=010234561');
  assert.deepEqual(f.mapCalls.focused,['s1','s2']);
});

test('linked neutral supplier opens on the basic map after screening finishes; malformed, unknown and unmapped IDs stay distinct', async()=>{
  let release;
  const rows=[supplierRow('s1','Neutral site'),{...supplierRow('s2','Unmapped site'),lat:null,lon:null}];
  const f=await fixture({hash:'#duns=010234561',sharedRows:rows,projectLoad:()=>new Promise(resolve=>{release=resolve;})});
  await f.login('valid-password');
  assert.equal(f.nodes.get('onlyFlagged').checked,true);
  release(registerFor('Unrelated'));await settled();
  assert.equal(f.nodes.get('onlyFlagged').checked,false);
  assert.equal(f.nodes.get('mapPopup').hidden,false);
  assert.match(nodeText(f.nodes.get('mapPopup')),/Neutral site/);
  assert.equal(f.context.state().view[2],45);
  f.setHash('#duns=01023-45-62');
  assert.equal(f.nodes.get('mapPopup').hidden,true);
  assert.equal(f.nodes.get('search').value,'');
  f.setHash('#duns=000000000');release(registerFor('Unrelated'));await settled();
  assert.match(f.nodes.get('notice').textContent,/absent/);
  f.setHash('#duns=010234562');release(registerFor('Unrelated'));await settled();
  assert.equal(f.nodes.get('supplierRegister').open,true);
  assert.match(nodeText(f.nodes.get('tableBody')),/Unmapped site/);
  assert.match(f.nodes.get('notice').textContent,/no mapped coordinates/);
});
