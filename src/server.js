import { config } from './config.js';
import { database,migrate } from './db.js';
import { Store } from './store.js';
import { createApp } from './app.js';
import { worker } from './worker.js';
const settings=config(),pool=database(settings.databaseUrl);
await migrate(pool);
const store=new Store(pool),processor=worker(store,settings);
const server=createApp(store,settings).listen(settings.port,settings.host,()=>console.log(`Lens workspace: http://localhost:${settings.port}`));
if(settings.workerEnabled)processor.start();
let closing=false;
async function stop(){if(closing)return;closing=true;await Promise.all([new Promise(r=>server.close(r)),processor.stop()]);await pool.end();}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
server.on('error',e=>{console.error(`Server failed: ${e.code}`);stop().then(()=>{process.exitCode=1;});});
