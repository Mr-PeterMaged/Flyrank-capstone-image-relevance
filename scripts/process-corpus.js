import { config } from '../src/config.js';
import { database } from '../src/db.js';
import { Store } from '../src/store.js';
import { worker } from '../src/worker.js';
import { pipelineVersion } from '../src/ingest.js';
const settings=config(),pool=database(settings.databaseUrl),store=new Store(pool),processor=worker(store,settings);
try{
  while(true){
    const pending=await store.one("SELECT count(*)::int AS n FROM jobs WHERE version=$1 AND status IN ('pending','processing')",[pipelineVersion(settings)]);
    if(!pending.n)break;
    const did=await processor.tick();
    const counts=await store.rows('SELECT status,count(*)::int AS count FROM jobs GROUP BY status ORDER BY status');
    if(did)console.log(JSON.stringify({progress:counts}));
    if(!did)await new Promise(r=>setTimeout(r,1000));
  }
  console.log('Batch finished:',JSON.stringify(await store.rows('SELECT status,count(*)::int AS count FROM images GROUP BY status')));
}finally{await processor.stop();await pool.end();}
