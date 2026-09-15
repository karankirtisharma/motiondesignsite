import {BloomEffect,Constants,FxaaPostProcess,PostProcessRenderPipeline,Scene,type Camera} from '@babylonjs/core';
/** Keep the scene linear through bloom. AgX is the sole display transform. */
export class ArchitecturalFinish {
 private bloom:BloomEffect;
 constructor(scene:Scene,camera:Camera){
  const pipeline=new PostProcessRenderPipeline(scene.getEngine(),'Linear architectural finish');
  this.bloom=new BloomEffect(scene,.5,.055,48,Constants.TEXTURETYPE_HALF_FLOAT,false);
  this.bloom.threshold=1.5;
  pipeline.addEffect(this.bloom);scene.postProcessRenderPipelineManager.addPipeline(pipeline);
  scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline(pipeline.name,[camera]);
 }
 set bloomEnabled(enabled:boolean){this.bloom.weight=enabled?.055:0;}
 addAntialiasing(scene:Scene,camera:Camera){new FxaaPostProcess('Display antialiasing',1,camera,undefined,scene.getEngine(),false,Constants.TEXTURETYPE_UNSIGNED_BYTE);}
}
