import fs from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
for(const room of JSON.parse(await fs.readFile('public/release.json','utf8')).assets){
 const path=`public/lighting/${room.id}/diffuse.json`,data=JSON.parse(await fs.readFile(path,'utf8'));
 for(const level of data.levels){
   if(level.uri.endsWith('.pack'))continue;
   const raw=await fs.readFile('public'+level.uri),packed=gzipSync(raw,{level:9});
   await fs.writeFile('public'+level.uri+'.pack',packed);level.uri+='.pack';level.encoding='gzip';level.transferBytes=packed.length;
 }
 await fs.writeFile(path,JSON.stringify(data,null,2));
}
