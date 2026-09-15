import bpy,json,numpy as np
from pathlib import Path
P=Path(__file__).resolve().parents[1];uv=json.loads((P/'work/lighting/reception/uv-map.json').read_text());a=np.fromfile(P/'public/lighting/reception/diffuse-0.bin',dtype='<f2').reshape(1024,1024,4)
for c in bpy.data.collections:c.hide_viewport=False
def reveal(c):
 c.exclude=False;c.hide_viewport=False
 for ch in c.children:reveal(ch)
reveal(bpy.context.view_layer.layer_collection)
dg=bpy.context.evaluated_depsgraph_get()
for name in ['V09 | MD | solid limestone M','V09 | MD | solid limestone D','V09 | MD stone feature wall','V09 | Suspended mineral bronze ceiling','SLAB_GALLERY','V09 | Reception | bronze front panel']:
 if name not in uv:continue
 o=bpy.data.objects[name];eo=o.evaluated_get(dg);me=eo.to_mesh();me.calc_loop_triangles();nm=o.matrix_world.to_3x3().inverted().transposed()
 print('OBJECT',name,'det',o.matrix_world.determinant(),'uvcount',len(uv[name]),'loops',len(me.loops),flush=True)
 triangles=sorted(me.loop_triangles,key=lambda t:t.area,reverse=True)
 for t in triangles[:12]:
  u,v=np.mean([uv[name][li] for li in t.loops],axis=0);pixel=a[min(1023,int(v*1024)),min(1023,int(u*1024)),:3]
  print('N',tuple(nm@t.normal),'area',t.area,'uv',u,v,'diffuse',pixel.tolist(),flush=True)
 eo.to_mesh_clear()
