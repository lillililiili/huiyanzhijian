import { Pool, type PoolClient } from 'pg';
export const pool = new Pool({connectionString:process.env.DATABASE_URL,max:10,connectionTimeoutMillis:5000,idleTimeoutMillis:30000,statement_timeout:10000,application_name:'huiyan-api-b1'});
pool.on('error',()=>console.error(JSON.stringify({event:'DATABASE_IDLE_CONNECTION_ERROR',time:new Date().toISOString()})));
export async function transaction<T>(fn:(db:PoolClient)=>Promise<T>):Promise<T>{
 const db=await pool.connect();
 try{await db.query('BEGIN');const result=await fn(db);await db.query('COMMIT');return result;}
 catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}
}
export async function lock(db:PoolClient,key:string){await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[key]);}
export function timestamp(column:string){if(!/^[a-z_]+$/.test(column))throw Error('Invalid SQL column');return `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;}
