import type {PoolClient} from 'pg';
import {requireValue} from '../../infrastructure/errors';
const aggregate=`count(*)::int total,
 count(*) FILTER(WHERE usable)::int valid,
 count(*) FILTER(WHERE usable AND quality_result='PASS')::int passed,
 count(*) FILTER(WHERE usable AND quality_result='FAIL')::int failed,
 count(*) FILTER(WHERE NOT usable)::int invalid,
 count(*) FILTER(WHERE usable AND quality_result NOT IN ('PASS','FAIL'))::int unevaluated,
 count(*) FILTER(WHERE receipt_status='QUARANTINED')::int quarantined,
 min(value) FILTER(WHERE usable)::float8 minimum,max(value) FILTER(WHERE usable)::float8 maximum,
 avg(value) FILTER(WHERE usable)::float8 average,sum(value) FILTER(WHERE usable)::float8 sum,
 min(sample_time) first_at,max(sample_time) last_at,
 min(sample_time) FILTER(WHERE usable AND quality_result='FAIL') first_failed_at,
 max(sample_time) FILTER(WHERE usable AND quality_result='FAIL') last_failed_at`;
/** Only persisted projections are aggregated; external raw-series hydration is unnecessary. */
export async function reportMeasurements(db:PoolClient,factory:string,taskIds:string[],scope:{from:string|null;to:string|null;bucket:string}){
 const args=[factory,taskIds,scope.from,scope.to,scope.bucket];
 const base=`WITH base AS MATERIALIZED(SELECT r.id,r.task_id,r.sample_time,r.ingest_order,r.receipt_status,r.data_environment,
 v.metric_code,v.unit,coalesce(v.method_id,'') method_id,v.data_status,e.quality_result,e.reason_code,e.rule_snapshot,
 p.numeric_value value,(v.data_status='VALID' AND p.numeric_value IS NOT NULL AND r.receipt_status='STORED') usable
 FROM m04.measurement_record r JOIN m04.measurement_value v ON v.record_id=r.id
 JOIN m04.measurement_evaluation e ON e.record_id=r.id AND e.version=1
 LEFT JOIN m04.measurement_projection p ON p.record_id=r.id
 WHERE r.factory_id=$1 AND r.task_id=ANY($2::text[]) AND ($3::timestamptz IS NULL OR r.sample_time >= $3) AND ($4::timestamptz IS NULL OR r.sample_time < $4))`;
 const taskStats=(await db.query(base+` SELECT task_id,metric_code,unit,method_id,${aggregate} FROM base GROUP BY task_id,metric_code,unit,method_id ORDER BY task_id`,args.slice(0,4))).rows;
 const metrics=(await db.query(base+` SELECT metric_code,unit,method_id,${aggregate} FROM base GROUP BY metric_code,unit,method_id ORDER BY metric_code,unit,method_id`,args.slice(0,4))).rows;
 const order=scope.from===null;
 const buckets=order?`, bounds AS (SELECT min(sample_time) origin,greatest(1,ceil(extract(epoch from(max(sample_time)-min(sample_time)))/60))::double precision seconds FROM base)`:'';
 const bucket=order?`date_bin(make_interval(secs=>bounds.seconds),sample_time,bounds.origin) AT TIME ZONE 'Asia/Shanghai'`:`date_trunc($5,sample_time AT TIME ZONE 'Asia/Shanghai')`;
 const timeline=(await db.query(base+buckets+` SELECT metric_code,unit,method_id,to_char(${bucket},'YYYY-MM-DD HH24:MI:SS') bucket,${aggregate} FROM base ${order?'CROSS JOIN bounds':''} GROUP BY metric_code,unit,method_id,bucket ORDER BY bucket,metric_code LIMIT 10001`,order?args.slice(0,4):args)).rows;
 requireValue(timeline.length<=10000,'REPORT_SCOPE_TOO_LARGE','时间分组超过10000项，请缩小范围',422);
 const exceptions=(await db.query(base+`, ranked AS (SELECT *,row_number() OVER(PARTITION BY task_id,quality_result ORDER BY sample_time DESC,id) sequence FROM base WHERE NOT usable OR quality_result<>'PASS') SELECT id,task_id,to_char(sample_time AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:MI:SS.US') sample_time,metric_code,unit,method_id,value::float8,quality_result,reason_code,data_status,receipt_status,rule_snapshot FROM ranked ORDER BY sequence,(quality_result='FAIL') DESC,sample_time DESC,id LIMIT 24`,args.slice(0,4))).rows;
 const trace=(await db.query(base+` SELECT max(ingest_order)::text high_watermark,max(sample_time) last_sample FROM base`,args.slice(0,4))).rows[0];
 // Preserve real endpoints and extrema per task/time bucket, not an averaged global curve.
 // Total extrema selections are bounded by an adaptive shared point budget.
 const bins=Math.max(1,Math.min(160,Math.floor(20000/Math.max(taskStats.length,1))));
 const sampled=(await db.query(base+`, timed AS (
 SELECT *,min(sample_time) OVER(PARTITION BY task_id) origin,
 max(sample_time) OVER(PARTITION BY task_id) finish FROM base), bucketed AS (
 SELECT *,floor(extract(epoch from(sample_time-origin))/greatest(.001,extract(epoch from(finish-origin)))*$5)::int slot FROM timed),
 ranked AS (SELECT *,row_number() OVER(PARTITION BY task_id,slot ORDER BY sample_time,id) first_rank,
 row_number() OVER(PARTITION BY task_id,slot ORDER BY sample_time DESC,id DESC) last_rank,
 row_number() OVER(PARTITION BY task_id,slot ORDER BY CASE WHEN usable THEN value END ASC NULLS LAST,sample_time,id) low_rank,
 row_number() OVER(PARTITION BY task_id,slot ORDER BY CASE WHEN usable THEN value END DESC NULLS LAST,sample_time,id) high_rank FROM bucketed)
 SELECT id,task_id,metric_code,unit,method_id,to_char(sample_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') at,
 CASE WHEN usable THEN value::float8 END value,quality_result result FROM ranked
 WHERE first_rank=1 OR last_rank=1 OR low_rank=1 OR high_rank=1 ORDER BY task_id,sample_time,id`,[...args.slice(0,4),bins])).rows;
 const series=new Map<string,any>();for(const point of sampled){let group=series.get(point.task_id);if(!group){group={task_id:point.task_id,metric_code:point.metric_code,unit:point.unit,method_id:point.method_id,points:[]};series.set(point.task_id,group);}group.points.push({id:point.id,at:point.at,value:point.value,result:point.result});}
 return {taskStats,metrics,timeline,exceptions,trace,taskSeries:[...series.values()],series_method:'TIME_BUCKET_FIRST_MIN_MAX_LAST_V1'};
}
