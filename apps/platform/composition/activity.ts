// Display observation only; never changes task lifecycle or emits production alarms.
export function taskActivity(task:any,connection:any,latest:any,at=new Date().toISOString()){
 const now=Date.parse(at),windowMs=30000,age=(v:string)=>Number.isFinite(Date.parse(v))?now-Date.parse(v):null;
 const receivedAge=latest?age(latest.received_at):null,sampleAge=latest?age(latest.sample_time):null;
 let sampling='NO_DATA';
 if(latest){
  if(receivedAge===null||sampleAge===null||receivedAge<0||sampleAge < -windowMs)sampling='CLOCK_UNVERIFIED';
  else if(receivedAge>windowMs)sampling='NO_RECENT_DATA';
  else if(sampleAge>windowMs)sampling='DELAYED_DATA';
  else sampling='RECENT_DATA';
 }
 return {as_of:at,observation_seconds:30,task_state:task.state,
  communication:!connection?'UNKNOWN':connection.online?'ONLINE':'OFFLINE',
  last_heartbeat_at:connection?.last_heartbeat_at||null,sampling,
  latest:latest||null,received_age_seconds:receivedAge===null?null:Math.floor(receivedAge/1000),
  sample_age_seconds:sampleAge===null?null:Math.floor(sampleAge/1000)};
}
