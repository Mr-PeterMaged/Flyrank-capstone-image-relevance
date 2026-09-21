import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture,metadata,mockProvider,embedding } from './helpers.js';
import { guard,intent,rank } from '../src/guard.js';
import { visionSchema,vector } from '../src/schema.js';
import { worker } from '../src/worker.js';
import { digest } from '../src/security.js';

test('schema rejects malformed vision, nonfinite confidence and invalid vectors',()=>{
  assert.equal(visionSchema.safeParse({...metadata,confidence:1.1}).success,false);
  assert.equal(visionSchema.safeParse({...metadata,extra:'untrusted'}).success,false);
  assert.throws(()=>vector([1,NaN,0,0,0,0,0,0]));assert.throws(()=>vector(Array(8).fill(0)));
});
test('guard maps scientific aliases and rejects a wolf even with perfect similarity',()=>{
  assert.deepEqual(intent('Vulpes vulpes behavior in the forest').subjects,['red fox']);
  assert.deepEqual(intent('Canis lupus familiaris').subjects,['domestic dog']);
  const result=guard(intent('red fox'),{...metadata,subject:'gray wolf'},1,{confidence:.75,similarity:.4});
  assert.equal(result.accepted,false);assert.ok(result.reasons.some(r=>r.includes('expected red fox, detected gray wolf')));
  assert.equal(guard(intent('galaxies'),metadata,1,{confidence:.75,similarity:.4}).accepted,false);
});
test('auth hashes passwords, expires/revokes sessions and rejects unauthenticated access',async(t)=>{
  const f=await fixture(t);assert.equal((await f.request('/api/images',{owner:null})).status,401);
  const body={email:'registered@example.test',password:'a-synthetic-test-password'};
  const registered=await f.request('/auth/register',{method:'POST',body,owner:null});assert.equal(registered.status,201);
  assert.notEqual((await f.store.ownerByEmail(body.email)).password_hash,body.password);
  assert.equal((await f.request('/auth/login',{method:'POST',body,owner:null})).status,200);
  assert.equal((await f.request('/auth/login',{method:'POST',body:{...body,password:'incorrect-password'},owner:null})).status,401);
  await f.pool.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[digest(f.tokens[1])]);
  assert.equal((await f.request('/api/posts',{owner:1})).status,401);
  assert.equal((await f.request('/auth/logout',{method:'POST'})).status,204);
  assert.equal((await f.request('/api/posts')).status,401);
});
test('image upload validates real bytes, deduplicates and queues before AI executes',async(t)=>{
  const f=await fixture(t);const a=await f.upload(),b=await f.upload();
  assert.equal(a.status,202);assert.equal(b.status,200);assert.equal(a.data.id,b.data.id);
  assert.equal((await f.store.one('SELECT count(*)::int AS n FROM jobs')).n,1);
  assert.equal((await f.store.one('SELECT count(*)::int AS n FROM ai_calls')).n,0);
  const form=new FormData();form.append('image',new Blob(['not an image'],{type:'image/jpeg'}),'fox.jpg');
  const r=await fetch(`${f.base}/api/images`,{method:'POST',headers:{Authorization:`Bearer ${f.tokens[0]}`},body:form});assert.equal(r.status,400);
  const large=new FormData();large.append('image',new Blob([new Uint8Array(5*1024*1024+1)]),'large.jpg');
  const big=await fetch(`${f.base}/api/images`,{method:'POST',headers:{Authorization:`Bearer ${f.tokens[0]}`},body:large});assert.equal(big.status,413);
});
test('boundary validation returns JSON 4xx for malformed JSON, schema, UUID and pagination',async(t)=>{
  const f=await fixture(t);
  for(const [url,options,expected] of [
    ['/api/posts',{method:'POST',raw:'{'},400],['/api/posts',{method:'POST',raw:JSON.stringify({x:'x'.repeat(40000)})},413],
    ['/api/posts',{method:'POST',body:{}},400],['/api/images/bad-id',{},400],['/api/jobs?limit=-2',{},400],
    ['/api/batches',{method:'POST',body:{imageIds:[]}},400],
  ]){const r=await f.request(url,options);assert.equal(r.status,expected);assert.ok(r.data.error.code);}
});
test('tenant isolation covers image bytes, posts, matches, jobs, costs and reviews',async(t)=>{
  const f=await fixture(t);const image=await f.upload(),post=await f.post();await f.processor.tick();await f.processor.tick();
  const matches=await f.request(`/api/posts/${post.data.id}/matches`,{method:'POST',body:{}});
  for(const url of [`/api/images/${image.data.id}`,`/api/images/${image.data.id}/file`,`/api/posts/${post.data.id}`,`/api/posts/${post.data.id}/images`,`/api/suggestions/${matches.data.candidates[0].suggestionId}`])assert.equal((await f.request(url,{owner:1})).status,404);
  for(const url of ['/api/images','/api/posts','/api/jobs','/api/costs'])assert.deepEqual((await f.request(url,{owner:1})).data.items,[]);
  assert.equal((await f.request(`/api/suggestions/${matches.data.candidates[0].suggestionId}/review`,{method:'PUT',body:{decision:'approve'},owner:1})).status,404);
});
test('worker stores validated tags and embeddings; every provider call has attributed usage',async(t)=>{
  const f=await fixture(t);const image=await f.upload();await f.processor.tick();
  const row=await f.store.image(f.owners[0].id,image.data.id);assert.equal(row.status,'ready');assert.deepEqual(row.metadata,metadata);
  assert.equal((await f.store.one('SELECT count(*)::int AS n FROM vectors')).n,1);
  assert.ok((await f.store.one('SELECT count(*)::int AS n FROM tags')).n>=3);
  const costs=(await f.request('/api/costs')).data;assert.equal(costs.summary.calls,2);assert.equal(costs.summary.usd,0);
  for(const call of costs.items){assert.ok(call.job_id);assert.equal(call.target_id,image.data.id);assert.equal(call.status,'success');assert.ok(call.input_tokens>0);}
});
test('low confidence and unknown subject are flagged and cannot become suggestions',async(t)=>{
  const provider=mockProvider();provider.vision=async()=>({value:{...metadata,subject:'unknown',category:'other',confidence:.2},usage:{input:1,output:1}});
  const f=await fixture(t,{},provider);const image=await f.upload(),post=await f.post();await f.processor.tick();await f.processor.tick();
  assert.equal((await f.store.image(f.owners[0].id,image.data.id)).status,'flagged');
  const result=await f.request(`/api/posts/${post.data.id}/images`);assert.equal(result.data.status,'no_confident_match');assert.equal(result.data.candidates[0].accepted,false);
});
test('invalid model output retries, never persists tags, and emits a terminal alert',async(t)=>{
  const provider=mockProvider();provider.vision=async()=>({value:{subject:'wolf'},usage:{input:1,output:2}});
  const f=await fixture(t,{retryMs:1},provider);const image=await f.upload();
  for(let i=0;i<3;i++){await f.processor.tick();await f.pool.query("UPDATE jobs SET next_at=now() WHERE status='pending'");}
  const row=await f.store.image(f.owners[0].id,image.data.id);assert.equal(row.status,'failed');assert.equal(row.metadata,null);
  assert.equal((await f.store.one('SELECT count(*)::int AS n FROM ai_calls')).n,3);
  assert.ok(f.logs.some(l=>l.includes('job_dead_letter')));
});
test('transient embedding failure resumes without repeating completed vision',async(t)=>{
  const provider=mockProvider();let n=0;provider.embed=async()=>{if(n++===0)throw new Error('network');return {value:embedding,usage:{input:8,output:0}};};
  const f=await fixture(t,{retryMs:1},provider);await f.upload();await f.processor.tick();await f.pool.query('UPDATE jobs SET next_at=now()');await f.processor.tick();
  assert.equal((await f.store.one("SELECT count(*)::int AS n FROM ai_calls WHERE kind='vision'")).n,1);
  assert.equal((await f.store.one("SELECT status FROM jobs")).status,'done');
  assert.equal((await f.store.one("SELECT count(*)::int AS n FROM ai_calls WHERE status='failed'")).n,1);
});
test('daily budget reservations are atomic and block calls before the provider',async(t)=>{
  const f=await fixture(t,{dailyCalls:2});await f.upload();const job=await f.store.one('SELECT * FROM jobs');
  const attempts=await Promise.allSettled(Array.from({length:6},()=>f.store.reserveCall(job,'embedding','test',f.settings)));
  assert.equal(attempts.filter(r=>r.status==='fulfilled').length,2);assert.equal((await f.store.one('SELECT calls FROM daily_budgets')).calls,2);
  assert.equal((await f.store.one('SELECT count(*)::int AS n FROM ai_calls')).n,2);
});
test('post retries are idempotent and conflict on changed content',async(t)=>{
  const f=await fixture(t),body={title:'A fox article',content:'The red fox lives in a meadow.'},headers={'Idempotency-Key':randomUUID()};
  const r=await Promise.all([f.request('/api/posts',{method:'POST',body,headers}),f.request('/api/posts',{method:'POST',body,headers})]);
  assert.equal(r[0].data.id,r[1].data.id);assert.equal((await f.store.one('SELECT count(*)::int AS n FROM jobs')).n,1);
  assert.equal((await f.request('/api/posts',{method:'POST',body:{...body,title:'Changed title'},headers})).status,409);
});
test('matching ranks the fox, rejects forced wolf, and refuses unsupported subject',async(t)=>{
  const provider=mockProvider();let n=0;provider.vision=async()=>({value:{...metadata,subject:n++===0?'red fox':'gray wolf'},usage:{input:1,output:1}});
  const f=await fixture(t,{},provider);const fox=await f.upload('#ee7722');await f.processor.tick();const wolf=await f.upload('#888888');await f.processor.tick();
  const post=await f.post();await f.processor.tick();
  const r=await f.request(`/api/posts/${post.data.id}/images`);assert.equal(r.data.candidates[0].imageId,fox.data.id);assert.equal(r.data.candidates[0].accepted,true);
  const forced=await f.request(`/api/posts/${post.data.id}/images/${wolf.data.id}/check`);assert.equal(forced.data.accepted,false);assert.ok(forced.data.reasons.some(s=>s.includes('detected gray wolf')));
  const unknown=await f.post({title:'Astronomy and galaxies',content:'Deep-space nebulae and galaxies beyond the Milky Way.'});await f.processor.tick();
  assert.equal((await f.request(`/api/posts/${unknown.data.id}/images`)).data.status,'no_confident_match');
});
test('review is inspectable and idempotent; guard rejection cannot be overridden',async(t)=>{
  const f=await fixture(t);await f.upload();const post=await f.post();await f.processor.tick();await f.processor.tick();
  const matches=await f.request(`/api/posts/${post.data.id}/matches`,{method:'POST',body:{}}),id=matches.data.candidates[0].suggestionId;
  for(let i=0;i<2;i++)assert.equal((await f.request(`/api/suggestions/${id}/review`,{method:'PUT',body:{decision:'approve',note:'Reviewed'}})).status,200);
  assert.equal((await f.store.one('SELECT count(*)::int AS n FROM reviews')).n,1);
  assert.equal((await f.request(`/api/suggestions/${id}`)).data.decision,'approve');
  await f.pool.query('UPDATE suggestions SET accepted=false WHERE id=$1',[id]);
  assert.equal((await f.request(`/api/suggestions/${id}/review`,{method:'PUT',body:{decision:'approve'}})).status,409);
  assert.equal((await f.request(`/api/suggestions/${id}/review`,{method:'PUT',body:{decision:'reject'}})).status,200);
});
test('leases prevent concurrent workers and stale completion after reclaim',async(t)=>{
  const f=await fixture(t);await f.upload();const first=await f.store.claim(10000);assert.ok(first);assert.equal(await f.store.claim(10000),null);
  await f.pool.query("UPDATE jobs SET lease_until=now()-interval '1 second'");const second=await f.store.claim(10000);
  assert.notEqual(first.lease_token,second.lease_token);assert.equal(await f.store.finish(first,embedding,'test'),false);
  assert.equal(await f.store.finish(second,embedding,'test'),true);
});
