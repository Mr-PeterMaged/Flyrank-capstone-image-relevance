import { readFile,writeFile,mkdir } from 'node:fs/promises';
import path from 'node:path';
import { config,root } from '../src/config.js';
import { database } from '../src/db.js';
import { Store } from '../src/store.js';
import { rank } from '../src/guard.js';
const settings=config(),pool=database(settings.databaseUrl),store=new Store(pool);
try{
  const mapping=JSON.parse(await readFile(path.join(settings.dataDir,'seed-map.json'),'utf8'));
  const specs=JSON.parse(await readFile(path.join(root,'evals','posts.json'),'utf8'));
  const inverse=Object.fromEntries(Object.entries(mapping.images).map(([source,id])=>[id,source]));
  const status=await store.rows('SELECT status,count(*)::int AS count FROM images WHERE owner_id=$1 GROUP BY status',[mapping.ownerId]);
  if(status.some(r=>['pending','failed'].includes(r.status)))throw new Error('Finish real processing before reporting evaluation; some images are pending/failed.');
  const data=new Map();for(const spec of specs)data.set(spec.id,await store.matchingData(mapping.ownerId,mapping.posts[spec.id],settings.embeddingModel));
  function score(entries,thresholds){
    const rows=entries.map(spec=>{const d=data.get(spec.id),ranked=rank(d.post,d.images,{...settings,...thresholds}),top=ranked.find(r=>r.accepted);const selected=top?inverse[top.imageId]:null;
      const chosen=top?d.images.find(i=>i.id===top.imageId):null;
      return {post:spec.id,expected:spec.correctImage,selected,correct:selected===spec.correctImage,subjectCorrect:spec.subject===null?!top:chosen?.metadata?.subject===spec.subject,similarity:top?.similarity??null,abstained:!top};});
    const positive=rows.filter(r=>r.expected!==null),offered=positive.filter(r=>!r.abstained);
    return {rows,positivePosts:positive.length,exactTop1:positive.filter(r=>r.correct).length/positive.length,decisionAccuracy:rows.filter(r=>r.correct).length/rows.length,coverage:offered.length/positive.length,subjectTop1:positive.filter(r=>r.subjectCorrect).length/positive.length,offeredPrecision:offered.length?offered.filter(r=>r.correct).length/offered.length:null,noMatchCorrect:rows.filter(r=>r.expected===null&&r.correct).length,noMatchCases:rows.filter(r=>r.expected===null).length};
  }
  const calibration=specs.filter(p=>p.split==='calibration'),test=specs.filter(p=>p.split==='test');
  let best;
  for(const confidence of [.75,.8,.85,.9,.95])for(const similarity of [.2,.3,.4,.5,.6,.7]){
    const result=score(calibration,{confidence,similarity});const value=result.exactTop1-2*result.rows.filter(r=>!r.abstained&&!r.subjectCorrect).length;
    if(!best||value>best.value||(value===best.value&&result.coverage>best.result.coverage))best={confidence,similarity,value,result};
  }
  const thresholds={confidence:best.confidence,similarity:best.similarity};
  const result={provider:'ollama',visionModel:settings.visionModel,embeddingModel:settings.embeddingModel,calibrationPosts:calibration.length,thresholds,imageStatuses:status,
    calibration:best.result,test:score(test,thresholds),labelProvenance:'AI-assisted manual labels from a visual contact sheet before model inference; intern review recommended. Curation search keywords are never model inputs.',limitations:['Small curated benchmark, not a production accuracy guarantee.','Self-reported model confidence is not calibrated probability.','Strict single-image labels penalize other plausible images.']};
  await mkdir(path.join(root,'docs','proof'),{recursive:true});
  await writeFile(path.join(root,'docs','proof','real-evaluation.json'),JSON.stringify(result,null,2)+'\n');
  await writeFile(path.join(root,'evals','thresholds.json'),JSON.stringify({...thresholds,selectedOn:'calibration only'},null,2)+'\n');
  console.log(`REAL MODEL EVALUATION: exact-image top-1 ${(result.test.exactTop1*100).toFixed(1)}% (${result.test.positivePosts} positive held-out posts); subject top-1 ${(result.test.subjectTop1*100).toFixed(1)}%; coverage ${(result.test.coverage*100).toFixed(1)}%; no-match ${result.test.noMatchCorrect}/${result.test.noMatchCases}.`);
  console.log(`Selected thresholds on ${calibration.length} calibration posts: ${JSON.stringify(thresholds)}`);
}finally{await pool.end();}
