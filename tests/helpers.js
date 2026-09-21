import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { mkdtemp,mkdir,rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { config } from '../src/config.js';
import { migrate } from '../src/db.js';
import { Store } from '../src/store.js';
import { createApp } from '../src/app.js';
import { token,digest } from '../src/security.js';
import { worker } from '../src/worker.js';
export const metadata={subject:'red fox',category:'animal',attributes:['orange fur'],caption:'A red fox in a meadow',confidence:0.95};
export const embedding=[1,0,0,0,0,0,0,0];
export const mockProvider=()=>({vision:async()=>({value:{...metadata},usage:{input:12,output:20}}),embed:async()=>({value:[...embedding],usage:{input:8,output:0}})});
export async function fixture(t,overrides={},provider=mockProvider()){
  const settings={...config(),...overrides,dataDir:await mkdtemp(path.join(tmpdir(),'lens-test-'))};
  const admin=new pg.Pool({connectionString:settings.databaseUrl});
  const schema=`test_${randomUUID().replaceAll('-','')}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool=new pg.Pool({connectionString:settings.databaseUrl,options:`-c search_path=${schema}`,max:6});
  await migrate(pool);const store=new Store(pool),logs=[],logger={error:(s)=>logs.push(s),warn:(s)=>logs.push(s)};
  const owners=await Promise.all(['a','b'].map(n=>store.owner(`${n}@example.test`,'unused')));
  const tokens=owners.map(()=>token());for(let i=0;i<2;i++)await store.session(digest(tokens[i]),owners[i].id);
  const server=createApp(store,settings,{logger}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${server.address().port}`,processor=worker(store,settings,{provider,logger});
  async function close(){await processor.stop();await new Promise(r=>server.close(r));await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();if(path.dirname(path.resolve(settings.dataDir))!==path.resolve(tmpdir())||!path.basename(settings.dataDir).startsWith('lens-test-'))throw new Error('Unsafe temp cleanup');await rm(settings.dataDir,{recursive:true});}
  if(t)t.after(close);
  async function request(url,{method='GET',body,raw,owner=0,headers={}}={}){
    const response=await fetch(`${base}${url}`,{method,headers:{...(owner===null?{}:{Authorization:`Bearer ${tokens[owner]}`}),...(body!==undefined||raw!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:raw??(body!==undefined?JSON.stringify(body):undefined)});
    const text=await response.text();let data;try{data=text?JSON.parse(text):null;}catch{data=text;}
    return {status:response.status,data,headers:response.headers};
  }
  async function upload(color='#cc7722',owner=0){const buffer=await sharp({create:{width:32,height:32,channels:3,background:color}}).jpeg().toBuffer();const form=new FormData();form.append('image',new Blob([buffer],{type:'image/jpeg'}),'untrusted-filename.jpg');const r=await fetch(`${base}/api/images`,{method:'POST',headers:{Authorization:`Bearer ${tokens[owner]}`},body:form});return {status:r.status,data:await r.json()};}
  async function post(body={title:'Red fox behavior',content:'Learn about the behavior of Vulpes vulpes in its forest habitat.'}){return request('/api/posts',{method:'POST',body,headers:{'Idempotency-Key':randomUUID()}});}
  return {settings,store,pool,owners,tokens,server,base,logs,logger,processor,request,upload,post,close};
}
