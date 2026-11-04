import {Pool} from 'pg';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {sha} from '../infrastructure/canonical';

export type Migration={version:string;sql:string;checksum:string;crlfChecksum?:string};
export function loadMigrations(directory:string):Migration[]{
 return readdirSync(directory).filter(f=>f.endsWith('.sql')).sort().map(version=>{
  const sql=readFileSync(join(directory,version),'utf8').replace(/\r\n/g,'\n');
  return {version,sql,checksum:sha(sql),crlfChecksum:sha(sql.replace(/\n/g,'\r\n'))};
 });
}
export function planMigrations(files:Migration[],applied:{version:string;checksum:string}[],through?:string){
 if(through&&!files.some(f=>f.version===through))throw Error('Unknown migration target: '+through);
 const indexed=new Map(files.map(f=>[f.version,f]));
 for(const row of applied){
  const file=indexed.get(row.version);
  if(!file)throw Error('Applied migration missing from source: '+row.version);
  if(file.checksum!==row.checksum&&file.crlfChecksum!==row.checksum)throw Error('Applied migration checksum changed: '+row.version);
 }
 const done=new Set(applied.map(r=>r.version));
 return files.filter(f=>!done.has(f.version)&&(!through||f.version<=through));
}
export async function runMigrations(options:{connectionString:string;directory:string;through?:string;checkOnly?:boolean},log:(s:string)=>void=console.log){
 const files=loadMigrations(options.directory);
 const pool=new Pool({connectionString:options.connectionString,max:1,connectionTimeoutMillis:5000,application_name:'huiyan-migrator-db01'});
 let c;let locked=false;
 try{
  c=await pool.connect();await c.query("SET lock_timeout='10s'");
  await c.query('SELECT pg_advisory_lock(71021001)');locked=true;
  const exists=(await c.query("SELECT to_regclass('public.hy_schema_migration') IS NOT NULL AS present")).rows[0].present;
  const applied=exists?(await c.query('SELECT version,checksum FROM public.hy_schema_migration ORDER BY version')).rows:[];
  // Validate every applied file before executing any pending DDL.
  const pending=planMigrations(files,applied,options.through);
  log(JSON.stringify({event:'MIGRATION_PLAN',mode:options.checkOnly?'check':'apply',through:options.through??'all',pending:pending.map(f=>f.version)}));
  if(options.checkOnly)return pending.map(f=>f.version);
  if(!exists)await c.query('CREATE TABLE public.hy_schema_migration(version text PRIMARY KEY,checksum char(64) NOT NULL,applied_at timestamptz(6) NOT NULL DEFAULT now())');
  for(const f of pending){
   await c.query('BEGIN');
   try{
    await c.query(f.sql);await c.query('INSERT INTO public.hy_schema_migration(version,checksum) VALUES($1,$2)',[f.version,f.checksum]);
    await c.query('COMMIT');log('applied '+f.version);
   }catch(e){await c.query('ROLLBACK');throw e;}
  }
  return pending.map(f=>f.version);
 }finally{try{if(c){try{if(locked)await c.query('SELECT pg_advisory_unlock(71021001)');}finally{c.release();}}}finally{await pool.end();}}
}
