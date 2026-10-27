import {randomBytes} from 'node:crypto';
import {mkdirSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),folder=resolve(root,'runtime/b1');mkdirSync(folder,{recursive:true});
const secret=()=>randomBytes(24).toString('base64url');const accessPath=resolve(folder,'access.json');
if(!existsSync(accessPath)){const fixed=JSON.parse(readFileSync(resolve(root,'apps/platform/config/initial-catalog.json'),'utf8'));writeFileSync(accessPath,JSON.stringify({users:Object.fromEntries(fixed.users.map(u=>[u.username,secret()])),device_token:secret()},null,2),{mode:0o600});}
const access=JSON.parse(readFileSync(accessPath,'utf8'));
if(!existsSync(resolve(folder,'compose.env'))){const migration=secret(),runtime=secret(),cursor=secret();writeFileSync(resolve(folder,'compose.env'),`B1_MIGRATION_PASSWORD=${migration}\nB1_RUNTIME_PASSWORD=${runtime}\nB1_CURSOR_SECRET=${cursor}\nB1_DEVICE_TOKEN=${access.device_token}\n`,{mode:0o600});writeFileSync(resolve(folder,'local.env'),`DATABASE_URL=postgres://hy_runtime:${runtime}@127.0.0.1:4193/huiyan_b1\nMIGRATION_DATABASE_URL=postgres://hy_migrator:${migration}@127.0.0.1:4193/huiyan_b1\nCURSOR_SECRET=${cursor}\nPORT=4192\n`,{mode:0o600});}
console.log('B1 local configuration ready. Credentials are in runtime/b1/access.json; values were not printed. Existing files were preserved.');
