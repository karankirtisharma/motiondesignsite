import bpy,json,numpy as np,hashlib
from pathlib import Path
P=Path(__file__).resolve().parents[1];D=P/'public/lighting';W=P/'work/lighting'
scene=bpy.data.scenes.new('WEB_LIGHTMAP_DENOISE');bpy.context.window.scene=scene
cam=bpy.data.objects.new('Denoise camera',bpy.data.cameras.new('Denoise camera'));scene.collection.objects.link(cam);scene.camera=cam
scene.render.engine='CYCLES';scene.cycles.samples=1;scene.render.resolution_x=16;scene.render.resolution_y=16;scene.render.resolution_percentage=100
tree=bpy.data.node_groups.new('Source atlas denoise','CompositorNodeTree');scene.compositing_node_group=tree
source=tree.nodes.new('CompositorNodeImage');source.image=bpy.data.images.load(str(W/'reception-diffuse.exr'))
denoise=tree.nodes.new('CompositorNodeDenoise');denoise.inputs['HDR'].default_value=True;tree.links.new(source.outputs['Image'],denoise.inputs['Image'])
output=tree.nodes.new('CompositorNodeOutputFile');output.directory=str(W);output.file_name='denoised';output.file_output_items.new('RGBA','Image');output.format.media_type='IMAGE';output.format.file_format='OPEN_EXR';output.format.color_depth='16';tree.links.new(denoise.outputs['Image'],output.inputs['Image']);bpy.ops.render.render()
files=sorted(W.glob('denoised*.exr'),key=lambda p:p.stat().st_mtime);im=bpy.data.images.load(str(files[-1]));_=im.pixels[0];w,h=im.size;assert w>0 and h>0;a=np.empty(w*h*4,dtype=np.float32);im.pixels.foreach_get(a);a=a.reshape(h,w,4)
a=(a[0::2,0::2]+a[1::2,0::2]+a[0::2,1::2]+a[1::2,1::2])/4
levels=[]
while True:
 data=a.astype('<f2').tobytes();name=f'diffuse-{len(levels)}.bin';(D/name).write_bytes(data);levels.append({'uri':'/lighting/'+name,'width':a.shape[1],'height':a.shape[0],'byteLength':len(data),'sha256':hashlib.sha256(data).hexdigest()})
 if a.shape[0]<=4:break
 a=(a[0::2,0::2]+a[1::2,0::2]+a[0::2,1::2]+a[1::2,1::2])/4
record=json.loads((W/'manifest.json').read_text());record.update({'encoding':'linear-rgba16f','samples':96,'normalHandling':'Evaluated source split normals transformed with inverse transpose','denoiser':'Blender compositor OIDN accurate','levels':levels});(D/'diffuse.json').write_text(json.dumps(record,indent=2))
print('DENOISED_AND_PACKAGED',flush=True)



