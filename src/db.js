import pg from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { root } from './config.js';
export function database(url) { return new pg.Pool({ connectionString:url, max:8 }); }
export async function transaction(pool, fn) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
export async function migrate(pool) {
  await transaction(pool,async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(7823412)");
    await client.query('CREATE TABLE IF NOT EXISTS migrations(name text PRIMARY KEY,applied_at timestamptz DEFAULT now())');
    for (const name of readdirSync(path.join(root,'migrations')).filter((n)=>n.endsWith('.sql')).sort()) {
      if ((await client.query('SELECT name FROM migrations WHERE name=$1',[name])).rowCount) continue;
      await client.query(readFileSync(path.join(root,'migrations',name),'utf8'));
      await client.query('INSERT INTO migrations(name) VALUES($1)',[name]);
    }
  });
}
