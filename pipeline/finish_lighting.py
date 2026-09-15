import bpy,math,json,numpy as np,gzip,hashlib
from pathlib import Path
P=Path(__file__).resolve().parents[1];D=P/'public/lighting';D.mkdir(exist_ok=True)
im=bpy.data.images.load(str(P/'work/lighting/reception-diffuse.exr'));w,h=im.size
a=np.empty(w*h*4,dtype=np.float32);im.pixels.foreach_get(a);a=a.reshape(h,w,4)
# Direct linear half-float delivery, with explicit offline mip uploads.
a=(a[0::2,0::2]+a[1::2,0::2]+a[0::2,1::2]+a[1::2,1::2])/4
levels=[]
while True:
 raw=a.astype('<f2').tobytes();z=gzip.compress(raw,compresslevel=6);name='diffuse-'+str(len(levels))+'.rgba16f.gz';(D/name).write_bytes(z)
 levels.append({'uri':'/lighting/'+name,'width':a.shape[1],'height':a.shape[0],'byteLength':len(z),'sha256':hashlib.sha256(z).hexdigest()})
 if a.shape[0]<=4:break
 a=(a[0::2,0::2]+a[1::2,0::2]+a[0::2,1::2]+a[1::2,1::2])/4
record=json.loads((P/'work/lighting/manifest.json').read_text());record.update({'encoding':'linear-rgba16f-gzip','levels':levels,'limitations':['Receiver BRDF weighting is not yet certified as irradiance.','Offline linear mip chain uses bake gutters; independent per-island dilation remains unverified.']});(D/'diffuse.json').write_text(json.dumps(record,indent=2))
print('LIGHTMAP_PACKAGED',sum(l['byteLength'] for l in levels),flush=True)
# Capture actual source lighting and geometry as local reflection environments.
prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.get_devices()
for device in prefs.devices:device.use=device.type=='OPTIX'
for scene_name,position,name in [('MD Interiors | Source reception lighting',(0,3.2,1.8),'reception'),('Scene',(0,-4,3.4),'exterior')]:
 s=bpy.data.scenes[scene_name];bpy.context.window.scene=s;s.render.engine='CYCLES';s.cycles.device='GPU';s.cycles.samples=16;s.cycles.use_denoising=True
 data=bpy.data.cameras.new('WEB_PROBE_'+name);ob=bpy.data.objects.new(data.name,data);s.collection.objects.link(ob);data.type='PANO';data.panorama_type='EQUIRECTANGULAR';ob.location=position;ob.rotation_euler=(math.pi/2,0,0);s.camera=ob
 s.render.resolution_x=1024;s.render.resolution_y=512;s.render.resolution_percentage=100;s.render.image_settings.file_format='OPEN_EXR';s.render.image_settings.color_depth='16';s.render.filepath=str(P/'work/lighting'/(name+'-probe.exr'))
 if not Path(s.render.filepath).exists():bpy.ops.render.render(write_still=True)
 hdr=bpy.data.images.load(s.render.filepath);pixel=hdr.pixels[0];hdr.filepath_raw=str(D/(name+'.hdr'));hdr.file_format='HDR';hdr.save()
 print('PROBE_COMPLETE',name,flush=True)
