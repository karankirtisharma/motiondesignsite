"""Extract every source image and inspect source material graphs without saving the master."""
import bpy,json,hashlib,re
from pathlib import Path
P=Path(__file__).resolve().parents[1]
OUT=P/'textures/original';OUT.mkdir(parents=True,exist_ok=True)
source=Path(bpy.data.filepath);before=hashlib.sha256(source.read_bytes()).hexdigest()
def serial(v):
 try:
  if isinstance(v,(str,int,float,bool)) or v is None:return v
  return list(v)
 except:return str(v)
images=[]
for im in bpy.data.images:
 if im.type in ['RENDER_RESULT','COMPOSITING']:continue
 name=re.sub(r'[^a-zA-Z0-9._-]+','_',im.name).strip('_')
 entry={'name':im.name,'source':im.source,'colorSpace':im.colorspace_settings.name,'size':list(im.size),'originalPath':im.filepath,'files':[]}
 packed=list(im.packed_files)
 if packed:
  for i,part in enumerate(packed):
   data=bytes(part.packed_file.data);ext=Path(part.filepath or im.filepath).suffix
   if not ext or len(ext)>6:
    ext='.png' if data.startswith(b'\x89PNG') else '.jpg' if data.startswith(b'\xff\xd8') else '.exr' if data[:4]==b'v/1\x01' else '.bin'
   file=f'{name}_{i}{ext}';(OUT/file).write_bytes(data)
   entry['files'].append({'path':'textures/original/'+file,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
 else:
  path=Path(bpy.path.abspath(im.filepath)) if im.filepath else None
  if path and path.is_file():
   data=path.read_bytes();file=name+path.suffix;(OUT/file).write_bytes(data);entry['files'].append({'path':'textures/original/'+file,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
  elif im.size[0] and im.size[1]:
   file=name+('.exr' if im.is_float else '.png');oldpath,oldformat=im.filepath_raw,im.file_format
   im.filepath_raw=str(OUT/file);im.file_format='OPEN_EXR' if im.is_float else 'PNG';im.save();im.filepath_raw=oldpath;im.file_format=oldformat
   data=(OUT/file).read_bytes();entry['files'].append({'path':'textures/original/'+file,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
  else:entry['missing']=True
 images.append(entry)
materials=[]
for m in bpy.data.materials:
 if not m.use_nodes:continue
 nodes=[]
 for n in m.node_tree.nodes:
  row={'name':n.name,'type':n.type,'inputs':{s.name:serial(s.default_value) for s in n.inputs if hasattr(s,'default_value')},'links':{s.name:[{'node':l.from_node.name,'socket':l.from_socket.name} for l in s.links] for s in n.inputs if s.is_linked}}
  for prop in ['operation','blend_type','data_type','projection','projection_blend','interpolation','vector_type','space','invert','uv_map']:
   if hasattr(n,prop):row[prop]=serial(getattr(n,prop))
  if n.type=='TEX_IMAGE':row['image']=n.image.name if n.image else None
  if n.type=='TEX_COORD':row['object']=n.object.name if n.object else None;row['objectMatrix']=list(sum((list(r) for r in n.object.matrix_world),[])) if n.object else None
  if n.type=='VALTORGB':row['ramp']=[{'position':e.position,'color':list(e.color)} for e in n.color_ramp.elements]
  if n.type=='CURVE_RGB':row['curves']=[[[p.location[0],p.location[1]] for p in c.points] for c in n.mapping.curves]
  nodes.append(row)
 materials.append({'name':m.name,'nodes':nodes})
manifest={'sourceSha256':before,'imageCount':len(images),'extractedCount':sum(bool(i['files']) for i in images),'images':images,'materials':materials}
(P/'textures/manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
assert hashlib.sha256(source.read_bytes()).hexdigest()==before
print('TEXTURES_EXTRACTED',len(images),manifest['extractedCount'],len(materials),flush=True)
