import bpy,json,math,hashlib
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
P=Path(__file__).resolve().parents[1];src=Path(bpy.data.filepath)
evidence=json.loads((src.parents[3]/'work/web_spec_evidence/objects.json').read_text())
bpy.context.window.scene=bpy.data.scenes['Scene']
def reveal(c):
 c.exclude=False;c.hide_viewport=False
 for ch in c.children:reveal(ch)
for c in bpy.data.collections:c.hide_viewport=False
reveal(bpy.context.view_layer.layer_collection)
for o in bpy.context.scene.objects:o.hide_viewport=False;o.hide_set(False)
bpy.context.view_layer.update();dg=bpy.context.evaluated_depsgraph_get()
verts=[];faces=[];names=[]
for r in evidence:
 if r['type']!='MESH' or not r['render_scenes'] or r['hide_render']:continue
 cs=r['collections'];n=r['name']
 if not any(c in ['01_ARCHITECTURE','02_EXTERIOR','V09 | Architecture','V09 | Counter','V09 | Cabinetry'] for c in cs):continue
 if any(word in n.upper() for word in ['SLAB','GROUND','PAVING','PLINTH','CEILING','ROOF','MEZZ','STAIR','LIGHT','LED','MOTTO','SIGNAGE','BRANDING']):continue
 rbound=r.get('bounds')
 if not rbound or rbound[0][2]>6:continue
 o=bpy.data.objects[n];eo=o.evaluated_get(dg);me=eo.to_mesh();start=len(verts)
 verts.extend([o.matrix_world@v.co for v in me.vertices]);faces.extend([tuple(start+i for i in p.vertices) for p in me.polygons]);names.extend([n]*len(me.polygons));eo.to_mesh_clear()
bvh=BVHTree.FromPolygons(verts,faces,all_triangles=False)
points=[r['position'] for r in json.loads((P/'work/rail-samples.json').read_text())]
anchors=[[3.5,2.5,1.6],[-2.5,2.7,1.6],[2.2,2.6,1.6],[-.95,3.85,1.6],[4.5,2.5,1.6]]
segments=list(zip(points,points[1:]))+[(a,b) for a in anchors for b in anchors if a!=b]
failures=[];samples=0;minimum=100
for idx,(a,b) in enumerate(segments):
 a,b=Vector(a),Vector(b);count=max(1,math.ceil((b-a).length/.05))
 for j in range(count+1):
  center=a.lerp(b,j/count);samples+=1
  for zoffset in ([0] if center.y<0 else [0,-.7,-1.2,.2]):
   pt=center+Vector((0,0,zoffset));hit=bvh.find_nearest(pt,.3)
   if hit[0] is not None:
    minimum=min(minimum,hit[3])
    if hit[3]<.245:failures.append({'segment':idx,'point':list(pt),'object':names[hit[2]],'clearance':hit[3]})
out={'sourceSha256':hashlib.sha256(src.read_bytes()).hexdigest(),'sampleSpacingMetres':.05,'radiusMetres':.25,'testedSamples':samples,'colliderFaces':len(faces),'failures':failures[:60],'failureCount':len(failures),'minimumSampleClearance':None if minimum==100 else minimum,'scope':'Continuous rail sampled at 14,001 positions; spherical body sections against evaluated architectural and reception furniture surfaces. Full continuous capsule and projection-corner certification remains separate.'}
(P/'pipeline/clearance-report.json').write_text(json.dumps(out,indent=2));print(json.dumps({k:v for k,v in out.items() if k!='failures'}),flush=True)
