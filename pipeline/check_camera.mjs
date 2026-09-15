import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {build} from 'vite';
import {NullEngine,Scene,UniversalCamera,Vector3} from '@babylonjs/core';
await build({configFile:false,logLevel:'silent',publicDir:false,build:{ssr:'src/runtime/experience.ts',outDir:'work/test-bundle',emptyOutDir:false,rollupOptions:{output:{entryFileNames:'camera-test.mjs'}}}});
const {Experience}=await import('../work/test-bundle/camera-test.mjs');
const {poseAt}=await import('../work/test-bundle/track-test.mjs');
const engine=new NullEngine();const scene=new Scene(engine);scene.useRightHandedSystem=true;
const results=[];
const angle=(a,b)=>Math.acos(Math.max(-1,Math.min(1,Vector3.Dot(a,b))));
for(const fps of [30,60,120]){
 const camera=new UniversalCamera('test',Vector3.Zero(),scene);
 const runtime=new Experience({}, {quality:'balanced',reduced:false,onReady(){},onStatus(){},onChange(){},onFail(e){throw e;}});
 runtime.camera=camera;runtime.applyPose(poseAt(0));
 let oldRaw=poseAt(0).target.subtract(poseAt(0).position).normalize(),oldView=oldRaw,maxRaw=0,maxView=0;
 for(let i=1;i<=fps*10;i++){
  const pose=poseAt(i/(fps*10)),raw=pose.target.subtract(pose.position).normalize();
  runtime.applyPose(pose,1/fps);camera.computeWorldMatrix();
  const view=camera.getForwardRay().direction;
  assert.ok(Vector3.Distance(camera.position,pose.position)<1e-8,'Smoothing must not move the camera off its collision-checked rail');
  maxRaw=Math.max(maxRaw,angle(oldRaw,raw)*fps);maxView=Math.max(maxView,angle(oldView,view)*fps);oldRaw=raw;oldView=view;
 }
 for(let i=0;i<fps*2;i++)runtime.applyPose(poseAt(1),1/fps);
 camera.computeWorldMatrix();assert.ok(angle(camera.getForwardRay().direction,oldRaw)<.001,'Final view must converge');
 assert.equal(runtime.viewSettling,false,'Render loop can sleep after the view settles');
 assert.ok(maxView<maxRaw,'Camera smoothing reduces peak turn rate');
 results.push({fps,maxRawTurnRadiansPerSecond:maxRaw,maxSmoothedTurnRadiansPerSecond:maxView});camera.dispose();
}
engine.dispose();
await fs.writeFile('pipeline/camera-response.json',JSON.stringify({checkedAt:new Date().toISOString(),routePositionsUnchanged:true,results},null,2));console.log(results);
