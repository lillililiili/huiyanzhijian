import type {ImportKind} from './importRegistry';
import {ImportFieldError,markImportRow,normalizeHeader,rowError,templateHeader,requirement,validateImportRow} from './importValidation';
const sourceLines=new WeakMap<string[],number>();
// Track physical CSV lines, including blanks and quoted multiline fields.
export function parseCsv(text:string):string[][] {
 if(new TextEncoder().encode(text).length>2*1024*1024)throw Error('文件不能超过2 MiB');
 text=text.replace(/^\uFEFF/,'');
 const rows:string[][]=[];let row:string[]=[],cell='',quoted=false,closed=false,line=1,start=1;
 const fail=(message:string):never=>{throw Error(rowError(start,rows[0]?.[row.length]||`第${row.length+1}列`,message));};
 const push=()=>{row.push(cell);if(row.some(v=>v.trim())){sourceLines.set(row,start);rows.push(row);}row=[];cell='';closed=false;};
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else{cell+=c;if(c==='\n'||c==='\r'&&text[i+1]!=='\n')line++;}continue;}
  if(c==='"'){if(cell||closed)fail('引号格式错误');quoted=true;continue;}
  if(c===','){row.push(cell);cell='';closed=false;}
  else if(c==='\n'||c==='\r'){push();if(c==='\r'&&text[i+1]==='\n')i++;line++;start=line;}
  else{if(closed)fail('引号结束后只能是分隔符');cell+=c;}
 }
 if(quoted)fail('引号未闭合');push();
 if(rows.length<2)throw Error('文件没有数据行；请填写模板后上传');
 // The template may contain one instruction row, and up to two example rows.
 if(rows.length>204)throw Error('单次最多200条数据，请拆分文件');
 return rows;
}
export const instructionRow=(kind:ImportKind)=>['填写说明（不导入）',...kind.fields.map(f=>`${requirement(kind,f.label)}；${f.hint}`)];
export function importTemplate(kind:ImportKind):string {
 return csvText([
  ['行类型',...kind.fields.map(f=>f.label)].map(h=>templateHeader(kind,h)),
  instructionRow(kind),
  ['示例（导入前删除）',...kind.fields.map(f=>f.example)]
 ]);
}
export function readImportCsv(text:string,headers:string[],kind?:ImportKind):Record<string,string>[] {
 const [head,...rows]=parseCsv(text),h=head.map(normalizeHeader),expectedGuide=kind?Object.fromEntries(headers.map((k,i)=>[k,instructionRow(kind)[i]])):null;
 for(const label of h)if(h.filter(x=>x===label).length>1)throw Error(rowError(sourceLines.get(head)||1,label||'空表头','存在重复表头'));
 for(const label of headers)if(!h.includes(label))throw Error(rowError(sourceLines.get(head)||1,label,'缺少表头，请重新下载本类别模板'));
 for(const label of h)if(!headers.includes(label))throw Error(rowError(sourceLines.get(head)||1,label||'空表头','表头与本类模板不一致'));
 const seen=new Map<string,number>(),values:Record<string,string>[]=[],errors:string[]=[];let count=0;
 for(const [i,r] of rows.entries()){
  const n=sourceLines.get(r)??i+2;
  try{
   if(r.length!==h.length)throw new ImportFieldError(r.length<h.length?h[r.length]:`第${h.length+1}列`,'列数不正确；不要删列，含逗号的内容须用英文双引号包围');
   const value=Object.fromEntries(h.map((k,c)=>[k,r[c].trim()]));
   if(expectedGuide&&value['行类型']==='填写说明（不导入）'&&headers.every(k=>value[k]===expectedGuide[k]))continue;
   count++;
   if(value['行类型']!=='数据')throw new ImportFieldError('行类型','仍有示例或行类型错误：删除示例整行，正式行填写“数据”；填写说明行须保持原样');
   if(kind)validateImportRow(kind,value);
   const signature=JSON.stringify(headers.map(k=>value[k]));if(seen.has(signature))throw new ImportFieldError('整行',`与第${seen.get(signature)}行数据重复`);seen.set(signature,n);
   values.push(markImportRow(value,n));
  }catch(e){errors.push(rowError(n,e instanceof ImportFieldError?e.field:'整行',(e as Error).message));}
 }
 if(count>200)throw Error('单次最多200条数据，请拆分文件');
 if(errors.length)throw Error(errors.slice(0,20).join('\n')+(errors.length>20?`\n另有${errors.length-20}处错误，请修改后重新上传。`:''));
 if(!values.length)throw Error('文件没有数据行；请填写模板后上传');
 return values;
}
export function csvText(rows:unknown[][]):string {
 return '\uFEFF'+rows.map(row=>row.map(v=>{let s=String(v??'');if(/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}).join(',')).join('\r\n');
}
export function downloadText(name:string,text:string,type='text/csv;charset=utf-8'){
 const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
