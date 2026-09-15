"""Read-only frozen-source export. Run in an isolated Blender process.
The output is a review derivative; remaining rendering exceptions are recorded.
"""
import bpy, json, hashlib, math, time, numpy as np, re, sys, bmesh
from pathlib import Path
from mathutils import Vector
P=Path(__file__).resolve().parents[1]; W=P/'work';W.mkdir(exist_ok=True)
RAW=W/'geometry';RAW.mkdir(exist_ok=True)
SRC=Path(bpy.data.filepath);H=hashlib.sha256(SRC.read_bytes()).hexdigest()
assert H=='8ae6ccdeb28674be7692aecc1f8fcc6d4f57c04247e406d107233f9c8487b9c7'
ROOT=SRC.parents[3]
evidence=json.loads((ROOT/'work/web_spec_evidence/objects.json').read_text())
byname={r['name']:r for r in evidence}
for c in bpy.data.collections:c.hide_viewport=False
def reveal(c):
 c.exclude=False;c.hide_viewport=False
 for ch in c.children:reveal(ch)
bpy.context.window.scene=bpy.data.scenes['Scene'];source_scene=bpy.context.scene
reveal(bpy.context.view_layer.layer_collection)
for o in bpy.data.objects:o.hide_viewport=False;o.hide_set(False)
bpy.context.view_layer.update();dg=bpy.context.evaluated_depsgraph_get()
collection=bpy.data.collections.new('WEB DERIVATIVE');source_scene.collection.children.link(collection)
requested=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else ['exterior','reception','spine','founder','meeting','lounge','lab','motion-floor','render-hall']
active=[];records=[];excluded=[];recipes={};mat_cache={};image_cache={}
light_uv={}
if not (W/'lighting/reception/uv-map.json').exists() and (W/'lighting/uv-map.json').exists():light_uv=json.loads((W/'lighting/uv-map.json').read_text())
for uvfile in (W/'lighting').glob('*/uv-map.json'):light_uv.update(json.loads(uvfile.read_text()))

def repair_orientation(mesh):
 bm=bmesh.new();bm.from_mesh(mesh)
 repaired=False
 if bm.faces and all(e.is_manifold for e in bm.edges) and bm.calc_volume(signed=True)<-1e-8:
  bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh);mesh.update();repaired=True
 bm.free();return repaired

