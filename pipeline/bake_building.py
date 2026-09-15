"""Source material and diffuse-light atlases, plus room reflection captures.
Run against the locked master in a separate process. Never saves that source.
"""
import bpy,json,hashlib,math,sys,numpy as np,bmesh
from pathlib import Path
from mathutils import Vector
P=Path(__file__).resolve().parents[1];W=P/'work/lighting';D=P/'public/lighting'
src=Path(bpy.data.filepath);H=hashlib.sha256(src.read_bytes()).hexdigest()
assert H=='8ae6ccdeb28674be7692aecc1f8fcc6d4f57c04247e406d107233f9c8487b9c7'
evidence=json.loads((src.parents[3]/'work/web_spec_evidence/objects.json').read_text())
object_map=json.loads((P/'pipeline/object-map.json').read_text())['objects'];zones={r['source']:r['zone'] for r in object_map}
scene=bpy.data.scenes['MD Interiors | Source reception lighting'];bpy.context.window.scene=scene
interior_world=scene.world;exterior_world=bpy.data.scenes['Scene'].world
prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.get_devices()
for d in prefs.devices:d.use=d.type=='OPTIX'
scene.render.use_persistent_data=True;scene.render.engine='CYCLES';scene.cycles.device='GPU';scene.cycles.samples=64
def reveal(c):
 c.exclude=False;c.hide_viewport=False
 for ch in c.children:reveal(ch)
for c in bpy.data.collections:c.hide_viewport=False
reveal(bpy.context.view_layer.layer_collection)
visibility={r['name']:bool(r['render_scenes']) and not r['hide_render'] for r in evidence}
for o in scene.objects:
 o.hide_viewport=False;o.hide_set(False)
 if o.name in visibility:o.hide_render=not visibility[o.name]
bpy.context.view_layer.update()
rooms=['reception','exterior','spine','meeting','founder','lounge','lab','motion-floor','render-hall']
if '--' in sys.argv:rooms=sys.argv[sys.argv.index('--')+1:]
positions={'reception':[0,3.2,1.8],'exterior':[0,-4,3.4],'spine':[0,8,1.8],'meeting':[9,5.8,1.8],'founder':[14,7.5,1.8],'lounge':[-9,5.4,1.8],'lab':[-16,6,1.8],'motion-floor':[-3,13,2],'render-hall':[4,16,1.8]}

def repair_orientation(mesh):
 bm=bmesh.new();bm.from_mesh(mesh)
 repaired=False
 if bm.faces and all(e.is_manifold for e in bm.edges) and bm.calc_volume(signed=True)<-1e-8:
  bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh);mesh.update();repaired=True
 bm.free();return repaired

def source_material(o,m,mesh):
 # A joined atlas receiver must still evaluate source object/generated coordinates.
 clone=m.copy();clone.name='BAKE_'+o.name+'_'+m.name
 if not clone.use_nodes:return clone
 nodes=clone.node_tree.nodes;links=clone.node_tree.links
 for n in list(nodes):
  if n.type=='TEX_COORD':
   if n.object is None:n.object=o
   generated=list(n.outputs['Generated'].links)
   if generated:
    coords=nodes.new('ShaderNodeTexCoord');coords.object=o
    lo=[min(v.co[k] for v in mesh.vertices) for k in range(3)];hi=[max(v.co[k] for v in mesh.vertices) for k in range(3)]
    sub=nodes.new('ShaderNodeVectorMath');sub.operation='SUBTRACT';sub.inputs[1].default_value=lo;links.new(coords.outputs['Object'],sub.inputs[0])
    div=nodes.new('ShaderNodeVectorMath');div.operation='DIVIDE';div.inputs[1].default_value=[max(.00001,hi[k]-lo[k]) for k in range(3)];links.new(sub.outputs[0],div.inputs[0])
    for link in generated:links.new(div.outputs[0],link.to_socket)
 return clone
