import {LoadAssetContainerAsync,Scene,type AssetContainer} from '@babylonjs/core';
export interface Asset {id:string;uri:string;sha256:string;byteLength:number;triangles:number;primitives:number}
export interface Release {schemaVersion:1;releaseId:string;coordinates:string;assets:Asset[]}
export class AssetRegistry {
  private tasks=new Map<string,Promise<AssetContainer>>();
  private containers=new Map<string,AssetContainer>();
  private controller=new AbortController();
  constructor(private scene:Scene,public release:Release){}
  load(id:string):Promise<AssetContainer>{
    const existing=this.tasks.get(id);if(existing)return existing;
    const task=this.loadAsset(id);this.tasks.set(id,task);task.catch(()=>this.tasks.delete(id));return task;
  }
  private async loadAsset(id:string){
    const asset=this.release.assets.find(a=>a.id===id);if(!asset)throw Error(`Missing asset ${id}`);
    let failure:unknown;
    for(let attempt=0;attempt<3;attempt++){
      try{
        // Content-hashed URLs are immutable, so revisits can reuse downloaded rooms.
        const response=await fetch(asset.uri,{signal:this.controller.signal,cache:'force-cache'});if(!response.ok)throw Error(`${id}: HTTP ${response.status}`);
        const bytes=await response.arrayBuffer();
        if(bytes.byteLength!==asset.byteLength)throw Error(`${id}: payload length mismatch`);
        const digest=await crypto.subtle.digest('SHA-256',bytes);const hash=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
        if(hash!==asset.sha256)throw Error(`${id}: integrity check failed`);
        const url=URL.createObjectURL(new Blob([bytes]));
        try{const container=await LoadAssetContainerAsync(url,this.scene,{pluginExtension:'.glb'});this.containers.set(id,container);return container}finally{URL.revokeObjectURL(url)}
      }catch(error){failure=error;if(this.controller.signal.aborted)throw error;if(attempt<2)await new Promise(resolve=>setTimeout(resolve,attempt?2000:500))}
    }
    throw failure;
  }
  dispose(){this.controller.abort();for(const c of this.containers.values())c.dispose();this.containers.clear();this.tasks.clear()}
}
