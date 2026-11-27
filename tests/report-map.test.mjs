import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as core from '../docs/map-core.mjs';
import {companyReportFeatures} from '../docs/map-view.mjs';

const item = {id:'public-report', name:'Example Co', city:'Example City', lat:51, lon:11};

test('public report features use independent IDs and valid city coordinates', () => {
  const {features} = companyReportFeatures([item, {...item,lat:null}, {...item,id:''}]);
  assert.deepEqual(features, [{type:'Feature', geometry:{type:'Point',coordinates:[11,51]},properties:{reportId:item.id}}]);
});

test('public report markers are independent, pickable above suppliers, and restored after style changes', async () => {
  const layers = new Map(), sources = new Map(), events = {}, windowEvents = {};
  let camera, removed = false;
  const canvas = {style:{},setAttribute(){}};
  const map = {
    touchZoomRotate:{disableRotation(){}}, addControl(){}, getCanvas:()=>canvas,
    on(type, fn){events[type]=fn; if(type==='style.load') queueMicrotask(fn);},
    getStyle:()=>({layers:[]}), setStyle(){layers.clear();sources.clear();events['style.load']();},
    getLayer:id=>layers.get(id), addLayer:layer=>layers.set(layer.id,layer),
    getSource:id=>sources.get(id), addSource(id,source){sources.set(id,{...source,setData(data){this.data=data;}});},
    setFilter(){}, remove(){removed=true;}, easeTo(options){camera=options;},
    queryRenderedFeatures:()=>[{layer:{id:'atlas-clusters'},properties:{cluster_id:1}},
      {layer:{id:'atlas-report-points'},properties:{reportId:item.id}}]
  };
  const controller = {Map:class {constructor(){return map;}}, ScaleControl:class {}, FullscreenControl:class {}};
  const code = (await readFile(new URL('../docs/map-view.mjs',import.meta.url),'utf8'))
    .replace(/^import .*;\r?\n/,'').replaceAll('export ', '').replace('await loadRenderer(signal)','renderer');
  const context = vm.createContext({...core,renderer:controller,setTimeout,clearTimeout,
    document:{documentElement:{dataset:{}},createElement:()=>({remove(){}})},
    window:{addEventListener:(type,fn)=>{windowEvents[type]=fn;},removeEventListener(){}}});
  const selected = [];
  const createMap = vm.runInContext(code+'\ncreateSupplierMap',context);
  const view = await createMap({container:{append(){},closest:()=>null},onSelect:()=>assert.fail('Selected a supplier'),onReportSelect:id=>selected.push(id)});
  view.update([{id:'supplier',lat:51,lon:11}]);view.updateReports([item]);
  const publicSource = () => sources.get('atlas-company-reports');
  assert.equal(sources.get('atlas-suppliers').data.features.length,1);
  assert.equal(publicSource().cluster,undefined);
  assert.equal(layers.get('atlas-report-points').paint['circle-color'],'#2869bb');
  assert.equal([...layers.keys()].at(-1),'atlas-report-points');
  await events.click({point:{x:12,y:16}});assert.deepEqual(selected,[item.id]);
  view.focusReport(item);assert.deepEqual(Array.from(camera.center),[11,51]);assert.equal(camera.zoom,9);
  windowEvents['supplier-theme-change']({detail:{theme:'dark'}});
  assert.equal(publicSource().data.features[0].properties.reportId,item.id);
  view.updateReports([]);assert.equal(publicSource().data.features.length,0);
  assert.equal(sources.get('atlas-suppliers').data.features.length,1);
  view.destroy();view.updateReports([item]);assert.ok(removed);assert.equal(publicSource().data.features.length,0);
});
