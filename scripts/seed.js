import { randomBytes } from 'node:crypto';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { config,root } from '../src/config.js';
import { database,migrate } from '../src/db.js';
import { Store } from '../src/store.js';
import { passwordHash,digest } from '../src/security.js';
import { ingest,pipelineVersion } from '../src/ingest.js';
const settings=config(),pool=database(settings.databaseUrl),store=new Store(pool);
try{
  await migrate(pool);await mkdir(settings.dataDir,{recursive:true});
  const file=path.join(settings.dataDir,'demo-credentials.json');let credentials;
  try{credentials=JSON.parse(await readFile(file,'utf8'));}catch{credentials={email:'editor@example.test',password:randomBytes(24).toString('base64url')};}
  let owner=await store.ownerByEmail(credentials.email);
  if(!owner){owner=await store.owner(credentials.email,await passwordHash(credentials.password));await writeFile(file,JSON.stringify(credentials,null,2),{mode:0o600});}
  const sources=JSON.parse(await readFile(path.join(root,'corpus','sources.json'),'utf8'));
  const imageMap={};
  for(const source of sources){const bytes=await readFile(path.join(root,'data','corpus',`${source.id}.jpg`));const image=await ingest(store,settings,owner.id,bytes);imageMap[source.id]=image.id;}
  // Explicit synthetic blank control: not one of the 40 licensed corpus photographs.
  const blank=await sharp({create:{width:512,height:512,channels:3,background:'#909090'}}).jpeg().toBuffer();
  imageMap['control-blank']=(await ingest(store,settings,owner.id,blank)).id;
  const specs=JSON.parse(await readFile(path.join(root,'evals','posts.json'),'utf8')),postMap={};
  for(const entry of specs){const body={title:entry.title,content:entry.content};postMap[entry.id]=(await store.addPost(owner.id,body,`evaluation-${entry.id}-v1`,digest(JSON.stringify(body)),pipelineVersion(settings))).id;}
  await writeFile(path.join(settings.dataDir,'seed-map.json'),JSON.stringify({ownerId:owner.id,images:imageMap,posts:postMap},null,2));
  console.log(`Seeded ${sources.length} licensed images + 1 blank control and ${specs.length} posts. Jobs are queued, not fabricated.`);
  console.log('Private local login: data/demo-credentials.json. Runtime mapping: data/seed-map.json.');
}finally{await pool.end();}
