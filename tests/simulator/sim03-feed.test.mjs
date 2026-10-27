import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {resolve} from 'node:path';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';
const require=createRequire(import.meta.url),base=resolve(process.env.SIM03_SOURCE||'tools/simulator/dist');
const {Queue}=require(base+'/queue.js'),{FeedControl,feedInterval}=require(base+'/feed-control.js');
const snap={detector:{data:{step_m:'0.5',speed_m_min:'1'}},interval_ms:30000};
test('speed range respects step and polling interval, without rounding invalid inputs into valid speed',()=>{assert.equal(feedInterval('0.5','60'),500);assert.equal(feedInterval('0.5','0.5'),60000);assert.throws(()=>feedInterval('0.5','0'));assert.throws(()=>feedInterval('0.5','601'));assert.throws(()=>feedInterval('0.5','0.1'));assert.throws(()=>feedInterval('0.001','600'));});
test('speed changes append versions, preserve snapshot, reject stale writes and stopped runs',()=>{
 const dir=mkdtempSync(tmpdir()+'/sim03-'),q=new Queue(dir+'/data.sqlite');try{const feed=new FeedControl(q);q.db.prepare("INSERT INTO sim_run(id,device_id,capture_session,scenario,seed,target,assignment,created_at) VALUES('r','d','s','cable',0,8,'{}','now')").run();
 assert.equal(feed.current('r',snap).version,0);const changed=feed.change('r',snap,{speed_m_min:'60',version:0});assert.equal(changed.first_sequence,1);assert.equal(changed.interval_ms,500);assert.equal(feed.change('r',snap,{speed_m_min:'60',version:0}).version,1);assert.throws(()=>feed.change('r',snap,{speed_m_min:'30',version:0}),e=>e.status===412);assert.equal(snap.detector.data.speed_m_min,'1');
 q.db.prepare("UPDATE sim_run SET control='STOPPED'").run();assert.throws(()=>feed.change('r',snap,{speed_m_min:'30',version:1}),e=>e.status===409);
 }finally{q.db.close();rmSync(dir,{recursive:true});}
});
test('a committed pause or stop blocks a sample prepared before control change',()=>{
 const dir=mkdtempSync(tmpdir()+'/sim03-'),q=new Queue(dir+'/data.sqlite');try{q.db.prepare("INSERT INTO sim_run(id,device_id,capture_session,scenario,seed,target,assignment,created_at) VALUES('r','d','s','cable',0,8,'{}','now')").run();const row={record_id:'r-1',capture_sequence:'1'};
 for(const control of ['PAUSED','STOPPED']){q.db.prepare('UPDATE sim_run SET control=?').run(control);assert.equal(q.saveSample('r',row),false);assert.equal(q.run('r').generated,0);}
 q.db.prepare("UPDATE sim_run SET control='RUNNING'").run();assert.equal(q.saveSample('r',row),true);assert.equal(q.run('r').generated,1);
 }finally{q.db.close();rmSync(dir,{recursive:true});}
});
