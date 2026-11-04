const http=require('node:http'),fs=require('node:fs'),p=require('node:path');
const root=p.resolve(__dirname,'../../apps/web/dist');
http.createServer((req,res)=>{if(req.url.startsWith('/api/')){const proxy=http.request({hostname:'127.0.0.1',port:44792,path:req.url,method:req.method,headers:req.headers},up=>{res.writeHead(up.statusCode,up.headers);up.pipe(res)});proxy.on('error',()=>{res.writeHead(502);res.end()});req.pipe(proxy);return;}
 const file=p.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));if(!file.startsWith(root+p.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[p.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
}).listen(44781,'127.0.0.4',()=>console.log('JDG01 preview ready'));

