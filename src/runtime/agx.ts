import {PostProcess,Texture,ShaderStore,ShaderLanguage,WebGPUEngine,Constants,type Scene,type Camera} from '@babylonjs/core';
const glsl=`precision highp float; varying vec2 vUV; uniform sampler2D textureSampler; uniform sampler2D agxLut; uniform float exposureEV;
vec3 sampleAgx(vec3 linearColor){vec3 q=clamp((log2(max(linearColor,vec3(0.000244140625)))+12.0)/22.0,0.0,1.0)*63.0;float lo=floor(q.b);float hi=min(lo+1.0,63.0);vec2 uvA=vec2((lo*64.0+q.r+.5)/4096.0,(q.g+.5)/64.0);vec2 uvB=vec2((hi*64.0+q.r+.5)/4096.0,(q.g+.5)/64.0);return mix(texture2D(agxLut,uvA).rgb,texture2D(agxLut,uvB).rgb,fract(q.b));}
void main(void){vec3 color=texture2D(textureSampler,vUV).rgb*vec3(1.0,1.04,1.16)*exp2(exposureEV+.85);gl_FragColor=vec4(sampleAgx(color),1.0);}`;
const wgsl=`varying vUV: vec2f;var textureSamplerSampler: sampler;var textureSampler: texture_2d<f32>;var agxLutSampler: sampler;var agxLut: texture_2d<f32>;uniform exposureEV: f32;
fn sampleAgx(linearColor:vec3f)->vec3f{let q=clamp((log2(max(linearColor,vec3f(0.000244140625)))+12.0)/22.0,vec3f(0.0),vec3f(1.0))*63.0;let lo=floor(q.b);let hi=min(lo+1.0,63.0);let uvA=vec2f((lo*64.0+q.r+.5)/4096.0,(q.g+.5)/64.0);let uvB=vec2f((hi*64.0+q.r+.5)/4096.0,(q.g+.5)/64.0);return mix(textureSample(agxLut,agxLutSampler,uvA).rgb,textureSample(agxLut,agxLutSampler,uvB).rgb,fract(q.b));}
@fragment fn main(input: FragmentInputs)->FragmentOutputs{let color=textureSample(textureSampler,textureSamplerSampler,input.vUV).rgb*vec3f(1.0,1.04,1.16)*exp2(uniforms.exposureEV+.85);fragmentOutputs.color=vec4f(sampleAgx(color),1.0);}`;
export async function createAgx(scene:Scene,camera:Camera,exposure:()=>number){
 ShaderStore.ShadersStore['mdAgxFragmentShader']=glsl;ShaderStore.ShadersStoreWGSL['mdAgxFragmentShader']=wgsl;
 const lut=await new Promise<Texture>((resolve,reject)=>{const t=new Texture('/lighting/agx-lut.png',scene,true,false,Texture.BILINEAR_SAMPLINGMODE,()=>resolve(t),reject);t.gammaSpace=false;t.wrapU=t.wrapV=Texture.CLAMP_ADDRESSMODE});
 const post=new PostProcess('AgX / source OCIO','mdAgx',{camera,engine:scene.getEngine(),size:1,uniforms:['exposureEV'],samplers:['agxLut'],shaderLanguage:scene.getEngine() instanceof WebGPUEngine?ShaderLanguage.WGSL:ShaderLanguage.GLSL,textureType:Constants.TEXTURETYPE_HALF_FLOAT});
 post.onApply=e=>{e.setTexture('agxLut',lut);e.setFloat('exposureEV',exposure())};return post;
}
