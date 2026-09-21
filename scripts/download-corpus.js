import { readFile,writeFile,mkdir,access } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { root } from '../src/config.js';
const manifest=JSON.parse(await readFile(path.join(root,'corpus','sources.json'),'utf8'));
const folder=path.join(root,'data','corpus');await mkdir(folder,{recursive:true});
let completed=0;
for(const source of manifest){
  const target=path.join(folder,`${source.id}.jpg`);
  try{await access(target);completed++;continue;}catch{}
  let success=false;
  for(let attempt=0;attempt<4;attempt++){
    try{
      const response=await fetch(source.downloadUrl,{headers:{'User-Agent':'FlyRankImageCapstone/1.0 (educational corpus)'},signal:AbortSignal.timeout(45000)});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const bytes=Buffer.from(await response.arrayBuffer());
      const normalized=await sharp(bytes,{limitInputPixels:30000000}).rotate().resize({width:640,height:640,fit:'inside'}).jpeg({quality:85}).toBuffer();
      await writeFile(target,normalized);success=true;break;
    }catch(error){if(attempt===3)throw new Error(`${source.id} download failed: ${error.message}`);await new Promise(r=>setTimeout(r,1500*2**attempt));}
  }
  if(success)console.log(`Downloaded ${++completed}/${manifest.length}`);
  await new Promise(r=>setTimeout(r,300));
}
const checks=[];for(const source of manifest){const bytes=await readFile(path.join(folder,`${source.id}.jpg`));checks.push({id:source.id,sha256:createHash('sha256').update(bytes).digest('hex')});}
await writeFile(path.join(folder,'checksums.json'),JSON.stringify(checks,null,2));
console.log(`Corpus ready: ${completed} licensed photographs. Files stay in ignored data/corpus/.`);