def principled(m):return next((n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None) if m and m.use_nodes else None
def upstream(socket, seen=None):
 seen=seen or set()
 if not socket.is_linked:return []
 n=socket.links[0].from_node
 if n.name in seen:return []
 seen.add(n.name);r=[n]
 for inp in n.inputs:r+=upstream(inp,seen)
 return r
def image_for(sock):return next((n.image for n in upstream(sock) if n.type=='TEX_IMAGE' and n.image),None)
def texture_scale(sock, name):
 nodes=upstream(sock)
 for n in nodes:
  if n.type=='VECT_MATH' and n.operation=='SCALE':return float(n.inputs['Scale'].default_value)
 if 'WALNUT' in name:return .35
 return 1.0
def transformed_image(sock, name):
 nodes=upstream(sock);im=next((n.image for n in nodes if n.type=='TEX_IMAGE' and n.image),None)
 if not im:return None
 key=name+'_'+sock.name
 if key in image_cache:return image_cache[key]
 width,height=im.size;pixels=np.empty(width*height*4,dtype=np.float32);im.pixels.foreach_get(pixels);pixels=pixels.reshape(height,width,4)
 # Keep source UV artwork; limit review textures to 1024 on long edge.
 step=max(1,math.ceil(max(width,height)/1024));arr=pixels[::step,::step,:3].copy()
 # Image buffers expose scene-linear values. Apply connected color operations.
 for node in reversed(nodes):
  if node.type=='CURVE_RGB':
   node.mapping.initialize();xs=np.linspace(0,1,2049)
   for ch in range(3):
    curve=node.mapping.curves[ch];vals=np.array([node.mapping.evaluate(curve,float(x)) for x in xs]);arr[:,:,ch]=np.interp(arr[:,:,ch],xs,vals)
   vals=np.array([node.mapping.evaluate(node.mapping.curves[3],float(x)) for x in xs]);arr=np.interp(arr,xs,vals)
  elif node.type=='HUE_SAT':
   sat=node.inputs['Saturation'].default_value;val=node.inputs['Value'].default_value
   lum=np.max(arr,axis=2,keepdims=True);arr=(lum+(arr-lum)*sat)*val
  elif node.type=='VALTORGB' and any(n.type=='RGBTOBW' for n in nodes):
   lum=arr[:,:,0]*.2126+arr[:,:,1]*.7152+arr[:,:,2]*.0722
   stops=list(node.color_ramp.elements);pos=[e.position for e in stops]
   arr=np.stack([np.interp(lum,pos,[e.color[ch] for e in stops]) for ch in range(3)],axis=2)
 a=np.ones((arr.shape[0],arr.shape[1],4),dtype=np.float32);a[:,:,:3]=np.maximum(arr,0)
 out=bpy.data.images.new('WEB_'+re.sub(r'[^a-zA-Z0-9]','_',key),width=a.shape[1],height=a.shape[0])
 out.colorspace_settings.name='sRGB';out.pixels.foreach_set(a.flatten());out.pack()
 image_cache[key]=out;return out
def material(src,zone):
 key=(src.name,zone)
 if key in mat_cache:return mat_cache[key]
 m=bpy.data.materials.new('WEB__'+zone+'__'+src.name);m.use_nodes=True;n=m.node_tree.nodes.get('Principled BSDF');p=principled(src)
 recipe={'source':src.name,'zone':zone,'material':m.name,'method':'glTF PBR, assigned source maps and connected color adjustments','textureScale':1}
 if p:
  for prop in ['Base Color','Metallic','Roughness','IOR','Alpha','Transmission Weight','Coat Weight','Coat Roughness','Emission Color','Emission Strength']:
   if prop in p.inputs and prop in n.inputs:
    n.inputs[prop].default_value=p.inputs[prop].default_value
  for prop in ['Base Color','Emission Color']:
   if p.inputs[prop].is_linked:
    im=transformed_image(p.inputs[prop],src.name)
    if im:
     tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=im;m.node_tree.links.new(tex.outputs['Color'],n.inputs[prop]);recipe['image']=im.name
    else:
     ramps=[a for a in upstream(p.inputs[prop]) if a.type=='VALTORGB']
     if ramps:
      colors=[e.color for e in ramps[0].color_ramp.elements];n.inputs[prop].default_value=[sum(c[i] for c in colors)/len(colors) for i in range(4)]
      recipe['approximation']='Procedural color uses ramp average in review derivative; source-scale texture bake pending.'
  if p.inputs['Roughness'].is_linked:n.inputs['Roughness'].default_value=.32 if 'Stone' in src.name else .3
  if n.inputs['Transmission Weight'].default_value>.1:n.inputs['Alpha'].default_value=.14;n.inputs['Transmission Weight'].default_value=0;recipe['glass']='Thin tinted transparency; refraction qualification pending.'
  recipe['textureScale']=texture_scale(p.inputs['Base Color'],src.name)
  recipe['metallic']=n.inputs['Metallic'].default_value;recipe['roughness']=n.inputs['Roughness'].default_value
 else:
  n.inputs['Base Color'].default_value=src.diffuse_color
  emit=next((x for x in src.node_tree.nodes if x.type=='EMISSION'),None) if src.use_nodes else None
  if emit:n.inputs['Emission Color'].default_value=emit.inputs['Color'].default_value;n.inputs['Emission Strength'].default_value=emit.inputs['Strength'].default_value
 mat_cache[key]=m;recipes[m.name]=recipe;return m
def zone_for(r):
 cs=r['collections'];name=r['name']
 if any(c.startswith('V09 |') and 'Archived' not in c for c in cs):return 'reception'
 if name=='SLAB_GALLERY':return 'reception'
 slab={'SLAB_FOUNDER':'founder','SLAB_LAB':'lab','SLAB_FLOOR':'motion-floor','SLAB_RENDER':'render-hall','SLAB_SPINE':'spine'}
 if name in slab:return slab[name]
 if any(c in ['01_ARCHITECTURE','02_EXTERIOR'] for c in cs):return 'exterior'
 for room,zone in [('FOUNDER','founder'),('LOUNGE','lounge'),('MEETING','meeting'),('LAB','lab'),('FLOOR','motion-floor'),('RENDER','render-hall')]:
  if any(room in c for c in cs):return zone
 if '10_LIGHTING' in cs:return 'exterior'
 if 'V07_MODERN_MONITORS' in cs and r.get('bounds'):
  x=r['bounds'][0][0];return 'founder' if x>13 else 'lab' if x<-13 else 'motion-floor'
 return None
for r in evidence:
 if r['type'] not in ['MESH','CURVE','FONT']:continue
 zone=zone_for(r)
 if not zone or zone not in requested:continue
 if not r['render_scenes'] or r['hide_render']:
  excluded.append(r['name']);continue
 o=bpy.data.objects.get(r['name'])
 if o is None:continue
 try:
  evaluated=o.evaluated_get(dg);mesh=bpy.data.meshes.new_from_object(evaluated,preserve_all_data_layers=True,depsgraph=dg)
  if not len(mesh.polygons):continue
  repaired=repair_orientation(mesh)
  if repaired:print('REPAIRED_WINDING',o.name,flush=True)
  copy=bpy.data.objects.new('WEB_'+o.name,mesh);collection.objects.link(copy);copy.matrix_world=o.matrix_world.copy()
  copy['source_id']=hashlib.sha256(o.name.encode()).hexdigest()[:16];copy['source_name']=o.name;copy['zone']=zone
  # Preserve original material UVs for supplied artwork and imported assets.
  has_uv=bool(mesh.uv_layers)
  if not has_uv:
   uv=mesh.uv_layers.new(name='UVMap')
   for poly in mesh.polygons:
    axis=max(range(3),key=lambda k:abs(poly.normal[k]));ab=[k for k in range(3) if k!=axis]
    orig=mesh.materials[poly.material_index] if poly.material_index<len(mesh.materials) else None
    p=principled(orig);scale=texture_scale(p.inputs['Base Color'],orig.name) if p else 1
    anchored=any(t.type=='TEX_COORD' and t.object for t in upstream(p.inputs['Base Color'])) if p else False
    for li in poly.loop_indices:
     v=mesh.vertices[mesh.loops[li].vertex_index].co
     if anchored:v=o.matrix_world@v
     uv.data[li].uv=(v[ab[0]]*scale,v[ab[1]]*scale)
  baked=o.name in light_uv and len(light_uv[o.name])==len(mesh.loops)
  if baked:
   while len(mesh.uv_layers)>1:mesh.uv_layers.remove(mesh.uv_layers[-1])
   layer=mesh.uv_layers.new(name='LightUV');layer.data.foreach_set('uv',np.array(light_uv[o.name],dtype=np.float32).flatten());mesh.uv_layers.active_index=0;mesh.uv_layers[0].active_render=True
   copy['baked_diffuse']=True
  original_mats=list(mesh.materials);mesh.materials.clear()
  for m in original_mats:mesh.materials.append(material(m,zone+('__baked' if baked else '')) if m else material(bpy.data.materials['STONE'],zone))
  triangles=sum(len(p.vertices)-2 for p in mesh.polygons)
  limit=22000 if zone=='motion-floor' else 35000 if zone in ['lab','meeting'] else 120000 if zone in ['founder','lounge'] else 160000
  if triangles>limit and not baked:
   mod=copy.modifiers.new('Web derivative detail','DECIMATE');mod.ratio=limit/triangles
   bpy.context.view_layer.objects.active=copy;bpy.ops.object.modifier_apply(modifier=mod.name)
  active.append(copy);records.append({'id':copy['source_id'],'source':o.name,'zone':zone,'windingRepaired':repaired,'sourceTrianglesEvaluated':triangles,'exportTriangles':sum(len(p.vertices)-2 for p in copy.data.polygons),'bounds':r['bounds']})
 except Exception as ex:raise RuntimeError(o.name+': '+str(ex))
print('EVALUATED',len(active),flush=True)
for zone in requested:
 bpy.ops.object.select_all(action='DESELECT')
 selected=[o for o in active if o['zone']==zone]
 for o in selected:o.select_set(True)
 bpy.context.view_layer.objects.active=selected[0]
 bpy.ops.export_scene.gltf(filepath=str(RAW/(zone+'.glb')),export_format='GLB',use_selection=True,export_apply=True,export_extras=True,export_yup=True,export_cameras=False,export_lights=False,export_animations=False,export_materials='EXPORT',export_image_format='AUTO')
 print('EXPORTED',zone,(RAW/(zone+'.glb')).stat().st_size,flush=True)
if (P/'pipeline/object-map.json').exists():
 records += [r for r in json.loads((P/'pipeline/object-map.json').read_text())['objects'] if r['zone'] not in requested]
(P/'pipeline/object-map.json').write_text(json.dumps({'objects':records,'excluded':excluded},indent=2))
if (P/'pipeline/material-recipes.json').exists():
 recipes.update({k:v for k,v in json.loads((P/'pipeline/material-recipes.json').read_text()).items() if v['zone'].split('__')[0] not in requested})
(P/'pipeline/material-recipes.json').write_text(json.dumps(recipes,indent=2))
cams=[{k:r[k] for k in ['name','location','forward','up','matrix_world','lens_mm','sensor','shift','exposure_hint'] if k in r} for r in evidence if r['type']=='CAMERA' and ('HERO' in r['name'] or r['name'].startswith('RECEPTION_V09') or r['name'] in ['SPINE_V09','EXTERIOR_FRONT'])]
(P/'public/cameras.json').write_text(json.dumps(cams,indent=2))
assert hashlib.sha256(SRC.read_bytes()).hexdigest()==H
print('EXPORT_COMPLETE',flush=True)
