import {resolve} from 'node:path';
import {runMigrations} from './migration-runner';
async function main(){
 if(!process.env.MIGRATION_DATABASE_URL)throw Error('MIGRATION_DATABASE_URL is required; runtime credentials cannot migrate');
 const args=process.argv.slice(2);let through:string|undefined,checkOnly=false;
 for(let i=0;i<args.length;i++){
  if(args[i]==='--check')checkOnly=true;
  else if(args[i]==='--through'&&args[i+1])through=args[++i];
  else throw Error('Usage: migrate [--check] [--through migration.sql]');
 }
 await runMigrations({connectionString:process.env.MIGRATION_DATABASE_URL,directory:resolve('db/migrations'),through,checkOnly});
}
main().catch(e=>{
 const message=String(e?.message??'');
 const detail=/^(Applied migration |Unknown migration target: |Usage: |MIGRATION_DATABASE_URL)/.test(message)?message:'Database operation failed; check availability and migration role privileges';
 console.error(JSON.stringify({event:'MIGRATION_FAILED',detail,sqlstate:/^[0-9A-Z]{5}$/.test(e?.code)?e.code:undefined}));process.exitCode=1;
});
