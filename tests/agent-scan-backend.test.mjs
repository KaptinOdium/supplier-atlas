import test from 'node:test';
import assert from 'node:assert/strict';
import {makeScanHandler} from '../supabase/functions/atlas-agent-scan/index.ts';

const user = 'b3e52318-ec24-4cee-813e-e85251075da8';
const result = {reports:[],sourcesChecked:3,sourcesFailed:[],model:'test-model',checkedAt:'2026-11-24T08:00:00Z'};
const jsonify = (body, status=200) => Response.json(body, {status});
const endpoint = 'https://example.supabase.co/functions/v1/atlas-agent-scan';

function setup({role='viewer', research=async () => result} = {}) {
  const jobs = new Map(), background = [];
  let calls = 0;
  const fetcher = async (url, init) => {
    const {pathname:path, searchParams:params} = new URL(url);
    const auth = init.headers.Authorization;
    if (path === '/auth/v1/user') {
      assert.equal(init.headers.apikey, 'public-key');
      return auth === 'Bearer member-token' ? jsonify({id:user}) : jsonify({},401);
    }
    if (path === '/rest/v1/supplier_members') {
      assert.equal(auth,'Bearer member-token');
      assert.equal(params.get('user_id'),'eq.' + user);
      assert.equal(params.get('active'),'eq.true');
      return jsonify(role ? [{role}] : []);
    }
    if (path.includes('/rpc/')) {
      assert.equal(auth,'Bearer private-key');
      const {p_user_id,p_id,p_lease} = JSON.parse(init.body);
      assert.equal(p_user_id,user);
      const claimed = !jobs.has(p_id);
      if (claimed) jobs.set(p_id, {id:p_id, lease:p_lease, status:'running',result:null,error:null});
      const {lease, ...job} = jobs.get(p_id);
      return jsonify({...job,claimed});
    }
    assert.equal(path,'/rest/v1/atlas_agent_scans');
    assert.equal(params.get('user_id'),'eq.' + user);
    if (init.method === 'PATCH') {
      assert.equal(auth,'Bearer private-key');
      const row = jobs.get(params.get('id').slice(3));
      assert.equal(params.get('lease_id'),'eq.' + row.lease);
      assert.equal(params.get('status'),'eq.running');
      Object.assign(row, JSON.parse(init.body));
      return new Response(null,{status:204});
    }
    assert.equal(auth,'Bearer member-token');
    assert.equal(params.get('limit'),'1');
    assert.equal(params.get('status'),'eq.succeeded');
    const latest = [...jobs.values()].reverse().find(r => r.status === 'succeeded');
    return jsonify(latest ? [{id:latest.id,status:latest.status,result:latest.result,error:latest.error}] : []);
  };
  const route = makeScanHandler({url:'https://example.supabase.co', anonKey:'public-key', serviceKey:'private-key',
    fetcher, waitUntil:work => background.push(work), research:async () => {calls++; return research();}});
  function call({method='POST', id=crypto.randomUUID(), token='Bearer member-token', origin='https://kaptinodium.github.io'} = {}) {
    const headers = {'Authorization':token,'Origin':origin,'Content-Type':'application/json'};
    return route(new Request(endpoint,{method,headers,body:method==='POST' ? JSON.stringify({requestId:id}) : undefined}));
  }
  return {call,jobs,background, calls:() => calls};
}

test('requires a signed-in active member before researching or reserving a job', async () => {
  const testCase = setup({role:null});
  assert.equal((await testCase.call({token:''})).status,401);
  assert.equal((await testCase.call({token:'Bearer invalid'})).status,401);
  assert.equal((await testCase.call()).status,403);
  assert.equal(testCase.calls(),0);
  assert.equal(testCase.jobs.size,0);
});

test('rejects invalid click IDs and unrelated browser origins', async () => {
  const testCase = setup();
  assert.equal((await testCase.call({id:'bad-id'})).status,400);
  assert.equal((await testCase.call({origin:'https://other.example'})).status,403);
  assert.equal((await testCase.call({method:'OPTIONS'})).headers.get('Access-Control-Allow-Origin'),'https://kaptinodium.github.io');
  assert.equal(testCase.calls(),0);
});

test('retries and polls join one running job; a different click starts fresh research', async () => {
  let finish;
  const pending = new Promise(resolve => {finish=resolve;});
  const testCase = setup({research:() => pending});
  assert.equal((await testCase.call({method:'GET'})).status,204);
  const id = crypto.randomUUID();
  const a = await testCase.call({id}), b = await testCase.call({id});
  assert.equal(a.status,202);
  assert.equal(b.headers.get('Retry-After'),'3');
  assert.equal((await b.json()).status,'running');
  assert.equal(testCase.calls(),1);
  finish(result);
  await Promise.all(testCase.background);
  const replay = await testCase.call({id});
  assert.equal(replay.status,200);
  assert.deepEqual(await replay.json(),{id,status:'succeeded',result,error:null});
  assert.equal((await (await testCase.call({method:'GET'})).json()).id,id);
  assert.equal(testCase.calls(),1);
  assert.equal((await testCase.call()).status,202);
  await Promise.all(testCase.background);
  assert.equal(testCase.calls(),2);
});

test('model failure records a terminal failed run with no invented results', async () => {
  const testCase = setup({research:() => {throw Error('downstream error containing sensitive diagnostics');}});
  const id = crypto.randomUUID();
  await testCase.call({id});
  await Promise.all(testCase.background);
  const replay = await testCase.call({id});
  const row = await replay.json();
  assert.equal(row.status,'failed');
  assert.equal(row.result,null);
  assert.doesNotMatch(row.error,/sensitive/);
  assert.equal((await testCase.call({method:'GET'})).status,204);
});
