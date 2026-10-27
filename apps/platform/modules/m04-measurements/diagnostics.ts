import {pool,transaction,timestamp} from '../../infrastructure/db';
import {allow,type Actor} from '../m00-identity/api';
import {pageQuery} from '../../infrastructure/admin-query';
import {requireValue} from '../../infrastructure/errors';
export async function diagnostics(actor:Actor,q:Record<string,string>){
 allow(actor,'logs:read','USER');const {page,limit}=pageQuery(q,['from','to','request_id','state','id','task_id','device_id']);if(q.state)requireValue(['PROCESSING','COMPLETED'].includes(q.state));const args:any[]=[actor.factory],where=['factory_id=$1'];
 for(const k of ['request_id','state','id'])if(q[k]){args.push(q[k]);where.push(`${k}::text=$${args.length}`);}for(const k of ['from','to'])if(q[k]){args.push(q[k]);where.push(`received_at${k==='from'?'>=':'<'}$${args.length}::timestamptz`);}
 if(q.task_id||q.device_id){args.push(q.task_id||'',q.device_id||'');where.push(`EXISTS(SELECT 1 FROM m04.ingestion_item i JOIN m04.measurement_record r ON r.id=i.stored_id WHERE i.batch_id=b.id AND r.factory_id=b.factory_id AND ($${args.length-1}='' OR r.task_id=$${args.length-1}) AND ($${args.length}='' OR r.device_id=$${args.length}))`);}
 return transaction(async db=>{await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');const count=await db.query('SELECT count(*)::int AS n FROM m04.ingestion_batch b WHERE '+where.join(' AND '),args);const rows=await db.query(`SELECT id,request_id,source_batch_id,state,total,stored,duplicate,quarantined,rejected,${timestamp('received_at')} AS received_at FROM m04.ingestion_batch b WHERE ${where.join(' AND ')} ORDER BY received_at DESC,id DESC LIMIT $${args.length+1} OFFSET $${args.length+2}`,[...args,limit,(page-1)*limit]);let items:any[]=[];if(q.id&&rows.rows.length)items=(await db.query('SELECT i.input_index,i.receipt_status,i.error_code,i.stored_id,r.task_id,r.device_id FROM m04.ingestion_item i LEFT JOIN m04.measurement_record r ON r.id=i.stored_id AND r.factory_id=$2 WHERE i.batch_id=$1 ORDER BY input_index',[q.id,actor.factory])).rows;return {items:rows.rows,total:count.rows[0].n,page,limit,receipts:items};});
}

