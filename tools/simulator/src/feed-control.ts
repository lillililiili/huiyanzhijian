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
  constructor(readonly q:Queue){
    q.db.exec(`
      CREATE TABLE IF NOT EXISTS feed_speed_revision(
        run_id TEXT NOT NULL,version INTEGER NOT NULL,speed_m_min TEXT NOT NULL,interval_ms INTEGER NOT NULL,
        first_sequence INTEGER NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(run_id,version)
      );
      CREATE TABLE IF NOT EXISTS cut_spool_event(
        run_id TEXT PRIMARY KEY,device_id TEXT NOT NULL,spool_id TEXT,position_m TEXT NOT NULL,
        planned_length_m TEXT NOT NULL,status TEXT NOT NULL,response TEXT,created_at TEXT NOT NULL
      );
    `);
  }

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

  /**
   * 监控送料总米数是否到达任务计划米数 planned_length_m
   * 到达设定米数时，自动停止送料，并通过 client 发送 CUT_SPOOL 生产切盘事件
   */
  async checkAutoCutSpool(params:{
    runId:string;
    currentPositionM:number|string;
    plannedLengthM:number|string;
    deviceId:string;
    spoolId?:string|null;
    client?:any;
  }):Promise<{cut:boolean;position_m:string;event_sent:boolean;response?:any}>{
    const cur=Number(params.currentPositionM),planned=Number(params.plannedLengthM);
    if(isNaN(cur)||isNaN(planned)||cur<planned){
      return {cut:false,position_m:String(params.currentPositionM),event_sent:false};
    }

    // 到达计划米数，停止送料
    this.q.db.prepare("UPDATE sim_run SET control='STOPPED' WHERE id=?").run(params.runId);

    const existing=this.q.db.prepare('SELECT * FROM cut_spool_event WHERE run_id=?').get(params.runId) as any;
    if(existing){
      return {cut:true,position_m:existing.position_m,event_sent:true,response:existing.response?JSON.parse(existing.response):null};
    }

    let response=null;
    if(params.client&&typeof params.client.sendCutSpoolEvent==='function'){
      try{
        response=await params.client.sendCutSpoolEvent({
          device_id:params.deviceId,
          spool_id:params.spoolId,
          position_m:cur.toFixed(4),
        });
      }catch(e:any){
        response={error:e.message};
      }
    }

    this.q.db.prepare('INSERT INTO cut_spool_event(run_id,device_id,spool_id,position_m,planned_length_m,status,response,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(params.runId,params.deviceId,params.spoolId||null,cur.toFixed(4),planned.toFixed(4),'CUT',response?JSON.stringify(response):null,new Date().toISOString());

    return {cut:true,position_m:cur.toFixed(4),event_sent:!!response,response};
  }

  isCutSpoolTriggered(runId:string):boolean{
    const row=this.q.db.prepare('SELECT 1 FROM cut_spool_event WHERE run_id=?').get(runId);
    return !!row;
  }

  getCutSpoolEvent(runId:string):any{
    const row=this.q.db.prepare('SELECT * FROM cut_spool_event WHERE run_id=?').get(runId) as any;
    if(!row)return null;
    return {...row,response:row.response?JSON.parse(row.response):null};
  }

  summary(id:string,snapshot:Snapshot){
    const row=this.q.db.prepare('SELECT payload,state FROM sample WHERE run_id=? ORDER BY sequence DESC LIMIT 1').get(id) as any;
    const last=row?JSON.parse(row.payload):null;
    return {
      cable_name:snapshot.cable.data.name,
      detector_name:snapshot.detector.data.name,
      length_m:snapshot.cable.data.length_m,
      step_m:snapshot.detector.data.step_m,
      speed:this.current(id,snapshot),
      cut_spool:this.getCutSpoolEvent(id),
      last_sample:last?{position_m:last.position_m,time:last.sample_time,value:last.values[0].value,unit:last.values[0].unit,result:last.values[0].source_quality_result,receipt_state:row.state,observation:last.raw?.data?.observation||null}:null,
    };
  }
}
