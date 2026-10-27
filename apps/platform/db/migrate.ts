import {Pool} from 'pg';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {sha} from '../infrastructure/canonical';
async function main(){
 if(!process.env.MIGRATION_DATABASE_URL)throw Error('MIGRATION_DATABASE_URL is required; runtime credentials cannot migrate');
 const pool=new Pool({connectionString:process.env.MIGRATION_DATABASE_URL});const c=await pool.connect();
 try{await c.query("SELECT pg_advisory_lock(71021001)");await c.query('CREATE TABLE IF NOT EXISTS public.hy_schema_migration(version text PRIMARY KEY, checksum char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
 for(const file of readdirSync(resolve('db/migrations')).filter(f=>f.endsWith('.sql')).sort()){
 const sql=readFileSync(resolve('db/migrations',file),'utf8'),hash=sha(sql),old=await c.query('SELECT checksum FROM public.hy_schema_migration WHERE version=$1',[file]);
 if(old.rowCount){if(old.rows[0].checksum!==hash)throw Error('Applied migration checksum changed: '+file);continue;}
 await c.query('BEGIN');try{await c.query(sql);await c.query('INSERT INTO public.hy_schema_migration(version,checksum) VALUES($1,$2)',[file,hash]);await c.query('COMMIT');console.log('applied '+file);}catch(e){await c.query('ROLLBACK');throw e;}
 }}finally{await c.query('SELECT pg_advisory_unlock(71021001)');c.release();await pool.end();}
}
main().catch(()=>{console.error('Migration failed; verify database role, migration checksum and connectivity.');process.exitCode=1;});
