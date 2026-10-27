export class ApiError extends Error {
 constructor(public status:number,public code:string,message:string,public fields:unknown[]=[],public outcome:'NONE'|'UNKNOWN'='NONE'){super(message);}
}
export function requireValue(ok:unknown,code='REQUEST_INVALID',message='请求字段不符合要求',status=400):asserts ok{if(!ok)throw new ApiError(status,code,message);}
export const idPattern=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export function object(body:unknown,required:string[],optional:string[]=[]):asserts body is Record<string,any>{
 requireValue(body && typeof body==='object' && !Array.isArray(body));
 const b=body as Record<string,unknown>;requireValue(required.every(k=>Object.hasOwn(b,k))&&Object.keys(b).every(k=>[...required,...optional].includes(k)));
}
export function textField(value:unknown,max=128):asserts value is string{requireValue(typeof value==='string'&&value.trim().length>0&&value.length<=max);}
export function idField(value:unknown):asserts value is string{requireValue(typeof value==='string'&&idPattern.test(value));}
