import {Color3,PBRMaterial,Scene,Texture} from '@babylonjs/core';
interface Recipe {color:number[];metallic:number;roughness:number;ior:number;coat:number;coatRoughness:number;procedural:boolean;albedo?:string;normal?:string;mapping?:{steps:{type:string;value?:number;scale?:number[]}[]};roughnessMap?:string;emissionMap?:string;emission:number[];emissionStrength:number;temperature?:number}
export class DetailMaterials {
 private cache=new Map<string,Texture>();
 constructor(private scene:Scene,private recipes:Record<string,Recipe>){}
 private texture(uri:string,gamma:boolean){
  const key=uri+':'+gamma;
  if(!this.cache.has(key)){const t=new Texture(uri,this.scene,false,false,Texture.TRILINEAR_SAMPLINGMODE);t.gammaSpace=gamma;t.coordinatesIndex=0;t.anisotropicFilteringLevel=8;this.cache.set(key,t);}
  return this.cache.get(key)!;
 }
 apply(mat:PBRMaterial){
  const name=mat.name.replace(/^WEB__.*?__(?:baked__)?/,'');const r=this.recipes[name];if(!r)return false;
  if(r.procedural&&!r.albedo)throw Error("Uncompiled procedural material: "+name);
  mat.albedoTexture=r.albedo?this.texture(r.albedo,true):null;
  mat.albedoColor=Color3.FromArray(r.color);
  mat.metallic=r.metallic;mat.roughness=r.roughness;mat.indexOfRefraction=r.ior;
  mat.clearCoat.isEnabled=r.coat>0;mat.clearCoat.intensity=r.coat;mat.clearCoat.roughness=r.coatRoughness;
  mat.metallicTexture=r.roughnessMap?this.texture(r.roughnessMap,false):null;
  mat.useMetallnessFromMetallicTextureBlue=false;mat.useRoughnessFromMetallicTextureGreen=true;mat.useRoughnessFromMetallicTextureAlpha=false;
  if(mat.metallicTexture)mat.roughness=1;
  mat.bumpTexture=r.normal?this.texture(r.normal,false):null;
  if(mat.bumpTexture&&r.mapping?.steps.length){const scale=r.mapping.steps.reduce((s,v)=>s*(v.type==='scale'?v.value??1:v.scale?Math.min(...v.scale):1),1);mat.bumpTexture.level=Math.min(1,scale*.2);}
  mat.invertNormalMapX=false;mat.invertNormalMapY=true;
  mat.emissiveTexture=r.emissionMap?this.texture(r.emissionMap,true):null;
  mat.emissiveColor=Color3.FromArray(r.emission);mat.emissiveIntensity=r.emissionStrength;
  if(r.temperature){const t=r.temperature/100,clamp=(v:number)=>Math.max(0,Math.min(255,v))/255;
   mat.emissiveColor=new Color3(clamp(t<=66?255:329.698727446*Math.pow(t-60,-.1332047592)),clamp(t<=66?99.4708025861*Math.log(t)-161.1195681661:288.1221695283*Math.pow(t-60,-.0755148492)),clamp(t>=66?255:t<=19?0:138.5177312231*Math.log(t-10)-305.0447927307)).toLinearSpace();
  }
  return true;
 }
 static async create(scene:Scene){const r=await fetch('/materials/source-materials.json');if(!r.ok)throw Error('Source materials unavailable');return new DetailMaterials(scene,(await r.json()).materials);}
}
