import {Vector3} from '@babylonjs/core';
import route from './route.json';
export const world=(v:number[])=>new Vector3(v[0],v[2],-v[1]);
export interface Pose {position:Vector3;target:Vector3;fov:number;exposure:number}
const clamp=(x:number,a=0,b=1)=>Math.max(a,Math.min(b,x));
// One moving rail. Repeated positions are orientation hints, not stationary shots.
const waypoints:typeof route=[];
for(const item of route){const last=waypoints.at(-1);if(last&&Vector3.Distance(world(last.position),world(item.position))<.001){waypoints[waypoints.length-1]={...item,chapter:last.chapter||item.chapter};}else waypoints.push({...item});}
const points=waypoints.map(p=>world(p.position));
interface Segment{a:Vector3;b:Vector3;c?:Vector3;start:number;length:number}
const segments:Segment[]=[];const marks:number[]=[];
let length=0;
const add=(a:Vector3,b:Vector3,c?:Vector3)=>{const n=c?(Vector3.Distance(a,c)+Vector3.Distance(c,b)):Vector3.Distance(a,b);if(n<.00001)return;segments.push({a,b,c,start:length,length:n});length+=n;};
let previous=points[0];marks.push(0);
for(let i=1;i<points.length-1;i++){
 const p=points[i],before=points[i-1],after=points[i+1];
 const radius=Math.min(waypoints[i].room==='exterior'?1.2:.14,Vector3.Distance(before,p)*.2,Vector3.Distance(p,after)*.2);
 const enter=p.add(before.subtract(p).normalize().scale(radius)),exit=p.add(after.subtract(p).normalize().scale(radius));
 add(previous,enter);const start=length;add(enter,exit,p);marks.push((start+length)/2);previous=exit;
}
add(previous,points.at(-1)!);marks.push(length);
export const pathLength=length;
export const duration=length/2.4;
const frames=waypoints.map((r,i)=>{const d=world(r.target).subtract(points[i]).normalize();return{...r,distance:marks[i],yaw:Math.atan2(d.x,d.z),pitch:Math.asin(d.y)}});
for(let i=1;i<frames.length;i++){while(frames[i].yaw-frames[i-1].yaw>Math.PI)frames[i].yaw-=Math.PI*2;while(frames[i].yaw-frames[i-1].yaw< -Math.PI)frames[i].yaw+=Math.PI*2;}
// Shape-preserving Hermite derivatives keep camera rotation continuous across waypoints.
function slopes(values:number[]){return values.map((v,i)=>{if(i===0)return(values[1]-v)/(marks[1]-marks[0]);if(i===values.length-1)return(v-values[i-1])/(marks[i]-marks[i-1]);const a=(v-values[i-1])/(marks[i]-marks[i-1]),b=(values[i+1]-v)/(marks[i+1]-marks[i]);return a*b<=0?0:2*a*b/(a+b);});}
const yawSlopes=slopes(frames.map(f=>f.yaw)),pitchSlopes=slopes(frames.map(f=>f.pitch)),lensSlopes=slopes(frames.map(f=>f.lens));
function interpolate(a:number,b:number,ma:number,mb:number,t:number,span:number){const t2=t*t,t3=t2*t;return(2*t3-3*t2+1)*a+(t3-2*t2+t)*ma*span+(-2*t3+3*t2)*b+(t3-t2)*mb*span;}
export const chapters=frames.flatMap((f,i)=>f.chapter?[{id:f.room,title:f.chapter,phase:f.distance/length,index:i}]:[]);
export const receptionPhase=chapters.find(c=>c.id==='reception')!.phase;
export function roomAt(phase:number){const p=poseAt(phase).position,x=p.x,y=-p.z;if(y<0)return 'exterior';if(p.y>4.5)return 'upper';if(x>13)return 'founder';if(x< -13)return 'lab';if(y>9)return x<2?'motion-floor':'render-hall';if(y>=7)return 'spine';return x< -5?'lounge':x>5?'meeting':'reception';}
export function chapterAt(phase:number){return [...chapters].reverse().find(c=>phase>=c.phase-.0001)||chapters[0];}
export function poseAt(phase:number):Pose{
 const d=clamp(phase)*length;let si=0;while(si<segments.length-1&&segments[si].start+segments[si].length<d)si++;
 const segment=segments[si],t=clamp((d-segment.start)/segment.length);
 const position=segment.c?Vector3.Lerp(Vector3.Lerp(segment.a,segment.c,t),Vector3.Lerp(segment.c,segment.b,t),t):Vector3.Lerp(segment.a,segment.b,t);
 let i=0;while(i<frames.length-2&&marks[i+1]<d)i++;
 const a=frames[i],b=frames[i+1],span=marks[i+1]-marks[i],u=clamp((d-marks[i])/span);
 const yaw=interpolate(a.yaw,b.yaw,yawSlopes[i],yawSlopes[i+1],u,span),pitch=interpolate(a.pitch,b.pitch,pitchSlopes[i],pitchSlopes[i+1],u,span);
 const lens=interpolate(a.lens,b.lens,lensSlopes[i],lensSlopes[i+1],u,span);
 return{position,target:position.add(new Vector3(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)).scale(5)),fov:2*Math.atan(18/lens),exposure:phase<receptionPhase?.05-.3*clamp(phase/receptionPhase):-.25};
}
export const anchors=[
 {id:'room',position:[3.5,2.5,1.6],target:[-.2,5.4,1.8],text:'Limestone, bronze and six studies in motion.'},
 {id:'exhibits',position:[-2.5,2.7,1.6],target:[-2.1,6.5,1.85],text:'Ideas, material studies, animation, rigging, camera and light, and generative form.'},
 {id:'identity',position:[2.2,2.6,1.6],target:[.8,6.3,2.2],text:'A solid limestone MD mark, illuminated by a concealed warm halo.'},
 {id:'counter',position:[-.95,3.85,1.6],target:[-1.1,5.25,1.3],text:'Blackened bronze, scanned stone and the finished graphite studio laptop.'}
];
export function anchorPose(i:number):Pose{const a=anchors[i];return{position:world(a.position),target:world(a.target),fov:2*Math.atan(18/28),exposure:-.25};}
