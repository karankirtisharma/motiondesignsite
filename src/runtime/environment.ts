import {Color3,HDRCubeTexture,Mesh,MeshBuilder,MirrorTexture,PBRMaterial,Plane,Scene,ShaderMaterial,Texture,Vector3,type AbstractMesh} from '@babylonjs/core';

const vertex=`precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 worldViewProjection;
uniform vec3 cameraPosition;
varying vec3 vDir;
void main(){vec4 wp=world*vec4(position,1.0);vDir=wp.xyz-cameraPosition;gl_Position=worldViewProjection*vec4(position,1.0);}`;
const fragment=`precision highp float;
varying vec3 vDir;
uniform float uTime;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
void main(){
 vec3 d=normalize(vDir);float h=d.y;
 vec3 zenith=vec3(.010,.016,.040),horizon=vec3(.150,.095,.070),ground=vec3(.012,.012,.014);
 vec3 col=mix(horizon,zenith,pow(smoothstep(-.04,.55,h),.62));
 float az=max(dot(normalize(d.xz),normalize(vec2(-.35,-.94))),0.0);
 col+=vec3(.62,.30,.10)*pow(az,2.6)*exp(-max(h,0.0)*7.0);
 float a=atan(d.z,d.x);
 float ridge=.032+.020*sin(a*3.0+1.7)+.013*sin(a*7.3+.4)+.007*sin(a*13.1+2.2)+.0035*sin(a*29.0+.9)+.0018*sin(a*61.0);
 vec3 mountain=mix(ground*2.2,ground*.8,smoothstep(ridge-.10,ridge,h));
 mountain=mix(mountain,horizon*.75,.62);
 col=mix(col,mountain,1.0-smoothstep(ridge-.003,ridge+.003,h));
 col=mix(col,ground,1.0-smoothstep(-.06,-.005,h));
 vec2 cell=floor(d.xz/max(h,.05)*140.0);
 float star=step(.9965,hash(cell))*smoothstep(.18,.7,h);
 col+=vec3(.5,.55,.7)*star*.14*(.65+.35*sin(uTime*1.3+hash(cell+7.0)*30.0));
 gl_FragColor=vec4(col,1.0);
}`;
export class StudioEnvironment {
  dusk!:HDRCubeTexture;
  private sky:Mesh;private skyMaterial:ShaderMaterial;
  private water:Mesh;private reflection:MirrorTexture;private waves:Texture;private time=0;
  inside=0;
  constructor(private scene:Scene){
    this.skyMaterial=new ShaderMaterial('Dusk, afterglow and mountain horizon',scene,{vertexSource:vertex,fragmentSource:fragment},{attributes:['position'],uniforms:['world','worldViewProjection','cameraPosition','uTime']});
    this.skyMaterial.backFaceCulling=false;this.skyMaterial.disableDepthWrite=true;
    this.sky=MeshBuilder.CreateSphere('Dusk skybox',{diameter:3600,segments:32},scene);this.sky.material=this.skyMaterial;this.sky.isPickable=false;this.sky.alwaysSelectAsActiveMesh=true;this.sky.infiniteDistance=true;
    scene.fogMode=Scene.FOGMODE_EXP2;scene.fogColor=Color3.FromHexString('#0c0e14').toLinearSpace();scene.fogDensity=.008;
    this.reflection=new MirrorTexture('Dusk water reflection',{ratio:.5},scene,true);
    this.reflection.gammaSpace=false;this.reflection.mirrorPlane=new Plane(0,-1,0,-.5);this.reflection.level=.8;this.reflection.blurKernel=3;
    this.water=MeshBuilder.CreateGround('Reflecting water',{width:4000,height:4000},scene);this.water.position.y=-.5;this.water.isPickable=false;
    const mat=new PBRMaterial('Dark dusk water',scene);mat.albedoColor=new Color3(.006,.008,.012);mat.metallic=.15;mat.roughness=.18;mat.disableLighting=true;mat.reflectionTexture=this.reflection;mat.environmentIntensity=.85;
    this.waves=new Texture('/look/water-normal.png',scene);this.waves.uScale=this.waves.vScale=140;this.waves.level=.22;mat.bumpTexture=this.waves;this.water.material=mat;
  }
  async load(){
    const load=(path:string)=>new Promise<HDRCubeTexture>((resolve,reject)=>{const t=new HDRCubeTexture(path,this.scene,128,false,true,false,true,()=>resolve(t),(m)=>reject(Error(m)));});
    this.dusk=await load('/look/dusk.hdr');
  }
  setReflectionMeshes(meshes:AbstractMesh[]){this.reflection.renderList=[this.sky,...meshes.filter(m=>!m.name.includes('ENV_GROUND'))];}
  update(dt:number,camera:Vector3,reduced:boolean){
    this.inside=Math.min(1,Math.max(0,(4-camera.z)/6));this.inside=this.inside*this.inside*(3-2*this.inside);
    this.scene.fogDensity=.008*(1-this.inside);
    if(!reduced)this.time+=dt;
    this.sky.position.copyFrom(camera);this.skyMaterial.setVector3('cameraPosition',camera);this.skyMaterial.setFloat('uTime',this.time);
    this.waves.uOffset=this.time*.0015;this.waves.vOffset=this.time*.001;
    this.water.setEnabled(this.inside<.999);
  }
  setQuality(quality:string){this.reflection.refreshRate=quality==='mobile'?0:1;}
}
