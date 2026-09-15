import fs from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {validateBytes} from 'gltf-validator';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {MeshoptDecoder} from 'meshoptimizer';
import {build} from 'vite';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const manifest=JSON.parse(await fs.readFile('public/release.json','utf8'));
const materialRecipes=JSON.parse(await fs.readFile('public/materials/source-materials.json','utf8')).materials;
assert.equal(manifest.assets.length,9,'All room packages must be present');
await MeshoptDecoder.ready;
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
const results=[];
for(const asset of manifest.assets){
 const bytes=new Uint8Array(await fs.readFile('public'+asset.uri));assert.equal(bytes.length,asset.byteLength);assert.equal(hash(bytes),asset.sha256);
 const report=await validateBytes(bytes,{maxIssues:100});assert.equal(report.issues.numErrors,0,asset.id+' glTF validation');
 const doc=await io.readBinary(bytes);let baked=0;
 // These chairs have five source face-material groups. A slot-reset export
 // regression turns the whole chair chrome while still producing valid glTF.
 if(['meeting','lab','motion-floor'].includes(asset.id)){
   const used=new Set(doc.getRoot().listMeshes().flatMap(m=>m.listPrimitives().map(p=>p.getMaterial()?.getName().replace(/^WEB__.*?__(?:baked__)?/,''))));
   const required=['V05_CHROME','V03_RUBBER','V05_CHAIR_LEATHER',...(asset.id==='meeting'?['V03_BLACK','V05_BLACK_WELT']:['V05_FRAME','V05_MESH_FIBER'])];
   for(const name of required)assert.ok(used.has(name),`${asset.id}: missing chair face material ${name}`);
   assert.ok(Math.max(...materialRecipes.V05_CHAIR_LEATHER.color.slice(0,3))<.03,'Chair upholstery must retain source black');
 }
 for(const mesh of doc.getRoot().listMeshes())for(const primitive of mesh.listPrimitives())if(primitive.getMaterial()?.getName().includes('__baked')){assert.ok(primitive.getAttribute('TEXCOORD_1'),asset.id+' lighting UV is required');baked++;}
 const lighting=JSON.parse(await fs.readFile(`public/lighting/${asset.id}/diffuse.json`,'utf8'));
 for(const mip of lighting.levels){const packed=await fs.readFile('public'+mip.uri);const data=mip.encoding==='gzip'?gunzipSync(packed):packed;assert.ok(mip.width>0&&mip.height>0);assert.equal(data.length,mip.width*mip.height*8);assert.equal(hash(data),mip.sha256);}
 results.push({room:asset.id,bytes:bytes.length,triangles:asset.triangles,bakedPrimitives:baked,glTFErrors:report.issues.numErrors,warnings:report.issues.numWarnings});
}
await build({configFile:false,logLevel:'silent',publicDir:false,build:{ssr:'src/runtime/track.ts',outDir:'work/test-bundle',emptyOutDir:false,rollupOptions:{output:{entryFileNames:'track-test.mjs'}}}});
const {poseAt,chapters,duration}=await import('../work/test-bundle/track-test.mjs?'+Date.now());
assert.equal(chapters.length,10);
let maxStep=0,maxTurn=0,previous=poseAt(0);
for(let i=1;i<=100000;i++){
 const pose=poseAt(i/100000);for(const v of [...pose.position.asArray(),...pose.target.asArray(),pose.fov])assert.ok(Number.isFinite(v));
 const step=pose.position.subtract(previous.position).length();maxStep=Math.max(maxStep,step);
 const a=pose.target.subtract(pose.position).normalize(),b=previous.target.subtract(previous.position).normalize();const angle=Math.acos(Math.max(-1,Math.min(1,a.x*b.x+a.y*b.y+a.z*b.z)));maxTurn=Math.max(maxTurn,angle);previous=pose;
}
assert.ok(maxStep<.1,'Track must not jump between samples');assert.ok(maxTurn<.05,'Camera direction must be continuous');
const output={checkedAt:new Date().toISOString(),assets:results,route:{chapters:chapters.map(c=>c.title),durationSeconds:duration,samples:100001,maxStepMetres:maxStep,maxTurnRadians:maxTurn}};
await fs.writeFile('pipeline/validation-report.json',JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2));
