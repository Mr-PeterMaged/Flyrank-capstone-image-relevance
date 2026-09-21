import sharp from 'sharp';
import path from 'node:path';
import { mkdir,writeFile } from 'node:fs/promises';
import { digest } from './security.js';
import { HttpError } from './schema.js';
export const pipelineVersion=(config)=>digest(`vision-v1:${config.visionModel}:${config.embeddingModel}`).slice(0,20);
export async function ingest(store,config,owner,buffer) {
  if(!buffer?.length || buffer.length>5*1024*1024) throw new HttpError(413,'image_size','Upload one image of at most 5 MiB');
  let encoded;
  try {
    const image=sharp(buffer,{limitInputPixels:20000000,animated:false});
    const metadata=await image.metadata();
    if(!['jpeg','png','webp'].includes(metadata.format)||metadata.pages>1) throw new Error('invalid_format');
    encoded=await image.rotate().resize({width:768,height:768,fit:'inside',withoutEnlargement:true}).jpeg({quality:85}).toBuffer();
  } catch { throw new HttpError(400,'invalid_image','Upload a valid single-frame JPEG, PNG or WebP image under 20 megapixels'); }
  const hash=digest(encoded),filename=`${owner}/${hash}.jpg`;
  await mkdir(path.join(config.dataDir,'images',owner),{recursive:true});
  await writeFile(path.join(config.dataDir,'images',filename),encoded);
  return store.addImage(owner,hash,filename,pipelineVersion(config));
}
