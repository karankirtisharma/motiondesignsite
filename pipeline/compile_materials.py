"""Compile source shader graphs to separate PBR maps in a small isolated bake scene."""
import bpy,json,hashlib,math,re,sys
from pathlib import Path
P=Path(__file__).resolve().parents[1];OUT=P/'public/materials';OUT.mkdir(exist_ok=True)
source=Path(bpy.data.filepath);source_hash=hashlib.sha256(source.read_bytes()).hexdigest()
evidence=json.loads((source.parents[3]/'work/web_spec_evidence/objects.json').read_text())
active={name for r in evidence if r['render_scenes'] and not r['hide_render'] for name in r.get('materials',[])}
matrices={o.name:[list(row) for row in o.matrix_world] for o in bpy.data.objects if o.type in ['MESH','CURVE','FONT']}
(P/'work/source-object-matrices.json').write_text(json.dumps(matrices),encoding='utf-8')
scene=bpy.data.scenes.new('PBR material compiler');bpy.context.window.scene=scene
scene.render.engine='CYCLES';scene.cycles.samples=1;scene.cycles.device='GPU';scene.render.use_persistent_data=True
prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.get_devices()
for device in prefs.devices:device.use=device.type=='OPTIX'
mesh=bpy.data.meshes.new('Material tile');mesh.from_pydata([(0,0,0),(1,0,0),(1,1,0),(0,1,0)],[],[(0,1,2,3)]);mesh.update()
uv=mesh.uv_layers.new(name='UVMap')
for i,point in enumerate([(0,0),(1,0),(1,1),(0,1)]):uv.data[i].uv=point
plane=bpy.data.objects.new('Material tile',mesh);scene.collection.objects.link(plane);plane.select_set(True);bpy.context.view_layer.objects.active=plane
scene.render.bake.margin=0;scene.render.bake.use_clear=True
scene.view_settings.view_transform='Standard';scene.view_settings.look='None';scene.view_settings.exposure=0;scene.view_settings.gamma=1
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGB';scene.render.image_settings.color_depth='8'
procedural_only="--procedural-only" in sys.argv
recipes=json.loads((OUT/"source-materials.json").read_text())["materials"] if procedural_only else {}
def upstream(socket,seen=None):
 seen=seen or set();result=[]
 for link in socket.links:
  node=link.from_node
  if node.name in seen:continue
  seen.add(node.name);result.append(node)
  for inp in node.inputs:result+=upstream(inp,seen)
 return result
def vector_steps(socket):
 if not socket.is_linked:return {'kind':'UV','steps':[]}
 link=socket.links[0];n=link.from_node
 if n.type=='TEX_COORD':return {'kind':link.from_socket.name,'anchor':n.object.name if n.object else None,'steps':[]}
 if n.type=='UVMAP':return {'kind':'UV','steps':[]}
 if n.type=='MAPPING':
  result=vector_steps(n.inputs['Vector']);result['steps'].append({'type':'mapping','location':list(n.inputs['Location'].default_value),'rotation':list(n.inputs['Rotation'].default_value),'scale':list(n.inputs['Scale'].default_value)});return result
 if n.type=='VECT_MATH' and n.operation=='SCALE':
  result=vector_steps(n.inputs[0]);result['steps'].append({'type':'scale','value':n.inputs['Scale'].default_value});return result
 return {'kind':'UV','steps':[],'unsupported':n.type}
def bake_map(material,image,socket,name,raw=False,normal=False):
 nodes=material.node_tree.nodes;links=material.node_tree.links;output=next(n for n in nodes if n.type=='OUTPUT_MATERIAL');old=output.inputs['Surface'].links[0].from_socket
 image_node=nodes.new('ShaderNodeTexImage');image_node.image=image;nodes.active=image_node
 if not normal:
  emission=nodes.new('ShaderNodeEmission')
  if socket.is_linked:links.new(socket.links[0].from_socket,emission.inputs['Color'])
  else:
   value=socket.default_value;emission.inputs['Color'].default_value=(value,value,value,1) if isinstance(value,(int,float)) else value
  links.new(emission.outputs[0],output.inputs['Surface'])
 bpy.ops.object.bake(type='NORMAL' if normal else 'EMIT',normal_space='TANGENT',use_clear=True)
 scene.view_settings.view_transform='Raw' if raw else 'Standard';image.save_render(str(OUT/name),scene=scene)
 if not normal:links.new(old,output.inputs['Surface']);nodes.remove(emission)
 nodes.remove(image_node)
