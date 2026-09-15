import bpy, json, hashlib, time
from pathlib import Path
P = Path(__file__).resolve().parents[1]
S = Path(bpy.data.filepath)
H = hashlib.sha256(S.read_bytes()).hexdigest()
assert H == '8ae6ccdeb28674be7692aecc1f8fcc6d4f57c04247e406d107233f9c8487b9c7', 'Unexpected master hash'
out = P/'work'; out.mkdir(exist_ok=True)
record = {'source':str(S), 'sha256':H, 'blender':bpy.app.version_string,
          'executable':bpy.app.binary_path, 'executableSha256':hashlib.sha256(Path(bpy.app.binary_path).read_bytes()).hexdigest()}
(P/'pipeline/source-lock.json').write_text(json.dumps(record, indent=2))
names=['V03_EMPERADOR','RC Stone | honed ivory limestone scan.002','RC Metal | blackened bronze.002','STONE']
r={}
for name in names:
 m=bpy.data.materials.get(name)
 if m and m.node_tree:
  r[name]={'nodes':[{'name':n.name,'type':n.type, 'inputs':{i.name:list(i.default_value) if hasattr(i.default_value,'__len__') else i.default_value for i in n.inputs if hasattr(i,'default_value') and not i.is_linked and i.type in {'RGBA','VALUE','VECTOR'}}} for n in m.node_tree.nodes], 'links':[(l.from_node.name,l.from_socket.name,l.to_node.name,l.to_socket.name) for l in m.node_tree.links]}
(out/'material-inspection.json').write_text(json.dumps(r, indent=2))
prefs=bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type='OPTIX'; prefs.get_devices()
for d in prefs.devices: d.use=d.type=='OPTIX'
record['devices']=[(d.name,d.type,d.use) for d in prefs.devices]
(P/'pipeline/source-lock.json').write_text(json.dumps(record, indent=2))
print(json.dumps(record),flush=True)
dest=P/'work/references';dest.mkdir(exist_ok=True)
records=[]
for scene_name,camera,exposure in [('Scene','EXTERIOR_HERO',.05),('MD Interiors | Source reception lighting','RECEPTION_V09_HERO',-.25),('MD Interiors | Source reception lighting','RECEPTION_V09_EXHIBITS',-.15),('MD Interiors | Source reception lighting','RECEPTION_V09_REVERSE',-.25)]:
 s=bpy.data.scenes[scene_name];bpy.context.window.scene=s;s.camera=bpy.data.objects[camera]
 s.render.engine='CYCLES';s.cycles.device='GPU';s.cycles.samples=32;s.cycles.use_denoising=True
 s.render.resolution_x=1600;s.render.resolution_y=900;s.render.resolution_percentage=100
 s.view_settings.exposure=exposure;s.render.image_settings.file_format='PNG';s.render.filepath=str(dest/(camera+'.png'))
 t=time.time();bpy.ops.render.render(write_still=True)
 records.append({'camera':camera,'sourceSha256':H,'scene':scene_name,'matrix':[list(row) for row in s.camera.matrix_world], 'lens':s.camera.data.lens,'shift':[s.camera.data.shift_x,s.camera.data.shift_y], 'exposure':exposure,'samples':32,'resolution':[1600,900],'seconds':time.time()-t,'renderer':bpy.app.version_string,'view':s.view_settings.view_transform,'look':s.view_settings.look})
 (dest/'manifest.json').write_text(json.dumps(records,indent=2))
print('REFERENCES_COMPLETE',flush=True)
