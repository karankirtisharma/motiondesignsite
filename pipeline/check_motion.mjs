import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {build} from 'vite';
await build({configFile:false,logLevel:'silent',publicDir:false,build:{ssr:'src/runtime/scroll-motion.ts',outDir:'work/test-bundle',emptyOutDir:false,rollupOptions:{output:{entryFileNames:'scroll-test.mjs'}}}});
const {advanceScroll}=await import('../work/test-bundle/scroll-test.mjs');
const results=[];
for(const fps of [30,60,120])for(const target of [.005,.03,1]){
 let phase=0,velocity=0,time=0;
 while(Math.abs(target-phase)>1e-5&&time<15){const r=advanceScroll(phase,target,velocity,1/fps);assert.ok(r.value>=phase-1e-10&&r.value<=target);phase=r.value;velocity=r.velocity;time+=1/fps;}
 assert.ok(time<(target===1?8:1.3),'Scroll response should settle promptly');
 for(let i=0;i<fps*8;i++){const r=advanceScroll(phase,0,velocity,1/fps);assert.ok(r.value>=0&&r.value<=1);phase=r.value;velocity=r.velocity;}
 assert.ok(phase<1e-5,'Reverse scroll returns to the start');results.push({fps,target,settleSeconds:time});
}
const {poseAt}=await import('../work/test-bundle/track-test.mjs');
const points=[];for(let i=0;i<=14000;i++){const p=poseAt(i/14000).position;points.push({position:[p.x,-p.z,p.y]});}
await fs.writeFile('work/rail-samples.json',JSON.stringify(points));
await fs.writeFile('pipeline/motion-response.json',JSON.stringify({checkedAt:new Date().toISOString(),results},null,2));console.log(results);
