"""Publish 2K lightmaps from existing denoised source EXRs without rebaking the master."""
import bpy,json,hashlib,gzip,numpy as np
from pathlib import Path
P=Path(__file__).resolve().parents[1]
for path in (P/'public/lighting').glob('*/diffuse.json'):
 source=P/'work/lighting'/path.parent.name/'denoisedImage.exr'
 image=bpy.data.images.load(str(source));w,h=image.size
 pixels=np.empty(w*h*4,dtype=np.float32);image.pixels.foreach_get(pixels);a=pixels.reshape(h,w,4)
 while a.shape[0]>2048:a=(a[::2,::2]+a[1::2,::2]+a[::2,1::2]+a[1::2,1::2])/4
 levels=[]
 while True:
  raw=a.astype('<f2').tobytes();name=f'diffuse-{len(levels)}.bin.pack';packed=gzip.compress(raw,compresslevel=9)
  (path.parent/name).write_bytes(packed)
  levels.append({'uri':f'/lighting/{path.parent.name}/{name}','width':a.shape[1],'height':a.shape[0],'byteLength':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'encoding':'gzip','transferBytes':len(packed)})
  if a.shape[0]<=4:break
  a=(a[::2,::2]+a[1::2,::2]+a[::2,1::2]+a[1::2,1::2])/4
 data=json.loads(path.read_text());data['levels']=levels;path.write_text(json.dumps(data,indent=2))
 bpy.data.images.remove(image);print('RESTORED_2K_LIGHTING',path.parent.name,flush=True)
