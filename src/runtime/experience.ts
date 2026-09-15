import {ArchitecturalFinish} from './finish';
import {advanceScroll} from './scroll-motion';
import {Engine,WebGPUEngine,Scene,UniversalCamera,Vector3,Color3,Color4,Camera,PBRMaterial,MirrorTexture,Plane,Texture,MeshoptCompression,ImageProcessingConfiguration,HDRCubeTexture,type AbstractEngine,type AssetContainer} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import {AssetRegistry,type Release} from './assets';
import {poseAt,world,anchors,anchorPose,chapters,chapterAt,roomAt,receptionPhase,type Pose} from './track';
import {loadDiffuse,SourceDiffusePlugin} from './diffuse-plugin';
import {createAgx} from './agx';
import {StudioEnvironment} from './environment';
import {StudioLighting} from './lighting';
import {DetailMaterials} from './materials';
type Quality='high'|'balanced'|'mobile';
interface Options{quality:Quality;reduced:boolean;onReady:()=>void;onStatus:(s:string)=>void;onChange:(s:{phase:number;exploring:boolean;anchor?:string;description:string;room:string;chapter:string;chapterIndex:number;reception:boolean})=>void;onFail:(s:unknown)=>void}
export class Experience {
  private environment!:StudioEnvironment;private lighting!:StudioLighting;
  private engine!:AbstractEngine;private scene!:Scene;private camera!:UniversalCamera;private assets!:AssetRegistry;
  private scrollRange=1;private velocity=0;private phase=0;private target=0;private ready=false;private receptionReady=false;private paused=false;private exploring=false;private seeking=false;private anchor=0;
  private loadLimit=receptionPhase+.005;private waitingForRooms=false;
  private saved={phase:0,scroll:0};private lastTime=0;private pointer:{x:number;y:number;id:number}|null=null;private yaw=0;private pitch=0;
  private moving?:{from:Pose;to:Pose;elapsed:number;duration:number};private currentPose=poseAt(0);private mirror?:MirrorTexture;private pipeline?:ArchitecturalFinish;
  private looping=false;private renderFrame=()=>this.tick();private warmupFrames=8;private invalidated=true;private frameTimes:number[]=[];private slowFrames=0;private recovery=0;
  private navigation?:Awaited<ReturnType<typeof import('./navigation').createNavigation>>;private navigationTask?:Promise<void>;
  constructor(private canvas:HTMLCanvasElement,private options:Options){}
  async init(){
    history.scrollRestoration='manual';window.scrollTo(0,0);
    MeshoptCompression.Configuration={decoder:{url:'/decoders/meshopt_decoder.js'}};
    const backend=new URLSearchParams(location.search).get('backend');
    if(backend!=='webgl2'&&window.isSecureContext&&await WebGPUEngine.IsSupportedAsync){try{const gpu=new WebGPUEngine(this.canvas,{antialias:true});await gpu.initAsync({jsPath:"/decoders/webgpu/glslang.js",wasmPath:"/decoders/webgpu/glslang.wasm"},{jsPath:"/decoders/webgpu/twgsl.js",wasmPath:"/decoders/webgpu/twgsl.wasm"});this.engine=gpu}catch(error){console.warn('WebGPU initialization failed; trying WebGL2.',error)}}
    if(!this.engine)this.engine=new Engine(this.canvas,true,{preserveDrawingBuffer:true,stencil:true,powerPreference:'high-performance'},false);
    if(this.engine instanceof Engine&&this.engine.webGLVersion<2)throw Error('WebGL2 is required');
    this.scene=new Scene(this.engine);this.scene.useRightHandedSystem=true;this.scene.clearColor=new Color4(.007,.007,.01,1);
    this.scene.imageProcessingConfiguration.toneMappingEnabled=true;this.scene.imageProcessingConfiguration.toneMappingType=ImageProcessingConfiguration.TONEMAPPING_ACES;
    this.scene.imageProcessingConfiguration.exposure=1.035;this.scene.imageProcessingConfiguration.contrast=1.1;
    this.camera=new UniversalCamera('journey',world([30,-45,5.2]),this.scene);this.camera.minZ=.05;this.camera.maxZ=5000;this.camera.fovMode=Camera.FOVMODE_HORIZONTAL_FIXED;
    this.scene.skipPointerMovePicking=true;this.scene.activeCamera=this.camera;this.applyPose(poseAt(0));this.setQuality(this.options.quality);
    this.environment=new StudioEnvironment(this.scene);
    const [lighting,detail,release]=await Promise.all([
      StudioLighting.create(this.scene),DetailMaterials.create(this.scene),
      fetch('/release.json').then(r=>{if(!r.ok)throw Error('Release unavailable');return r.json()}) as Promise<Release>,
      this.environment.load(),
    ]);
    this.lighting=lighting;
    if(release.schemaVersion!==1||release.coordinates!=='RH_Y_UP_METRES')throw Error('Unsupported release manifest');
    this.assets=new AssetRegistry(this.scene,release);
    this.options.onStatus('Preparing arrival');
    const containers=new Map<string,AssetContainer>();
    const initial=['exterior','reception','spine'];
    await Promise.all(initial.map(async id=>containers.set(id,await this.loadRoom(id,detail))));
    const exterior=containers.get('exterior')!,reception=containers.get('reception')!;
    const floorMaterials=reception.materials.filter((m):m is PBRMaterial=>m instanceof PBRMaterial&&m.name.includes('V03_EMPERADOR'));
    this.mirror=new MirrorTexture('Polished reception stone',{ratio:.5},this.scene,true);this.mirror.gammaSpace=false;this.mirror.mirrorPlane=new Plane(0,-1,0,.025);this.mirror.level=1;this.mirror.blurKernel=6;
    this.mirror.renderList=[reception,exterior,containers.get('spine')!].flatMap(c=>c.meshes).filter(m=>!floorMaterials.includes(m.material as PBRMaterial));
    if(this.options.quality!=='mobile')for(const mat of floorMaterials){mat.reflectionTexture=this.mirror;mat.environmentIntensity=1;mat.specularIntensity=0;}
    this.environment.setReflectionMeshes([...containers.values()].flatMap(c=>c.meshes));
    this.scene.imageProcessingConfiguration.applyByPostProcess=true;this.scene.imageProcessingConfiguration.toneMappingEnabled=false;this.scene.imageProcessingConfiguration.exposure=1;this.scene.imageProcessingConfiguration.contrast=1;
    this.pipeline=new ArchitecturalFinish(this.scene,this.camera);this.pipeline.bloomEnabled=this.options.quality!=='mobile';
    this.options.onStatus('Preparing the final image');
    await createAgx(this.scene,this.camera,()=>this.currentPose.exposure).catch(e=>{throw new Error('AgX load: '+e)});
    this.pipeline.addAntialiasing(this.scene,this.camera);
    await this.scene.whenReadyAsync();
    this.receptionReady=true;this.ready=true;this.options.onReady();this.options.onStatus('');this.bindInputs();this.emit();
    this.navigationTask=import('./navigation').then(async m=>{this.navigation=await m.createNavigation()}).catch(e=>console.warn('Reception navigation unavailable',e));
    for(const container of containers.values())for(const mesh of container.meshes){mesh.isPickable=false;mesh.freezeWorldMatrix();}
    this.wake();
    // Give the first interactive frame a chance to paint before decoding later rooms.
    document.body.dataset.loadingStage='arrival-ready';
    const remaining=release.assets.filter(a=>!initial.includes(a.id));
    const finishRooms=async()=>{
      await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
      // Two workers bound concurrent decoding and GPU uploads on smaller devices.
      const queue=[...remaining];
      await Promise.all([0,1].map(async()=>{
        while(queue.length){const asset=queue.shift()!;const container=await this.loadRoom(asset.id,detail);containers.set(asset.id,container);
          this.environment.setReflectionMeshes([...containers.values()].flatMap(c=>c.meshes));
          this.invalidated=true;this.wake();
          await new Promise(resolve=>setTimeout(resolve,0));
        }
      }));
      await this.scene.whenReadyAsync();
      this.loadLimit=1;document.body.dataset.loadingStage='complete';document.body.dataset.allRoomsMs=performance.now().toFixed(0);
      if(this.waitingForRooms){this.options.onStatus('');this.waitingForRooms=false;}
      this.invalidated=true;this.wake();
    };
    const roomsReady=finishRooms();
    void roomsReady.catch(error=>this.options.onFail(error));
    const review=new URLSearchParams(location.search).get('reviewCamera');if(review){await roomsReady;await this.reviewCamera(review);}

    (window as unknown as {__MD:unknown}).__MD={getState:()=>({phase:this.phase,target:this.target,exploring:this.exploring,ready:this.ready,receptionReady:this.receptionReady,backend:this.engine instanceof WebGPUEngine?'webgpu':'webgl2',meshes:this.scene.meshes.length,materials:this.scene.materials.length,triangles:this.scene.meshes.reduce((n,m)=>n+m.getTotalIndices()/3,0),fps:this.engine.getFps(),frameTimes:this.frameTimes.slice()}),seek:(p:number)=>this.seek(p),reviewCamera:(n:string)=>this.reviewCamera(n)};
  }
  private async loadRoom(id:string,detail:DetailMaterials){
    const base='/lighting/'+id;
    const [container,diffuse,roomReflection]=await Promise.all([
      this.assets.load(id),loadDiffuse(this.scene,base+'/diffuse.json'),
      id==='exterior'?Promise.resolve(this.environment.dusk):new Promise<HDRCubeTexture>((resolve,reject)=>{
        const t=new HDRCubeTexture(base+'/reflection.hdr',this.scene,128,false,true,false,true,()=>resolve(t),reject);
      }),
    ]);
    this.prepareMaterials(container,id!=='exterior');
    for(const mat of container.materials)if(mat instanceof PBRMaterial){
      const glass=mat.name.toLowerCase().includes('glass');
      mat.reflectionTexture=roomReflection;mat.environmentIntensity=glass?1:id==='exterior'?.85:.65;
      mat.specularIntensity=glass?0:mat.name.includes('__baked')?.5:1;
      if(!detail.apply(mat))throw Error('Source material missing: '+mat.name);
      if(mat.name.includes('__baked'))new SourceDiffusePlugin(mat,diffuse,undefined,id==='exterior'?1:0);
    }
    container.addAllToScene();
    for(const mesh of container.meshes){if(mesh.name.includes('ENV_GROUND'))mesh.setEnabled(false);mesh.isPickable=false;mesh.freezeWorldMatrix();}
    return container;
  }
  private prepareMaterials(container:AssetContainer,interior:boolean){
    for(const mat of container.materials)if(mat instanceof PBRMaterial){
      mat.enableSpecularAntiAliasing=true;mat.maxSimultaneousLights=8;mat.useRadianceOverAlpha=false;mat.useSpecularOverAlpha=false;
      for(const t of mat.getActiveTextures())t.anisotropicFilteringLevel=this.options.quality==='high'?8:4;
      if(mat.name.toLowerCase().includes('glass')){mat.alpha=.16;mat.albedoColor=new Color3(.75,.80,.82);mat.transparencyMode=PBRMaterial.PBRMATERIAL_ALPHABLEND;mat.roughness=.045;mat.metallic=0;mat.backFaceCulling=false;mat.disableDepthWrite=true;mat.subSurface.isRefractionEnabled=false;}

    }
  }
  private wake(){if(!this.ready||this.paused||document.hidden||this.looping)return;this.looping=true;this.lastTime=performance.now();this.engine.runRenderLoop(this.renderFrame);}
  private sleep(){this.engine.stopRenderLoop(this.renderFrame);this.looping=false;}
  private applyPose(pose:Pose){this.currentPose=pose;this.camera.position.copyFrom(pose.position);this.camera.rotationQuaternion=null;this.camera.setTarget(pose.target);this.camera.fov=pose.fov;this.invalidated=true;this.wake();}
  private bindInputs(){
    this.scrollRange=Math.max(1,document.documentElement.scrollHeight-innerHeight);
    addEventListener('scroll',()=>{if(this.exploring||this.paused)return;this.target=scrollY/this.scrollRange;this.seeking=false;this.wake();},{passive:true});
    addEventListener('resize',()=>{this.scrollRange=Math.max(1,document.documentElement.scrollHeight-innerHeight);this.engine.resize();this.applyPose(this.currentPose)});
    document.addEventListener('visibilitychange',()=>{this.lastTime=0;if(document.hidden)this.sleep();else{this.invalidated=true;this.wake();}});
    this.canvas.addEventListener('pointerdown',e=>{if(!this.exploring)return;this.pointer={x:e.clientX,y:e.clientY,id:e.pointerId};this.canvas.setPointerCapture(e.pointerId);this.canvas.focus()});
    this.canvas.addEventListener('pointermove',e=>{if(!this.pointer||!this.exploring)return;this.yaw=Math.max(-1.22,Math.min(1.22,this.yaw-(e.clientX-this.pointer.x)*.003));this.pitch=Math.max(-.436,Math.min(.436,this.pitch+(e.clientY-this.pointer.y)*.003));this.pointer={x:e.clientX,y:e.clientY,id:e.pointerId};this.applyLook()});
    this.canvas.addEventListener('pointerup',()=>this.pointer=null);this.canvas.addEventListener('pointercancel',()=>this.pointer=null);
    this.canvas.addEventListener('keydown',e=>{if(!this.exploring||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();if(e.key==='ArrowLeft')this.yaw+=.07;if(e.key==='ArrowRight')this.yaw-=.07;if(e.key==='ArrowUp')this.pitch-=.05;if(e.key==='ArrowDown')this.pitch+=.05;this.yaw=Math.max(-1.22,Math.min(1.22,this.yaw));this.pitch=Math.max(-.436,Math.min(.436,this.pitch));this.applyLook()});
    this.canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.paused=true;document.body.classList.remove('gpu-ready');this.options.onStatus('Restoring the view')});
    this.canvas.addEventListener('webglcontextrestored',()=>{if(this.recovery++===0){this.setQuality('mobile');this.paused=false;this.invalidated=true;document.body.classList.add('gpu-ready');this.options.onStatus('')}else this.options.onFail('Repeated graphics reset')});
  }
  private viewPose():Pose{return {...this.currentPose,position:this.camera.position.clone(),target:this.camera.position.add(this.camera.getForwardRay().direction.scale(5))};}
  private applyLook(){this.camera.rotationQuaternion=null;this.camera.setTarget(this.currentPose.target);this.camera.rotation.y+=this.yaw;this.camera.rotation.x+=this.pitch;this.camera.rotation.z=0;this.invalidated=true;this.wake();}
  private tick(){const now=performance.now(),dt=Math.min(.05,Math.max(0,(now-this.lastTime)/1000||0));this.lastTime=now;if(document.hidden||this.paused||!this.ready)return;let changing=false;
    if(this.moving){const m=this.moving;m.elapsed+=dt;const t=Math.min(1,m.elapsed/m.duration),e=t*t*(3-2*t);this.applyPose({position:Vector3.Lerp(m.from.position,m.to.position,e),target:Vector3.Lerp(m.from.target,m.to.target,e),fov:m.from.fov+(m.to.fov-m.from.fov)*e,exposure:m.to.exposure});if(t===1)this.moving=undefined;changing=true}
    else if(!this.exploring&&!this.seeking&&Math.abs(Math.min(this.target,this.loadLimit)-this.phase)>.000001){
      const response=advanceScroll(this.phase,Math.min(this.target,this.loadLimit),this.velocity,dt);this.velocity=response.velocity;
      this.phase=response.value;this.applyPose(poseAt(this.phase));this.emit();changing=true;
    }
    const waiting=this.target>this.loadLimit&&this.phase>=this.loadLimit-.001;
    if(waiting!==this.waitingForRooms){this.waitingForRooms=waiting;this.options.onStatus(waiting?'Preparing the next rooms':'');}
    this.environment.update(dt,this.camera.position,this.options.reduced);
    const lightsSettling=this.lighting.update(dt,this.camera.position,this.environment.inside);
    if(changing||this.invalidated||lightsSettling||(!this.options.reduced&&this.environment.inside<.999)||this.warmupFrames>0){this.scene.render();document.body.dataset.fps=this.engine.getFps().toFixed(1);this.warmupFrames--;this.invalidated=false;if(dt>0){this.frameTimes.push(dt*1000);if(this.frameTimes.length>1800)this.frameTimes.shift();if(dt>.04)this.slowFrames++;else this.slowFrames=Math.max(0,this.slowFrames-1);if(this.slowFrames>150&&this.options.quality!=='mobile'){this.setQuality('mobile');this.slowFrames=0}}}
    if(!changing&&!this.invalidated&&!lightsSettling&&this.warmupFrames<=0&&(this.options.reduced||this.environment.inside>=.999))this.sleep();
  }
  async seek(phase:number,scroll=true){phase=Math.max(0,Math.min(1,phase));if(this.exploring)this.returnToPath();this.target=phase;this.seeking=false;if(scroll)window.scrollTo({top:phase*(document.documentElement.scrollHeight-innerHeight),behavior:'instant'});this.wake();}
  enter(){if(this.phase<receptionPhase*.8){void this.seek(receptionPhase);return;}this.saved={phase:this.phase,scroll:scrollY};this.exploring=true;document.body.style.overflow='hidden';this.canvas.tabIndex=0;this.canvas.focus();this.yaw=this.pitch=0;this.emit();}
  travelToRoom(id:string){const chapter=chapters.find(c=>c.id===id);if(chapter)void this.seek(id==='render-hall'?1:chapter.phase);}
  getChapters(){return chapters;}
  private inReceptionApron(){const p=this.currentPose.position;return roomAt(this.phase)==='reception'&&p.x>=-4.5&&p.x<=4.6&&-p.z>=2&&-p.z<=4.15;}

  async exploreAnchor(id:string){const index=anchors.findIndex(a=>a.id===id);if(index<0||!this.receptionReady||!this.inReceptionApron())return;try{await this.navigationTask;const to=anchorPose(index);const route=this.navigation?.path(this.currentPose.position,to.position);if(!route?.length)return;if(!this.exploring){this.saved={phase:this.phase,scroll:scrollY};this.exploring=true;document.body.style.overflow='hidden';this.canvas.tabIndex=0;}
    this.anchor=index;this.yaw=0;this.pitch=0;to.position=route[route.length-1];this.moving={from:this.viewPose(),to,elapsed:0,duration:this.options.reduced?.01:Math.max(1.5,Vector3.Distance(this.currentPose.position,to.position)/1.2)};this.wake();this.emit();}catch(e){this.options.onStatus('This viewpoint is not available. Return to the path to continue.');console.error(e)}}
  cycleAnchor(direction:number){this.exploreAnchor(anchors[(this.anchor+direction+anchors.length)%anchors.length].id)}
  returnToPath(){if(!this.exploring)return;const from=this.viewPose();this.exploring=false;document.body.style.overflow='';window.scrollTo({top:this.saved.scroll,behavior:'instant'});this.phase=this.target=this.saved.phase;this.velocity=0;this.canvas.tabIndex=-1;this.yaw=this.pitch=0;this.moving={from,to:poseAt(this.saved.phase),elapsed:0,duration:this.options.reduced?.01:Math.max(.45,Vector3.Distance(this.currentPose.position,poseAt(this.saved.phase).position)/2)};this.wake();this.emit();}
  setQuality(value:Quality){this.options.quality=value;if(!this.engine)return;const cap=value==='high'?1.5:value==='balanced'?1.25:1,limit=value==='high'?3686400:value==='balanced'?2073600:900000;const dpr=Math.min(devicePixelRatio,cap,Math.sqrt(limit/(innerWidth*innerHeight)));this.engine.setHardwareScalingLevel(1/dpr);this.engine.resize();if(this.pipeline)this.pipeline.bloomEnabled=value!=='mobile';this.environment?.setQuality(value);this.invalidated=true;this.wake();}
  setReducedMotion(value:boolean){this.options.reduced=value}
  pause(){this.returnToPath();this.paused=true;this.sleep();document.body.style.overflow=''}
  resume(){this.paused=false;this.invalidated=true;this.wake();this.emit()}
  private emit(){const chapter=chapterAt(this.phase),reception=this.inReceptionApron();document.body.dataset.fps=this.engine.getFps().toFixed(1);document.body.dataset.phase=this.phase.toFixed(5);document.body.dataset.camera=this.currentPose.position.asArray().map(v=>v.toFixed(3)).join(',');document.body.dataset.backend=this.engine instanceof WebGPUEngine?'webgpu':'webgl2';this.options.onChange({phase:this.phase,exploring:this.exploring,anchor:this.exploring&&reception?anchors[this.anchor].id:undefined,description:reception?anchors[this.anchor].text:'Drag to look around. Return to the path to continue the uninterrupted journey.',room:roomAt(this.phase),chapter:chapter.title,chapterIndex:chapters.indexOf(chapter),reception});}
  async reviewCamera(name:string){const cameras=await fetch('/cameras.json').then(r=>r.json());const c=cameras.find((v:{name:string})=>v.name===name);if(!c)throw Error('Unknown review camera');this.target=this.phase=name.startsWith('EXTERIOR')?0:name.startsWith('RECEPTION')?receptionPhase+.01:chapters.find(c=>name.startsWith(c.id.toUpperCase().split('-')[0]))?.phase??receptionPhase;this.seeking=true;this.applyPose({position:world(c.location),target:world(c.location).add(world(c.forward)),fov:2*Math.atan(18/c.lens_mm),exposure:c.exposure_hint??0});this.emit();this.invalidated=true;}
}

