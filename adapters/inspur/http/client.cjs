'use strict';
const {validateConfig,validateQuery,insist}=require('./contract.cjs');
function numericText(s){
  const m=s.match(/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);insist(m,'VENDOR_JSON_INVALID');
  const exponent=Number(m[4]||0);insist(Math.abs(exponent)<=400,'VENDOR_NUMBER_UNSAFE');
  let digits=m[2]+(m[3]||''),point=m[2].length+exponent;
  let result=point<=0?'0.'+'0'.repeat(-point)+digits:point>=digits.length?digits+'0'.repeat(point-digits.length):digits.slice(0,point)+'.'+digits.slice(point);
  result=result.replace(/^0+(?=\d)/,'').replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');return m[1]&&result!=='0'?'-'+result:result;
}
function parseVendorJson(text){
  // Skip quoted strings. Refuse numeric lexemes which JSON.parse would silently round.
  for(const match of text.matchAll(/"(?:\\.|[^"\\])*"|(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/gi))if(match[1]){
    const number=Number(match[1]);insist(Number.isFinite(number)&&numericText(match[1])===numericText(String(number)),'VENDOR_NUMBER_UNSAFE');
  }
  try{return JSON.parse(text);}catch{throw Error('VENDOR_JSON_INVALID');}
}
// Bounded queries; source endpoints and headers are server-side configuration, never UI URLs.
async function queryPage(config,query){
  validateConfig(config);validateQuery(query,config.metric,config.timezoneOffsetMinutes);
  const base=new URL(config.baseUrl);insist(['http:','https:'].includes(base.protocol)&&!base.username&&!base.password,'VENDOR_URL_INVALID');
  const url=new URL(config.path,base);insist(url.origin===base.origin&&!url.hash,'VENDOR_URL_INVALID');
  if(config.method==='GET')url.search=new URLSearchParams(Object.entries(query).map(([k,v])=>[k,String(v)])).toString();
  const response=await fetch(url,{method:config.method,headers:{...config.headers,...(config.method==='POST'?{'Content-Type':'application/json'}:{})},body:config.method==='POST'?JSON.stringify(query):undefined,redirect:'error',signal:AbortSignal.timeout(config.timeoutMs||5000)});
  insist(response.ok,'VENDOR_HTTP_'+response.status);
  const reader=response.body.getReader();const chunks=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;insist(size<=4194304,'VENDOR_RESPONSE_TOO_LARGE');chunks.push(Buffer.from(value));}}finally{await reader.cancel();}
  const text=Buffer.concat(chunks).toString('utf8');const body=parseVendorJson(text);
  insist(body?.code===200&&body.success===true,'VENDOR_BUSINESS_FAILURE');
  insist(typeof body.msg==='string'&&typeof body.timestamp==='string'&&/^\d+$/.test(body.timestamp)&&Array.isArray(body.data)&&Number.isSafeInteger(body.count)&&body.count>=0,'VENDOR_ENVELOPE_INVALID');
  insist(body.data.length<=query.limit&&body.count>=body.data.length,'VENDOR_COUNT_INVALID');
  for(const row of body.data){insist(row?.lineId===query.lineId,'VENDOR_LINE_MISMATCH');if(config.metric==='WIRE_GAP')insist(row.dataType===query.dataType,'VENDOR_TYPE_MISMATCH');}
  return body;
}
async function queryAll(config,query,onPage){
  const seen=new Map();let total=null;
  for(let page=1;page<=10000;page++){
    const b=await queryPage(config,{...query,page});
    if(total===null)total=b.count;else insist(b.count===total,'VENDOR_RESULT_CHANGED_RETRY_WINDOW');
    insist(b.data.length>0||total===0,'VENDOR_PAGE_INCOMPLETE');
    for(const row of b.data){insist(typeof row.id==='string'&&!seen.has(row.id),'VENDOR_PAGE_DUPLICATE_ID');seen.set(row.id,true);}
    await onPage(b.data);
    insist(seen.size<=total,'VENDOR_COUNT_INVALID');if(seen.size===total)return seen.size;
  }
  throw Error('VENDOR_PAGE_LIMIT');
}
module.exports={queryPage,queryAll,parseVendorJson};
