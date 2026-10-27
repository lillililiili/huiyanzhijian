import {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2,connectionTimeoutMillis:3000,statement_timeout:3000,application_name:'huiyan-analysis-worker-b1'}),id=randomUUID();
async function beat(){try{await pool.query("INSERT INTO ops.process_heartbeat(process_name,instance_id,pid,capabilities) VALUES('analysis-worker',$1,$2,ARRAY['health-only']) ON CONFLICT(process_name) DO UPDATE SET instance_id=$1,pid=$2,last_seen_at=now(),capabilities=ARRAY['health-only']",[id,process.pid]);}catch{console.error(JSON.stringify({event:'WORKER_DATABASE_UNAVAILABLE',time:new Date().toISOString()}));}}
void beat();const timer=setInterval(()=>void beat(),5000);
for(const signal of ['SIGTERM','SIGINT'] as const)process.on(signal,()=>{clearInterval(timer);void pool.end().then(()=>process.exit(0));});