def denoise_and_pack(exr,folder,public,size):
 ds=bpy.data.scenes.new('Atlas cleanup');bpy.context.window.scene=ds
 cam=bpy.data.objects.new('Atlas camera',bpy.data.cameras.new('Atlas camera'));ds.collection.objects.link(cam);ds.camera=cam
 ds.render.engine='CYCLES';ds.cycles.samples=1;ds.render.resolution_x=16;ds.render.resolution_y=16;ds.render.resolution_percentage=100
 tree=bpy.data.node_groups.new('Source denoise','CompositorNodeTree');ds.compositing_node_group=tree
 node=tree.nodes.new('CompositorNodeImage');node.image=bpy.data.images.load(str(exr));den=tree.nodes.new('CompositorNodeDenoise');den.inputs['HDR'].default_value=True;tree.links.new(node.outputs['Image'],den.inputs['Image'])
 out=tree.nodes.new('CompositorNodeOutputFile');out.directory=str(folder);out.file_name='denoised';out.file_output_items.new('RGBA','Image');out.format.media_type='IMAGE';out.format.file_format='OPEN_EXR';out.format.color_depth='16';tree.links.new(den.outputs['Image'],out.inputs['Image']);bpy.ops.render.render()
 im=bpy.data.images.load(str(folder/'denoisedImage.exr'));_=im.pixels[0];w,h=im.size;assert w>0
 a=np.empty(w*h*4,dtype=np.float32);im.pixels.foreach_get(a);a=a.reshape(h,w,4)
 while a.shape[0]>size:a=(a[::2,::2]+a[1::2,::2]+a[::2,1::2]+a[1::2,1::2])/4
 levels=[]
 while True:
  data=a.astype('<f2').tobytes();name=f'diffuse-{len(levels)}.bin';(public/name).write_bytes(data);levels.append({'uri':'/lighting/'+public.name+'/'+name,'width':a.shape[1],'height':a.shape[0],'byteLength':len(data),'sha256':hashlib.sha256(data).hexdigest()})
  if a.shape[0]<=4:break
  a=(a[::2,::2]+a[1::2,::2]+a[::2,1::2]+a[1::2,1::2])/4
 bpy.context.window.scene=scene;bpy.data.scenes.remove(ds)
 return levels
