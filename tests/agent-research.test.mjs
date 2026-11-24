import test from 'node:test';
import assert from 'node:assert/strict';
import {runResearch} from '../supabase/functions/atlas-agent-scan/research.ts';

const unavailable = () => new Response(null,{status:503});
const rss = (items='') => new Response('<rss version="2.0"><channel>'+items+'</channel></rss>');

function runtime(t,fetcher,embed,apiKey) {
  for (const key of ['fetch','Supabase','Deno']) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis,key);
    t.after(()=>descriptor ? Object.defineProperty(globalThis,key,descriptor) : delete globalThis[key]);
  }
  globalThis.fetch = (url,options) => fetcher(new URL(url),options);
  globalThis.Deno = {env:{get:()=>apiKey}};
  globalThis.Supabase = embed ? {ai:{Session:class {
    async run(text) { return embed(text); }
  }}} : undefined;
}

test('the model selects a public lead; news retries retain dated publisher evidence and separate claims',async t=>{
  const calls=[], today=new Date(Date.now()-3600000);
  const label='Example Beta Circuits', direct='https://example.com/factory-fire';
  const newsItem='<item><title>Example factory fire halts production</title><News:Source>Example Journal</News:Source>'+
    '<link>https://www.bing.com/news/apiclick.aspx?ref=discovery&amp;url='+encodeURIComponent(direct)+'</link>'+
    '<pubDate>'+today.toUTCString()+'</pubDate></item>';
  runtime(t,async (u,options)=>{
    assert.equal(options.redirect,'error'); calls.push(u);
    if (u.hostname==='www.ransomlook.io') return Response.json(['Example Alpha Circuits',label].map(post_title=>({
      post_title,group_name:'Example Group',discovered:today.toISOString(),link:'http://do-not-fetch.onion/private'
    })));
    if (u.hostname==='news.google.com') return rss();
    if (u.hostname==='www.bing.com' && u.searchParams.get('q').includes(label)) return rss(newsItem+newsItem);
    return unavailable();
  },s=>s.startsWith('Prioritize') || s.includes(label) ? [1,0] : [0,1]);
  const r=await runResearch();
  assert.equal(r.model,'supabase/gte-small');
  assert(r.coverage.some(s=>s.id==='bing-news' && s.status==='unavailable'));
  assert(r.coverage.some(s=>s.id==='google-news' && s.status==='ok'));
  assert(r.coverage.some(s=>s.id==='bing-followup' && s.retained===2));
  assert(calls.some(u=>u.searchParams.get('q')?.includes('"'+label+'"')));
  const article=r.reports.filter(row=>row.url===direct);
  assert.equal(article.length,1);
  assert.equal(article[0].publisher,'Example Journal');
  assert.deepEqual(article[0].evidence,[{name:'Example Journal',url:direct,date:new Date(today.toUTCString()).toISOString(),dateBasis:'published'}]);
  const claims=r.reports.filter(row=>row.confirmation==='unverified claim');
  assert.equal(claims.length,2); assert.notEqual(claims[0].url,claims[1].url);
  assert(claims.every(row=>row.seenAt===today.toISOString() && !row.publishedAt));
  assert(!calls.some(u=>u.hostname.endsWith('.onion')));
  assert(!JSON.stringify(r).includes('do-not-fetch'));
});

test('a healthy empty feed still triggers a model-selected topic and a fresh search',async t=>{
  const searches=[],prompts=[];
  runtime(t,async u=>{
    if (u.hostname==='www.bing.com' || u.hostname==='news.google.com') {
      searches.push(u.searchParams.get('q')); return rss();
    }
    return unavailable();
  },s=>{
    prompts.push(s);
    return s.startsWith('Prioritize') || s.startsWith('National strikes') ? [1,0] : [0,1];
  });
  const r=await runResearch();
  assert.deepEqual(r.reports,[]); assert.equal(r.model,'supabase/gte-small');
  assert(prompts.includes('National strikes or freight disruption in ports and rail terminals'));
  assert(searches.some(v=>v.includes('"rail strike"')));
  assert(r.sourcesChecked>0 && r.sourcesFailed.length>0);
});

test('native inference uses at most three short sequential calls across discovery and follow-up', {timeout:2000}, async t=>{
  const prompts=[], now=new Date(Date.now()-3600000), checkedQueries=[];
  let active=0, peak=0;
  runtime(t,async u=>{
    if (u.hostname==='www.ransomlook.io') return Response.json(Array.from({length:24},(_,i)=>({
      post_title:'Example Circuits '+i,group_name:'Example Group',discovered:now.toISOString()
    })));
    if (u.hostname==='www.bing.com') {
      const q=u.searchParams.get('q'); checkedQueries.push(q);
      const topic=q.includes('Example Circuits') ? 'Followup' : 'Discovery';
      return rss(Array.from({length:24},(_,i)=>'<item><title>'+topic+' industrial plant fire '+i+
        '</title><link>https://example.com/'+topic+'/'+i+'</link><pubDate>'+now.toUTCString()+'</pubDate></item>').join(''));
    }
    if (u.hostname==='news.google.com') return rss();
    return unavailable();
  },async s=>{
    prompts.push(s); peak=Math.max(peak,++active);
    await new Promise(resolve=>setTimeout(resolve,2)); active--;
    return s.startsWith('Prioritize') || s.includes('Example Circuits') ? [1,0] : [0,1];
  });
  const result=await runResearch();
  assert.equal(prompts.length,3); assert.equal(peak,1);
  assert(prompts.every(s=>s.length<=110 && s.split(/\s+/).length<=15));
  assert(checkedQueries.some(q=>q.includes('Example Circuits')));
  assert(result.reports.some(r=>r.title.startsWith('Followup')));
  assert.equal(result.reports.length,10);
});

test('the configured chat model chooses an allowlisted search without sharing its credential with sources',async t=>{
  let ran=false;
  runtime(t,async (u,init)=>{
    if (u.hostname==='api.openai.com') {
      const request=JSON.parse(init.body);
      assert.equal(request.tool_choice.function.name,'prioritize_public_search');
      assert.equal(init.headers.Authorization,'Bearer test-only');
      ran=true;
      return Response.json({choices:[{message:{tool_calls:[{function:{
        name:'prioritize_public_search',arguments:'{"ranked":[2,1,0],"followUp":2}'
      }}]}}]});
    }
    assert.equal(init.headers?.Authorization,undefined);
    if (['news.google.com','www.bing.com'].includes(u.hostname)) return rss();
    return unavailable();
  },null,'test-only');
  assert.equal((await runResearch()).model,'openai/gpt-4.1-mini');
  assert(ran);
});

test('total source failure and model failure each reject the scan',async t=>{
  let healthy=false;
  runtime(t,async u=>healthy && u.hostname==='www.bing.com' ? rss() : unavailable());
  await assert.rejects(runResearch(),/All public discovery sources/);
  healthy=true;
  await assert.rejects(runResearch(),/Hosted AI unavailable/);
});
