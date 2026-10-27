import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
export class Queue{
 readonly db:DatabaseSync;
 constructor(path:string){mkdirSync(dirname(path),{recursive:true});this.db=new DatabaseSync(path);this.db.exec(`PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS sim_run(id TEXT PRIMARY KEY,device_id TEXT NOT NULL,capture_session TEXT NOT NULL,scenario TEXT NOT NULL,seed INTEGER NOT NULL,target INTEGER NOT NULL,generated INTEGER NOT NULL DEFAULT 0,control TEXT NOT NULL DEFAULT 'RUNNING',assignment TEXT NOT NULL,ack TEXT,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sample(record_id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES sim_run(id),sequence INTEGER NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'PENDING',receipt TEXT,attempts INTEGER NOT NULL DEFAULT 0,UNIQUE(run_id,sequence));
 CREATE TABLE IF NOT EXISTS delivery_attempt(id INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL,at TEXT NOT NULL,request_id TEXT,result TEXT NOT NULL,detail TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS producer_lease(device_id TEXT PRIMARY KEY,owner TEXT NOT NULL,expires_at INTEGER NOT NULL);`);}
 transaction<T>(fn:()=>T){this.db.exec('BEGIN IMMEDIATE');try{const value=fn();this.db.exec('COMMIT');return value;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 run(id:string):any{return this.db.prepare('SELECT * FROM sim_run WHERE id=?').get(id);}
 pending(id:string):any[]{return this.db.prepare("SELECT * FROM sample WHERE run_id=? AND state IN('PENDING','UNKNOWN') ORDER BY sequence LIMIT 50").all(id);}
 saveSample(runId:string,record:any){return this.transaction(()=>{if(this.run(runId)?.control!=='RUNNING')return false;this.db.prepare('INSERT INTO sample(record_id,run_id,sequence,payload) VALUES(?,?,?,?)').run(record.record_id,runId,Number(record.capture_sequence),JSON.stringify(record));this.db.prepare('UPDATE sim_run SET generated=generated+1 WHERE id=?').run(runId);return true;});}
 lease(device:string,owner:string){this.transaction(()=>{const old=this.db.prepare('SELECT * FROM producer_lease WHERE device_id=?').get(device);if(old&&Number(old.expires_at)>Date.now()&&old.owner!==owner)throw Error('Another producer holds this device queue');this.db.prepare('INSERT INTO producer_lease VALUES(?,?,?) ON CONFLICT(device_id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at').run(device,owner,Date.now()+30000);});}
 release(device:string,owner:string){this.db.prepare('DELETE FROM producer_lease WHERE device_id=? AND owner=?').run(device,owner);}
 status(id?:string){return this.db.prepare(`SELECT r.id,r.device_id,r.scenario,r.control,r.target,r.generated,s.state,count(s.record_id) AS records FROM sim_run r LEFT JOIN sample s ON r.id=s.run_id ${id?'WHERE r.id=?':''} GROUP BY r.id,s.state ORDER BY r.created_at,s.state`).all(...(id?[id]:[]));}
}