for room in rooms:
 folder=W/room;folder.mkdir(exist_ok=True);public=D/room;public.mkdir(exist_ok=True)
 bpy.context.window.scene=scene;scene.world=exterior_world if room=='exterior' else interior_world
 dg=bpy.context.evaluated_depsgraph_get();verts=[];faces=[];normals=[];material_uv=[];mids=[];mats=[];ranges={};hidden=[];reversed_objects=set()
 for r in evidence:
  if zones.get(r['name'])!=room or r['type'] not in ['MESH','FONT','CURVE'] or not r['render_scenes'] or r['hide_render']:continue
  o=bpy.data.objects[r['name']];source_mats=list(o.data.materials)
  def receiver(m):
   p=next((n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None) if m and m.use_nodes else None
   return p and p.inputs['Metallic'].default_value<.999 and p.inputs['Emission Strength'].default_value==0 and p.inputs['Transmission Weight'].default_value==0
  if not source_mats or not all(receiver(m) for m in source_mats):continue
  eo=o.evaluated_get(dg);me=eo.to_mesh()
  if len(me.polygons)>18000:eo.to_mesh_clear();continue
  if repair_orientation(me):print('REPAIRED_WINDING',room,o.name,flush=True)
  reverse=o.matrix_world.to_3x3().determinant()<0
  if reverse:reversed_objects.add(o.name)
  start=len(verts);fstart=len(faces);verts.extend([tuple(o.matrix_world@v.co) for v in me.vertices]);faces.extend([tuple(start+i for i in (list(f.vertices)[::-1] if reverse else f.vertices)) for f in me.polygons])
  nm=o.matrix_world.to_3x3().inverted().transposed()
  for f in me.polygons:
   for i in (list(f.loop_indices)[::-1] if reverse else f.loop_indices):
    normals.append(tuple((nm@me.corner_normals[i].vector).normalized()));material_uv.append(tuple(me.uv_layers[0].data[i].uv) if me.uv_layers else (0,0))
  offset=len(mats);mats.extend([source_material(o,m,me) for m in source_mats]);mids.extend([offset+f.material_index for f in me.polygons]);ranges[o.name]=[fstart,len(faces)]
  hidden.append(o);eo.to_mesh_clear();o.hide_render=True
 if not faces:print('EMPTY_ZONE',room,flush=True);continue
 me=bpy.data.meshes.new('Atlas receivers '+room);me.from_pydata(verts,[],faces);me.update();ob=bpy.data.objects.new('WEB_ATLAS_'+room,me);scene.collection.objects.link(ob)
 for m in mats:me.materials.append(m)
 for f,idx in zip(me.polygons,mids):f.material_index=idx;f.use_smooth=True
 me.normals_split_custom_set(normals);layer=me.uv_layers.new(name='MaterialUV');layer.data.foreach_set('uv',np.asarray(material_uv,dtype=np.float32).flatten());layer.active_render=True
 me.uv_layers.new(name='LightUV');me.uv_layers.active_index=1
 bpy.ops.object.select_all(action='DESELECT');ob.select_set(True);bpy.context.view_layer.objects.active=ob
 bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(angle_limit=math.radians(70),island_margin=.008,area_weight=1,scale_to_bounds=True);bpy.ops.object.mode_set(mode='OBJECT')
 uv={};polygons=list(me.polygons)
 for name,(lo,hi) in ranges.items():uv[name]=[[float(v) for v in me.uv_layers[1].data[i].uv] for f in polygons[lo:hi] for i in (list(f.loop_indices)[::-1] if name in reversed_objects else f.loop_indices)]
 (folder/'uv-map.json').write_text(json.dumps(uv))
 size=2048 if room=='exterior' else 1024;bake_size=size*2
 image=bpy.data.images.new('Atlas '+room,width=bake_size,height=bake_size,float_buffer=True);image.colorspace_settings.name='Non-Color'
 for m in mats:
  n=m.node_tree.nodes.new('ShaderNodeTexImage');n.image=image;m.node_tree.nodes.active=n
 if not (public/'surface-v4.txt').exists():
  scene.cycles.samples=1;scene.render.bake.margin=16;scene.render.bake.use_pass_direct=False;scene.render.bake.use_pass_indirect=False;scene.render.bake.use_pass_color=True
  print('BAKING_ALBEDO',room,len(ranges),len(faces),flush=True);bpy.ops.object.bake(type='DIFFUSE',use_clear=True,uv_layer='LightUV')
  scene.view_settings.view_transform='Standard';scene.view_settings.look='None';scene.view_settings.exposure=0;scene.view_settings.gamma=1;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_depth='8';scene.render.image_settings.color_mode='RGB';image.save_render(str(public/'albedo.png'),scene=scene)
  scene.view_settings.view_transform='Raw';scene.view_settings.look='None'
  print('BAKING_SURFACE',room,flush=True);bpy.ops.object.bake(type='ROUGHNESS',use_clear=True,uv_layer='LightUV');image.save_render(str(public/'roughness.png'),scene=scene)
  bpy.ops.object.bake(type='NORMAL',normal_space='OBJECT',use_clear=True,uv_layer='LightUV');image.save_render(str(public/'normal.png'),scene=scene);(public/'surface-v4.txt').write_text('Outward winding on closed solids; exact source coordinates and materials.')
 scene.cycles.samples=64;scene.render.bake.margin=16;scene.render.bake.use_pass_direct=True;scene.render.bake.use_pass_indirect=True;scene.render.bake.use_pass_color=False
 print('BAKING_LIGHT',room,flush=True);bpy.ops.object.bake(type='DIFFUSE',use_clear=True,uv_layer='LightUV');image.file_format='OPEN_EXR';image.filepath_raw=str(folder/'diffuse.exr');image.save()
 bpy.data.objects.remove(ob,do_unlink=True)
 for o in hidden:o.hide_render=False
 levels=denoise_and_pack(folder/'diffuse.exr',folder,public,size)
 (public/'diffuse.json').write_text(json.dumps({'sourceSha256':H,'samples':64,'encoding':'linear-rgba16f','normalHandling':'Evaluated source split normals','denoiser':'Blender OIDN','receivers':list(ranges),'levels':levels},indent=2))
 # Capture the actual local lighting and reflected room geometry.
 bpy.context.window.scene=scene;camera=bpy.data.objects.new('Web probe '+room,bpy.data.cameras.new('Web probe '+room));scene.collection.objects.link(camera);camera.location=positions[room];camera.rotation_euler=(math.pi/2,0,0);camera.data.type='PANO';camera.data.panorama_type='EQUIRECTANGULAR';scene.camera=camera
 scene.cycles.samples=24;scene.cycles.use_denoising=True;scene.render.resolution_x=1024;scene.render.resolution_y=512;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='OPEN_EXR';scene.render.image_settings.color_depth='16';scene.render.filepath=str(folder/'probe.exr');bpy.ops.render.render(write_still=True)
 hdr=bpy.data.images.load(str(folder/'probe.exr'));_=hdr.pixels[0];hdr.filepath_raw=str(public/'reflection.hdr');hdr.file_format='HDR';hdr.save();bpy.data.objects.remove(camera,do_unlink=True)
 print('ROOM_COMPLETE',room,flush=True)
print('BUILDING_BAKE_COMPLETE',flush=True)
