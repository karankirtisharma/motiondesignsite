import fs from 'node:fs/promises';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {Matrix,Vector3} from '@babylonjs/core/Maths/math.vector.js';
const recipes=JSON.parse(await fs.readFile('public/materials/source-materials.json','utf8')).materials;
const matrices=JSON.parse(await fs.readFile('work/source-object-matrices.json','utf8'));
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);await fs.mkdir('work/geometry-source',{recursive:true});
const blender=v=>new Vector3(v.x,-v.z,v.y);
for(const zone of ['exterior','reception','spine','founder','meeting','lounge','lab','motion-floor','render-hall']){
 const doc=await io.read(`work/geometry/${zone}.glb`);let count=0;
 for(const node of doc.getRoot().listNodes()){
  const mesh=node.getMesh();if(!mesh)continue;
  const source=node.getExtras().source_name||node.getName().replace(/^WEB_/,'');
  const world=Matrix.FromArray(node.getWorldMatrix());
  for(const prim of mesh.listPrimitives()){
   const name=prim.getMaterial()?.getName().replace(/^WEB__.*?__(?:baked__)?/,'');const r=recipes[name];
   if(!r?.albedo||r.projection!=='BOX')continue;
   const mapping=r.mapping;const rows=matrices[mapping.anchor||source];
   if(mapping.anchor&&!rows)throw Error('Missing source anchor '+mapping.anchor);
   const inverse=rows?Matrix.FromArray(rows.flat()).transpose().invert():Matrix.Identity();
   const pos=prim.getAttribute('POSITION'),normal=prim.getAttribute('NORMAL');
   const uv=new Float32Array(pos.getCount()*2),p=[],n=[];
   for(let i=0;i<pos.getCount();i++){
    pos.getElement(i,p);normal.getElement(i,n);
    let v=Vector3.TransformCoordinates(blender(Vector3.TransformCoordinates(Vector3.FromArray(p),world)),inverse);
    const direction=Vector3.TransformNormal(blender(Vector3.TransformNormal(Vector3.FromArray(n),world)),inverse);
    for(const step of mapping.steps){if(step.type==='scale')v.scaleInPlace(step.value);else if(step.type==='mapping'){
      v.multiplyInPlace(Vector3.FromArray(step.scale));v=Vector3.TransformCoordinates(v,Matrix.RotationYawPitchRoll(step.rotation[1],step.rotation[0],step.rotation[2]));v.addInPlace(Vector3.FromArray(step.location));
    }}
    const a=[Math.abs(direction.x),Math.abs(direction.y),Math.abs(direction.z)],axis=a.indexOf(Math.max(...a));
    uv[i*2]=axis===0?v.y:v.x;uv[i*2+1]=1-(axis===2?v.y:v.z);
   }
   prim.setAttribute('TEXCOORD_0',doc.createAccessor().setType('VEC2').setArray(uv).setBuffer(pos.getBuffer()));count++;
  }
 }
 await io.write(`work/geometry-source/${zone}.glb`,doc);console.log(zone,count,'source projections');
}
