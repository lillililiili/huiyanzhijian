// Targeted PERF01 migration for an existing 015 database. Does not rewrite or
// replay historical migrations. Use full db/migrate.ts for a new database.
const fs=require('fs'),p=require('path'),crypto=require('crypto'),{Pool}=require('../apps/platform/node_modules/pg');
async function main(){
 if(process.env.PERF01_BACKUP_CONFIRMED!=='yes'||!process.env.MIGRATION_DATABASE_URL)throw Error('Verified backup and migration credentials required');
 const db=new Pool({connectionString:process.env.MIGRATION_DATABASE_URL}),client=await db.connect();
 const version='016_calculated_projections.sql',sql=fs.readFileSync(p.join(__dirname,'../apps/platform/db/migrations',version),'utf8'),checksum=crypto.createHash('sha256').update(sql).digest('hex');
 try{await client.query('SELECT pg_advisory_lock(71021001)');
 const old=(await client.query('SELECT checksum FROM hy_schema_migration WHERE version=$1',[version])).rows[0];if(old){if(old.checksum!==checksum)throw Error('PERF01 checksum changed');console.log('PERF01 already applied');return;}
 if(!(await client.query("SELECT 1 FROM hy_schema_migration WHERE version='015_ovality_timeseries.sql'")).rowCount)throw Error('015 baseline required');
 await client.query('SELECT r.raw_payload,r.payload_hash,v.metric_code,v.value,v.data_status FROM m04.measurement_record r JOIN m04.measurement_value v ON v.record_id=r.id LIMIT 0');
 await client.query('BEGIN');try{await client.query(sql);await client.query('INSERT INTO hy_schema_migration(version,checksum) VALUES($1,$2)',[version,checksum]);await client.query('COMMIT');console.log('Applied only 016_calculated_projections.sql; historical checksums preserved.');}catch(e){await client.query('ROLLBACK');throw e;}
 }finally{await client.query('SELECT pg_advisory_unlock(71021001)');client.release();await db.end();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
