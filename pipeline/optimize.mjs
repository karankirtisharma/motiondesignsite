import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {dedup, flatten, join, prune, weld, meshopt} from '@gltf-transform/functions';
import {MeshoptEncoder,MeshoptDecoder} from 'meshoptimizer';
await MeshoptEncoder.ready;await MeshoptDecoder.ready;
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.encoder':MeshoptEncoder,'meshopt.decoder':MeshoptDecoder});
await fs.mkdir('public/assets',{recursive:true});await fs.mkdir('public/decoders',{recursive:true});
// Babylon expects the classic global decoder build, hosted with the application.
await fs.copyFile('node_modules/meshoptimizer/meshopt_decoder.cjs','public/decoders/meshopt_decoder.js');
const requested=process.argv.slice(2);const assets=requested.length?JSON.parse(await fs.readFile('public/release.json','utf8')).assets.filter(a=>!requested.includes(a.id)):[];
for(const zone of (requested.length?requested:['exterior','reception','spine','founder','meeting','lounge','lab','motion-floor','render-hall'])){
 const doc=await io.read(`work/geometry-source/${zone}.glb`);
 // Blender includes an unused source scene. Remove it before serializing the derivative.
 for(const scene of doc.getRoot().listScenes())if(!scene.listChildren().length)scene.dispose();
 for(const node of doc.getRoot().listNodes())if(node.getName().includes('ENV_GROUND'))node.dispose();
 // The metal stem intersects both letters with exactly coplanar front/back
 // and end caps. Recess this internal joint 8 mm in depth and 6 mm at each
 // end before quantization; leave the stone M, curved D and gold inlay intact.
 if(zone==='render-hall'){
   const stem=doc.getRoot().listNodes().find(n=>n.getName()==='WEB_SCULPTURE_RENDER_MD_D_stem');
   if(!stem)throw Error('Missing render sculpture stem');
   const [x,y,z]=stem.getScale();stem.setScale([x,y*(2.1-.012)/2.1,z*(.26-.016)/.26]);
 }
 // The runtime supplies atlas or reference detail maps for these materials.
 for(const material of doc.getRoot().listMaterials())if(material.getName().includes('__baked')){
   material.setBaseColorTexture(null).setNormalTexture(null).setMetallicRoughnessTexture(null);
 }
 await doc.transform(dedup({keepUniqueNames:true}),flatten({cleanup:false}),join({keepNamed:false,cleanup:false}),weld(),prune({keepAttributes:true}),meshopt({encoder:MeshoptEncoder,level:'medium',quantizePosition:16,quantizeNormal:12,quantizeTexcoord:16,cleanup:false}),prune({keepAttributes:true}));
 const data=await io.writeBinary(doc);const hash=crypto.createHash('sha256').update(data).digest('hex');const file=`${zone}.${hash.slice(0,12)}.glb`;
 await fs.writeFile(`public/assets/${file}`,data);
 const root=doc.getRoot();let tris=0;for(const m of root.listMeshes())for(const p of m.listPrimitives())tris+=(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3;
 assets.push({id:zone,uri:`/assets/${file}`,sha256:hash,byteLength:data.length,triangles:tris,primitives:root.listMeshes().reduce((a,m)=>a+m.listPrimitives().length,0),materials:root.listMaterials().length});
 console.log(zone,assets.at(-1));
}
const source=JSON.parse(await fs.readFile('pipeline/source-lock.json','utf8'));
await fs.writeFile('public/release.json',JSON.stringify({schemaVersion:1,releaseId:`md-hq-${source.sha256.slice(0,10)}-review-1`,coordinates:'RH_Y_UP_METRES',source,assets,status:'local-review'},null,2));

