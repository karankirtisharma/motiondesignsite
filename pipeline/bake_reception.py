"""Source-lit review atlas, with source receiver convention recorded explicitly.
This is not a certified albedo-independent irradiance extraction.
"""
import bpy,json,hashlib,math,numpy as np,sys
from pathlib import Path
from mathutils import Vector
P=Path(__file__).resolve().parents[1];D=P/'work/lighting';D.mkdir(parents=True,exist_ok=True)
src=Path(bpy.data.filepath);H=hashlib.sha256(src.read_bytes()).hexdigest()
assert H=='8ae6ccdeb28674be7692aecc1f8fcc6d4f57c04247e406d107233f9c8487b9c7'
s=bpy.data.scenes['MD Interiors | Source reception lighting'];bpy.context.window.scene=s
prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.get_devices()
for d in prefs.devices:d.use=d.type=='OPTIX'
s.render.engine='CYCLES';s.cycles.device='GPU';s.cycles.samples=96;s.cycles.use_denoising=True
s.render.bake.use_pass_direct=True;s.render.bake.use_pass_indirect=True;s.render.bake.use_pass_color=False;s.render.bake.margin=16
def reveal(c):
 c.exclude=False;c.hide_viewport=False
 for ch in c.children:reveal(ch)
for c in bpy.data.collections:c.hide_viewport=False
reveal(bpy.context.view_layer.layer_collection)
for o in s.objects:o.hide_viewport=False;o.hide_set(False)
bpy.context.view_layer.update();dg=bpy.context.evaluated_depsgraph_get()
names=[];verts=[];faces=[];mids=[];mats=[];ranges={};corner_normals=[]
evidence=json.loads((src.parents[3]/'work/web_spec_evidence/objects.json').read_text())
for r in evidence:
 if r['type'] not in ['MESH','CURVE','FONT'] or not r['render_scenes'] or r['hide_render']:continue
 if not(r['name']=='SLAB_GALLERY' or any(c in ['V09 | Architecture','V09 | Logo','V09 | Counter','V09 | Exhibits'] for c in r['collections'])):continue
 o=bpy.data.objects[r['name']]
 if not o.data.materials:continue
 source_mats=list(o.data.materials)
 def receiver(m):
  p=next((n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None) if m and m.use_nodes else None
  return p and p.inputs['Metallic'].default_value<.5 and p.inputs['Emission Strength'].default_value==0 and p.inputs['Transmission Weight'].default_value==0
 if not all(receiver(m) for m in source_mats):continue
 eo=o.evaluated_get(dg);me=eo.to_mesh();start=len(verts);fstart=len(faces)
 verts.extend([tuple(o.matrix_world@v.co) for v in me.vertices]);faces.extend([tuple(start+i for i in p.vertices) for p in me.polygons])
 normal_matrix=o.matrix_world.to_3x3().inverted().transposed()
 corner_normals.extend([tuple((normal_matrix@n.vector).normalized()) for n in me.corner_normals])
 for m in source_mats:
  if m not in mats:mats.append(m)
 mids.extend([mats.index(source_mats[p.material_index]) for p in me.polygons]);ranges[o.name]=[fstart,len(faces)]
 names.append(o.name);eo.to_mesh_clear();o.hide_render=True
me=bpy.data.meshes.new('Source diffuse receivers');me.from_pydata(verts,[],faces);me.update()
ob=bpy.data.objects.new('WEB_SOURCE_DIFFUSE_RECEIVERS',me);s.collection.objects.link(ob)
for m in mats:me.materials.append(m)
for p,idx in zip(me.polygons,mids):p.material_index=idx;p.use_smooth=True
me.normals_split_custom_set(corner_normals)
# Exact source texture anchors remain present in the scene.
me.uv_layers.new(name='MaterialUV');me.uv_layers.new(name='LightUV');me.uv_layers.active_index=1
bpy.ops.object.select_all(action='DESELECT');ob.select_set(True);bpy.context.view_layer.objects.active=ob
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(angle_limit=math.radians(70),island_margin=.012,area_weight=1,scale_to_bounds=True);bpy.ops.object.mode_set(mode='OBJECT')
uv={}
for name,(lo,hi) in ranges.items():uv[name]=[[float(v) for v in me.uv_layers[1].data[i].uv] for p in list(me.polygons)[lo:hi] for i in p.loop_indices]
(D/'uv-map.json').write_text(json.dumps(uv))
im=bpy.data.images.new('SOURCE_DIFFUSE_LINEAR',width=2048,height=2048,float_buffer=True);im.colorspace_settings.name='Non-Color'
for m in mats:
 n=m.node_tree.nodes.new('ShaderNodeTexImage');n.image=im;m.node_tree.nodes.active=n
print('BAKING',len(names),len(faces),flush=True)
if '--albedo' in sys.argv:
 s.render.bake.use_pass_direct=False;s.render.bake.use_pass_indirect=False;s.render.bake.use_pass_color=True
 bpy.ops.object.bake(type='DIFFUSE',use_clear=True)
 s.view_settings.view_transform='Standard';s.view_settings.look='None';s.view_settings.exposure=0;s.view_settings.gamma=1
 s.render.image_settings.file_format='PNG';s.render.image_settings.color_depth='8';s.render.image_settings.color_mode='RGB'
 im.save_render(str(P/'public/lighting/reception-albedo.png'),scene=s)
 print('ALBEDO_COMPLETE',flush=True)
 sys.exit(0)
bpy.ops.object.bake(type='DIFFUSE',use_clear=True)
im.filepath_raw=str(D/'reception-diffuse.exr');im.file_format='OPEN_EXR';im.save()
pixels=np.asarray(im.pixels[:],dtype=np.float32).reshape(2048,2048,4);rgb=np.maximum(pixels[:,:,:3],0)
scale=max(1,float(np.max(rgb)));encoded=np.ones_like(pixels);encoded[:,:,:3]=np.clip(rgb/scale,0,1)
# Linear RGB with one global scale, so ordinary filtering is linear and valid.
# 16-bit PNG preserves dark gradients without nonlinear RGBD interpolation.
out=bpy.data.images.new('SOURCE_DIFFUSE_TRANSPORT',width=2048,height=2048,float_buffer=True);out.colorspace_settings.name='Non-Color';out.pixels.foreach_set(encoded.flatten())
s.view_settings.view_transform='Raw';s.view_settings.look='None';s.view_settings.exposure=0;s.view_settings.gamma=1
s.render.image_settings.file_format='PNG';s.render.image_settings.color_depth='16';s.render.image_settings.color_mode='RGB';out.save_render(str(D/'reception-diffuse.png'),scene=s)
(D/'manifest.json').write_text(json.dumps({'sourceSha256':H,'receivers':names,'scale':scale,'size':2048,'samples':24,'encoding':'linear-rgb16-global-scale','convention':'Cycles diffuse direct+indirect, color excluded; receiver BRDF weighting remains unqualified.','limitations':['Global scale PNG transport instead of specified RGBD mip chain.','Full irradiance/albedo/BRDF calibration gate is pending.']},indent=2))
print('BAKE_COMPLETE',scale,flush=True)
