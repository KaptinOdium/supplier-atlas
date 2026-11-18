import test from 'node:test';
import assert from 'node:assert/strict';
import {readPrivateRegister} from '../docs/screen-register.mjs';

const saved = {asOf:'2026-11-12',events:[],watchlist:[]};
test('private registers require a decision and cited evidence for each incident',() => {
  const row = {id:'source-1',title:'Company statement',screening:{decision:'watch',reason:'Awaiting site confirmation'},sources:[{name:'Operator',url:'https://example.com/incident'}]};
  const input = {...saved, events:[row]};
  assert.deepEqual(readPrivateRegister(JSON.stringify(input)),input);
  assert.throws(()=>readPrivateRegister(JSON.stringify({...input,events:[{...row,sources:[]}]})),/source references/);
  assert.throws(()=>readPrivateRegister(JSON.stringify({...input,watchlist:[row]})),/unique incident/);
});
