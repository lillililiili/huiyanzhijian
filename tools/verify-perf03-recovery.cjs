const fs=require('fs'),cp=require('child_process'),{Pool}=require('../apps/platform/node_modules/pg'),{randomUUID:uid}=require('crypto'),assert=require('assert/strict');const env=JSON.parse(fs.readFileSync('runtime/perf03/test-env.json')),access=JSON.parse(fs.readFileSync('runtime/b1/access.json')),templates=JSON.parse(fs.readFileSync('runtime/perf03/templates.json'));const db=new Pool({connectionString:env.DATABASE_URL}),cases=[];
if(new URL(env.DATABASE_URL).hostname!=='127.0.0.1'||new URL(env.DATABASE_URL).port!=='45293')throw Error('PERF03 requires isolated PG port 45293');
async function send(records){const r=await fetch('http://127.0.0.1:45300/api/v1/measurements:ingest',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+access.device_token,'X-Huiyan-Edge-Token':env.OVALITY_EDGE_TOKEN},body:JSON.stringify({schema_version:'1.0',batch_id:uid(),sent_at:new Date().toISOString(),records})});return {status:r.status,data:(await r.json()).data};}
const point=()=>({...structuredClone(templates[0]),record_id:'recovery-'+uid(),capture_sequence:String(BigInt(Date.now())*1000n+BigInt(Math.floor(Math.random()*1000)))});
(async()=>{
 const a=point();assert.equal((await send([a])).data.counts.stored,1);
 cp.execFileSync('docker',['stop','huiyan-perf03-ts']);
 assert.equal((await send([a])).data.counts.duplicate,1);const b=point();assert.equal((await send([b])).status,503);cases.push('时序断开：既有回执可重读，新点无PG提交');
 cp.execFileSync('docker',['start','huiyan-perf03-ts']);await new Promise(r=>setTimeout(r,5000));assert.equal((await send([b])).data.counts.stored,1);cases.push('时序恢复：同来源重放成功');
 await db.query("CREATE FUNCTION m04.perf03_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'PERF03 isolated fault'; END $$; CREATE TRIGGER perf03_fault BEFORE INSERT ON m04.measurement_record FOR EACH ROW EXECUTE FUNCTION m04.perf03_fail()");
 const c=point();assert.equal((await send([c])).status,503);assert.equal(Number((await db.query('select count(*) from m04.measurement_record where source_record_key=$1',[c.record_id])).rows[0].count),0);
 await db.query('DROP TRIGGER perf03_fault ON m04.measurement_record; DROP FUNCTION m04.perf03_fail()');assert.equal((await send([c])).data.counts.stored,1);assert.equal((await send([c])).data.counts.duplicate,1);cases.push('TS成功PG失败：原键重试恢复，派生结果与统计不重复');
 const conflict={...c,source_sequence:'999'};const v=await send([conflict]);assert.equal(v.data.counts.rejected,1);cases.push('同键异内容拒绝');console.log(cases);
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(async()=>{cp.execFileSync('docker',['start','huiyan-perf03-ts']);await db.query('DROP TRIGGER IF EXISTS perf03_fault ON m04.measurement_record; DROP FUNCTION IF EXISTS m04.perf03_fail()');fs.writeFileSync('runtime/perf03/recovery-result.json',JSON.stringify({cases,passed:cases.length===4},null,2));await db.end()});

