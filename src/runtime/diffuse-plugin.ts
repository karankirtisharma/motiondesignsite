import {MaterialPluginBase,PBRMaterial,RawTexture,Constants,Texture,ShaderLanguage,UniformBuffer,Scene,type AbstractMesh} from '@babylonjs/core';
/** Source baked direct/indirect diffuse, with realtime specular added by the PBR shader.
 * Metal diffuse weighting follows the active Babylon shading model.
 */
export class SourceDiffusePlugin extends MaterialPluginBase {
  constructor(material:PBRMaterial,private atlas:Texture,private normal?:Texture,private directGain=0){super(material,'SourceDiffuse',200,{},true,true);material.lightmapTexture=null;}
  isCompatible(){return true}
  getAttributes(attributes:string[]){if(!attributes.includes('uv2'))attributes.push('uv2')}
  getSamplers(samplers:string[]){samplers.push('sourceDiffuseSampler');if(this.normal)samplers.push('sourceNormalSampler')}
  getActiveTextures(textures:Texture[]){textures.push(this.atlas);if(this.normal)textures.push(this.normal)}
  isReadyForSubMesh(){return this.atlas.isReady()&&(!this.normal||this.normal.isReady())}
  bindForSubMesh(buffer:UniformBuffer){buffer.setTexture('sourceDiffuseSampler',this.atlas);if(this.normal)buffer.setTexture('sourceNormalSampler',this.normal)}
  getCustomCode(type:string,language?:ShaderLanguage):Record<string,string>|null{const wgsl=language===ShaderLanguage.WGSL;
    if(type==='vertex')return {CUSTOM_VERTEX_DEFINITIONS:wgsl?'#ifndef UV2\nattribute uv2: vec2f;\n#endif\nvarying vSourceDiffuseUV: vec2f;':'#ifndef UV2\nattribute vec2 uv2;\n#endif\nvarying vec2 vSourceDiffuseUV;',CUSTOM_VERTEX_MAIN_END:wgsl?'vertexOutputs.vSourceDiffuseUV=vertexInputs.uv2;':'vSourceDiffuseUV=uv2;'};
    if(type==='fragment')return {CUSTOM_FRAGMENT_DEFINITIONS:(wgsl?'varying vSourceDiffuseUV: vec2f; var sourceDiffuseSamplerSampler: sampler; var sourceDiffuseSampler: texture_2d<f32>;':'varying vec2 vSourceDiffuseUV; uniform sampler2D sourceDiffuseSampler;')+(this.normal?(wgsl?'var sourceNormalSamplerSampler: sampler; var sourceNormalSampler: texture_2d<f32>;':'uniform sampler2D sourceNormalSampler;'):''),CUSTOM_FRAGMENT_BEFORE_LIGHTS:this.normal?(wgsl?'var sourceN=textureSample(sourceNormalSampler,sourceNormalSamplerSampler,fragmentInputs.vSourceDiffuseUV).rgb*2.0-vec3f(1.0);normalW=normalize(vec3f(sourceN.x,sourceN.z,-sourceN.y));':'vec3 sourceN=texture2D(sourceNormalSampler,vSourceDiffuseUV).rgb*2.0-vec3(1.0);normalW=normalize(vec3(sourceN.x,sourceN.z,-sourceN.y));'):'',CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION:`
      finalDiffuse=finalDiffuse*${(this.directGain??0).toFixed(2)}+${wgsl?'textureSample(sourceDiffuseSampler,sourceDiffuseSamplerSampler,vec2f(fragmentInputs.vSourceDiffuseUV.x,1.0-fragmentInputs.vSourceDiffuseUV.y))':'texture2D(sourceDiffuseSampler,vec2(vSourceDiffuseUV.x,1.0-vSourceDiffuseUV.y))'}.rgb*surfaceAlbedo.rgb;
      #ifdef METALLICWORKFLOW
      #ifndef LEGACY_SPECULAR_ENERGY_CONSERVATION
      finalDiffuse*=1.0-reflectivityOut.metallic;
      #endif
      #endif
      finalAmbient*=0.0;
      #ifdef REFLECTION
      finalIrradiance*=0.0;
      #endif
    `};
    return null;
  }
}
export async function loadDiffuse(scene:Scene,path='/lighting/diffuse.json'){
  const manifest=await fetch(path).then(r=>{if(!r.ok)throw Error('Source lighting unavailable');return r.json()});
  const levels=manifest.levels as {uri:string;width:number;height:number}[];
  async function data(uri:string){try{const r=await fetch(uri);if(!r.ok)throw Error('HTTP '+r.status);const buffer=uri.endsWith('.pack')?await new Response(r.body!.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer():await r.arrayBuffer();return new Uint16Array(buffer)}catch(e){throw new Error(uri+': '+e)}}
  const mipData=await Promise.all(levels.map(level=>data(level.uri)));
  const first=levels[0];if(first.width<1||first.height<1)throw Error('Invalid source lighting dimensions');const texture=new RawTexture(mipData[0],first.width,first.height,Constants.TEXTUREFORMAT_RGBA,scene,true,false,Texture.TRILINEAR_SAMPLINGMODE,Constants.TEXTURETYPE_HALF_FLOAT);
  texture.gammaSpace=false;texture.wrapU=texture.wrapV=Texture.CLAMP_ADDRESSMODE;texture.coordinatesIndex=1;
  for(let i=1;i<levels.length;i++)texture.updateMipLevel(mipData[i],i);
  return texture;
}
