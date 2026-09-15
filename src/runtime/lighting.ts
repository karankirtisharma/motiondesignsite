import {Color3,DirectionalLight,HemisphericLight,Light,PointLight,Scene,Vector3} from '@babylonjs/core';
interface Source {name:string;position:number[];color:number[];energy:number;size:number}
interface Slot {light:PointLight;source?:Source;fade:number}
/** The reference's fixed light pool: shader light count stays constant throughout the tour. */
export class StudioLighting {
  private slots:Slot[]=[];
  private timer=0;
  private sun:DirectionalLight;
  private hemi:HemisphericLight;
  constructor(scene:Scene,private sources:Source[]){
    this.sun=new DirectionalLight('Dusk sun',new Vector3(-.35,-.55,-.76).normalize(),scene);
    this.sun.diffuse=new Color3(1,.82,.62);this.sun.intensity=.35;
    this.hemi=new HemisphericLight('Dusk sky bounce',Vector3.Up(),scene);
    this.hemi.diffuse=new Color3(.72,.76,.88);this.hemi.groundColor=new Color3(.24,.18,.12);this.hemi.intensity=.25;
    for(let i=0;i<6;i++){
      const light=new PointLight('Local light '+i,Vector3.Zero(),scene);
      light.intensityMode=Light.INTENSITYMODE_LUMINOUSINTENSITY;
      light.falloffType=Light.FALLOFF_GLTF;light.intensity=0;
      this.slots.push({light,fade:0});
    }
  }
  private room(p:number[]){const [x,h,z]=p,y=-z;if(y<0)return 'exterior';if(x>13)return 'founder';if(x< -13)return 'lab';if(y>=9)return x<2?'floor':'render';if(y>=7)return 'spine';return x< -5?'lounge':x>5?'meeting':'reception';}
  update(dt:number,camera:Vector3,inside:number){
    this.sun.intensity=1.6*(1-inside*.985);this.hemi.intensity=.5*(1-inside*.8);
    this.timer-=dt;
    if(this.timer<=0){
      this.timer=.2;
      const ranked=this.sources.map(source=>({source,score:source.energy*(this.room(source.position)===this.room(camera.asArray())?1:.015)/Math.max(1,Vector3.DistanceSquared(camera,Vector3.FromArray(source.position)))})).sort((a,b)=>b.score-a.score).slice(0,this.slots.length).map(r=>r.source);
      const taken=new Set<Source>();
      for(const slot of this.slots){if(slot.source&&ranked.includes(slot.source))taken.add(slot.source);else slot.source=undefined;}
      const free=ranked.filter(s=>!taken.has(s));
      for(const slot of this.slots)if(!slot.source&&slot.fade<.02&&free.length)slot.source=free.shift();
    }
    let settling=false;
    for(const slot of this.slots){
      const target=slot.source?1:0;slot.fade+=(target-slot.fade)*(1-Math.exp(-dt*4));
      if(Math.abs(target-slot.fade)>.001)settling=true;
      if(slot.source){const s=slot.source;slot.light.position.copyFromFloats(s.position[0],s.position[1],s.position[2]);slot.light.diffuse=Color3.FromArray(s.color);slot.light.specular=slot.light.diffuse;slot.light.range=Math.min(38,6+Math.sqrt(s.energy*.07)*2.2+s.size);slot.light.intensity=s.energy*.012*slot.fade;}
      else slot.light.intensity*=Math.exp(-dt*4);
    }
    return settling;
  }
  static async create(scene:Scene){const response=await fetch('/look/lights.json');if(!response.ok)throw Error('Studio lighting unavailable');return new StudioLighting(scene,await response.json());}
}

