import fs from 'node:fs/promises';
import {init,exportNavMesh,NavMeshQuery} from 'recast-navigation';
import {generateSoloNavMesh} from 'recast-navigation/generators';
await init();
// Conservative reception apron. Counter starts at Blender Y=4.648;
// all anchors stay in the clear floor in front of it.
const positions=[-4.9,.025,-2,4.95,.025,-2,4.95,.025,-4.38,-4.9,.025,-4.38];
const {success,navMesh}=generateSoloNavMesh(positions,[0,1,2,0,2,3],{cs:.05,ch:.025,walkableSlopeAngle:40,walkableHeight:74,walkableClimb:2,walkableRadius:5,minRegionArea:2,mergeRegionArea:8,maxSimplificationError:.5,detailSampleDist:1,detailSampleMaxError:.1});
if(!success||!navMesh)throw Error('Navigation generation failed');
const q=new NavMeshQuery(navMesh);const anchors=[[3.5,2.5],[-2.5,2.7],[2.2,2.6],[-.95,3.85],[4.65,2.5]];const checks=[];
for(const a of anchors)for(const b of anchors){const result=q.computePath({x:a[0],y:.025,z:-a[1]},{x:b[0],y:.025,z:-b[1]});if(!result.success)throw Error('Anchor unreachable');checks.push({from:a,to:b,points:result.path})}
await fs.mkdir('public/navigation',{recursive:true});await fs.writeFile('public/navigation/reception.navmesh',exportNavMesh(navMesh));
await fs.writeFile('public/navigation/manifest.json',JSON.stringify({source:'Current reception clear apron, conservative bounds in front of the counter',radius:.25,height:1.85,cellSize:.05,clearance:'Source-geometry sweep report is separate',checks},null,2));
console.log('Generated Recast navmesh; 25 anchor connections passed.');
