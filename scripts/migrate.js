import { config } from '../src/config.js';
import { database,migrate } from '../src/db.js';
const pool=database(config().databaseUrl);
try{await migrate(pool);console.log('Database migrations applied.');}finally{await pool.end();}