for src in list(bpy.data.materials):
 if src.name not in active or not src.use_nodes:continue
 p=next((n for n in src.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
 if not p:continue
 key=hashlib.sha256(src.name.encode()).hexdigest()[:12]
 recipe={'name':src.name,'color':list(p.inputs['Base Color'].default_value),'metallic':p.inputs['Metallic'].default_value,'roughness':p.inputs['Roughness'].default_value,'ior':p.inputs['IOR'].default_value,'alpha':p.inputs['Alpha'].default_value,'coat':p.inputs['Coat Weight'].default_value,'coatRoughness':p.inputs['Coat Roughness'].default_value,'emission':list(p.inputs['Emission Color'].default_value),'emissionStrength':p.inputs['Emission Strength'].default_value,'procedural':bool(p.inputs['Base Color'].is_linked),'normalStrength':1}
 images=[n for n in upstream(p.inputs['Base Color']) if n.type=='TEX_IMAGE' and n.image]
 emission_images=[n for n in upstream(p.inputs['Emission Color']) if n.type=='TEX_IMAGE' and n.image]
 blackbody=next((n for n in upstream(p.inputs['Emission Color']) if n.type=='BLACKBODY'),None)
 if blackbody:recipe['temperature']=blackbody.inputs['Temperature'].default_value
 if procedural_only and images:continue
 if not images and not recipe['procedural']:
  if not procedural_only:recipes[src.name]=recipe
  continue
 if images:
  primary=images[0];recipe['projection']=primary.projection;recipe['mapping']=vector_steps(primary.inputs['Vector']);recipe['sourceImage']=primary.image.name
  size=min(2048,max(primary.image.size));size=2048 if size>1024 else 1024
 else:
  recipe['projection']='BOX';recipe['mapping']={'kind':'Object','anchor':None,'steps':[]};recipe['compiledProcedural']=True;size=1024
 clone=src.copy();nodes=clone.node_tree.nodes;links=clone.node_tree.links;cp=next(n for n in nodes if n.type=='BSDF_PRINCIPLED')
 coord=nodes.new('ShaderNodeTexCoord')
 # Compile color operations independently of placement; geometry receives the source projection.
 for node in nodes:
  if node.type=='TEX_IMAGE':links.new(coord.outputs['UV'],node.inputs['Vector'])
  if not images and node.type=='TEX_COORD' and node!=coord:
   for output in node.outputs:
    for link in list(output.links):links.new(coord.outputs['UV'],link.to_socket)
 mesh.materials.clear();mesh.materials.append(clone)
 image=bpy.data.images.new('Compiled material',width=size,height=size,float_buffer=True);image.colorspace_settings.name='Non-Color'
 print('COMPILING_MATERIAL',src.name,size,flush=True)
 name=key+'-color.png';bake_map(clone,image,cp.inputs['Base Color'],name);recipe['albedo']='/materials/'+name;recipe['color']=[1,1,1,1]
 if cp.inputs['Roughness'].is_linked:
  name=key+'-rough.png';bake_map(clone,image,cp.inputs['Roughness'],name,raw=True);recipe['roughnessMap']='/materials/'+name;recipe['roughness']=1
 if cp.inputs['Normal'].is_linked:
  name=key+'-normal.png';bake_map(clone,image,cp.inputs['Normal'],name,raw=True,normal=True);recipe['normal']='/materials/'+name
 if emission_images:
  name=key+'-emission.png';bake_map(clone,image,cp.inputs['Emission Color'],name);recipe['emissionMap']='/materials/'+name
 recipes[src.name]=recipe;bpy.data.images.remove(image);mesh.materials.clear();bpy.data.materials.remove(clone)
 (OUT/'source-materials.json').write_text(json.dumps({'sourceSha256':source_hash,'materials':recipes},indent=2),encoding='utf-8')
(OUT/'source-materials.json').write_text(json.dumps({'sourceSha256':source_hash,'materials':recipes},indent=2),encoding='utf-8')
assert hashlib.sha256(source.read_bytes()).hexdigest()==source_hash
print('MATERIAL_COMPILATION_COMPLETE',len(recipes),flush=True)
