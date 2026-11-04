// Server-to-server only. Tokens never reach barcode images or browser responses.
export async function edgeRequest(path:string,payload?:unknown){
 const base=process.env.OVALITY_EDGE_URL,token=process.env.OVALITY_EDGE_INBOUND_TOKEN;
 if(!base||!token)throw Error('不圆度边缘接入未配置');
 const r=await fetch(base.replace(/\/$/,'')+'/edge/v1'+path,{method:payload===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:payload===undefined?undefined:JSON.stringify(payload),signal:AbortSignal.timeout(12000),redirect:'error'});
 if(!r.ok){let message='边缘端请求失败（'+r.status+'）';try{const b=await r.json() as any;if(typeof b.error==='string')message=b.error}catch{}throw Error(message)}
 return r.json() as Promise<any>;
}
