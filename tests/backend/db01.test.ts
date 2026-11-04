import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadMigrations,planMigrations} from '../../apps/platform/db/migration-runner';
import {assertDatabaseViews,DatabaseReadinessError} from '../../apps/platform/infrastructure/database-readiness';
test('DB01 validates all applied checksums before returning any pending migration',()=>{
 const files=[{version:'001.sql',checksum:'one',sql:''},{version:'002.sql',checksum:'two',sql:''}];
 assert.throws(()=>planMigrations(files,[{version:'002.sql',checksum:'changed'}]),/checksum changed/);
 assert.throws(()=>planMigrations(files,[{version:'003.sql',checksum:'three'}]),/missing from source/);
 assert.throws(()=>planMigrations(files,[],'unknown.sql'),/Unknown migration target/);
 assert.deepEqual(planMigrations(files,[],'001.sql').map(f=>f.version),['001.sql']);
 assert.deepEqual(planMigrations(files,files),[]);
});
test('DB01 line endings are portable but content changes remain visible',()=>{
 const dir=mkdtempSync(join(tmpdir(),'huiyan-db01-'));
 try{writeFileSync(join(dir,'001.sql'),'SELECT 1;\r\n');const first=loadMigrations(dir)[0];
 writeFileSync(join(dir,'001.sql'),'SELECT 1;\n');assert.equal(loadMigrations(dir)[0].checksum,first.checksum);
 assert.deepEqual(planMigrations(loadMigrations(dir),[{version:'001.sql',checksum:first.crlfChecksum!}]),[]);
 writeFileSync(join(dir,'001.sql'),'SELECT 2;\n');assert.notEqual(loadMigrations(dir)[0].checksum,first.checksum);
 }finally{rmSync(dir,{recursive:true});}
});
test('DB01 startup is read only; permission/schema failures cannot be swallowed',async()=>{
 const calls:string[]=[];await assertDatabaseViews({query:async(sql:string)=>{calls.push(sql);return {rows:[]};}} as any);
 assert.equal(calls.length,4);assert.ok(calls.every(sql=>/^SELECT .+ LIMIT 0$/.test(sql)));
 for(const code of ['42501','42P01'])await assert.rejects(()=>assertDatabaseViews({query:async()=>{throw {code,message:'secret connection detail'};}} as any),
 (e:any)=>e instanceof DatabaseReadinessError&&e.sqlstate===code&&e.object==='m04.measurement_raw'&&!e.message.includes('secret'));
});
