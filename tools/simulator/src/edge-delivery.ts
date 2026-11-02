import {Queue} from './queue';
import {edgeRequest} from './edge-client';
import {randomUUID} from 'node:crypto';

// Independent local custody and center confirmation lanes. Neither removes
// source payloads; only a real persisted center receipt changes sample.state.
export class EdgeDelivery {
 private nextSend=0;private attempt=0;private nextReceipt=0;
 constructor(private q:Queue,private runId:string){}
 async send(){
  if(Date.now()<this.nextSend)return;
  const candidates=this.q.db.prepare(`SELECT s.* FROM sample s LEFT JOIN edge_local_accept a ON a.record_id=s.record_id
   WHERE s.run_id=? AND s.state IN('PENDING','UNKNOWN') AND a.record_id IS NULL ORDER BY s.sequence LIMIT 500`).all(this.runId) as any[];
  const pending:any[]=[];let bytes=1024;
  for(const row of candidates){const size=Buffer.byteLength(row.payload)+1;if(pending.length&&bytes+size>800000)break;pending.push(row);bytes+=size;}
  if(!pending.length)return;
  const records=pending.map(r=>JSON.parse(r.payload)),batch='local-'+randomUUID();
  try{
   const reply=await edgeRequest('/measurements:accept',{schema_version:'1.0',batch_id:batch,sent_at:new Date().toISOString(),records});
   if(reply.schema_version!=='edge-local.1'||reply.batch_id!==batch||!Array.isArray(reply.items)||reply.items.length!==records.length)throw Error('Invalid local custody receipt');
   reply.items.forEach((item:any,i:number)=>{if(item.status!=='LOCAL_DURABLE'||item.source_id!==records[i].record_id||item.device_id!==records[i].device_id||!Number.isSafeInteger(item.sample_id)||item.sample_id<=0)throw Error('Local receipt identity mismatch');});
   this.q.transaction(()=>{for(const row of pending)this.q.db.prepare('INSERT OR REPLACE INTO edge_local_accept(record_id,accepted_at) VALUES(?,?)').run(row.record_id,new Date().toISOString());});
   this.attempt=0;this.nextSend=Date.now()+50;
  }catch(e){
   this.nextSend=Date.now()+Math.min(5000,100*2**Math.min(this.attempt++,6));
   this.q.db.prepare('INSERT INTO delivery_attempt(run_id,at,result,detail) VALUES(?,?,?,?)').run(this.runId,new Date().toISOString(),'LOCAL_RETRY',e instanceof Error?e.message:'Local receipt unavailable; original retained');
  }
 }
 async receipts(){
  if(Date.now()<this.nextReceipt)return;this.nextReceipt=Date.now()+1000;
  const pending=this.q.db.prepare(`SELECT s.* FROM sample s JOIN edge_local_accept a ON a.record_id=s.record_id
   WHERE s.run_id=? AND s.state IN('PENDING','UNKNOWN') ORDER BY s.sequence LIMIT 500`).all(this.runId) as any[];
  if(!pending.length)return;
  const records=pending.map(row=>{const p=JSON.parse(row.payload);return {record_id:p.record_id,device_id:p.device_id};});
  try{
   const reply=await edgeRequest('/measurement-receipts',{records});
   if(reply.schema_version!=='edge-receipts.1'||!Array.isArray(reply.items)||reply.items.length!==records.length)throw Error('Invalid center receipt query');
   reply.items.forEach((item:any,i:number)=>{
    if(item.source_id!==records[i].record_id||item.device_id!==records[i].device_id||typeof item.local_durable!=='boolean')throw Error('Receipt identity mismatch');
    const r=item.receipt;if(r===null)return;
    if(!r||r.source_id!==records[i].record_id||!['STORED','DUPLICATE','QUARANTINED','REJECTED'].includes(r.receipt_status))throw Error('Invalid center result');
    if(r.receipt_status==='DUPLICATE'&&!['STORED','QUARANTINED','REJECTED'].includes(r.initial_status))throw Error('Invalid duplicate result');
    if(r.receipt_status==='REJECTED'&&typeof r.retryable!=='boolean')throw Error('Invalid rejected result');
   });
   this.q.transaction(()=>{
    for(let i=0;i<pending.length;i++){
     const item=reply.items[i],r=item.receipt;
     if(!item.local_durable){this.q.db.prepare('DELETE FROM edge_local_accept WHERE record_id=?').run(records[i].record_id);continue;}
     if(!r||r.receipt_status==='REJECTED'&&r.retryable)continue;
     const state=r.receipt_status==='DUPLICATE'?r.initial_status:r.receipt_status;
     this.q.db.prepare('UPDATE sample SET state=?,receipt=?,attempts=attempts+1 WHERE record_id=?').run(state,JSON.stringify(r),records[i].record_id);
    }
   });
  }catch{this.nextReceipt=Date.now()+2000;}
 }
}
