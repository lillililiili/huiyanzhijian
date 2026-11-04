import type {Queue} from './queue';
import {fixed,insist,keys} from './cable-model';
import type {Snapshot} from './model-store';

export function feedInterval(step:string,speed:string){
  const value=fixed(speed,600);insist(value>0n,'送料速度必须大于0，最大600 m/min');
  const interval=Math.round(Number(fixed(step))/Number(value)*60000);
  insist(interval>=50&&interval<=60000,'当前采样步长下，送料间隔须在50～60000毫秒；请调整速度');
  return interval;
}

// Runtime speed is separate from immutable cable/detector snapshots.
export class FeedControl{
  constructor(readonly q:Queue){q.db.exec(`CREATE TABLE IF NOT EXISTS feed_speed_revision(
    run_id TEXT NOT NULL,version INTEGER NOT NULL,speed_m_min TEXT NOT NULL,interval_ms INTEGER NOT NULL,
    first_sequence INTEGER NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(run_id,version));`);}
  current(id:string,snapshot:Snapshot){
    return this.q.db.prepare('SELECT * FROM feed_speed_revision WHERE run_id=? ORDER BY version DESC LIMIT 1').get(id) as any ||
      {run_id:id,version:0,speed_m_min:snapshot.detector.data.speed_m_min,interval_ms:snapshot.interval_ms,first_sequence:1,created_at:null};
  }
  change(id:string,snapshot:Snapshot,b:any){
    keys(b,['speed_m_min','version']);insist(Number.isInteger(b.version)&&b.version>=0,'速度版本无效');
    const interval=feedInterval(snapshot.detector.data.step_m,b.speed_m_min);
    return this.q.transaction(()=>{
      const next=this.q.db.prepare('SELECT * FROM feed_speed_revision WHERE run_id=? AND version=?').get(id,b.version+1) as any;
      if(next?.speed_m_min===b.speed_m_min)return next;
      const prior=this.current(id,snapshot);insist(prior.version===b.version,'送料速度已变化，请刷新后重试',412,'FEED_VERSION_CONFLICT');
      const run=this.q.run(id);insist(run&&run.generated<run.target&&run.control!=='STOPPED','本次送料已停止或完成，不能调速',409,'FEED_NOT_ACTIVE');
      this.q.db.prepare('INSERT INTO feed_speed_revision VALUES(?,?,?,?,?,?)').run(id,b.version+1,b.speed_m_min,interval,run.generated+1,new Date().toISOString());
      return this.current(id,snapshot);
    });
  }
  summary(id:string,snapshot:Snapshot){
    const row=this.q.db.prepare('SELECT payload,state FROM sample WHERE run_id=? ORDER BY sequence DESC LIMIT 1').get(id) as any;
    const last=row?JSON.parse(row.payload):null;
    return {cable_name:snapshot.cable.data.name,detector_name:snapshot.detector.data.name,length_m:snapshot.cable.data.length_m,
      step_m:snapshot.detector.data.step_m,speed:this.current(id,snapshot),
      last_sample:last?{position_m:last.position_m,time:last.sample_time,value:last.values[0].value,unit:last.values[0].unit,result:last.values[0].source_quality_result,receipt_state:row.state}:null};
  }
}
