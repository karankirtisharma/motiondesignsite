import bpy,json,numpy as np,math,bmesh
from pathlib import Path
P=Path(__file__).resolve().parents[1];s=bpy.data.scenes['MD Interiors | Source reception lighting'];bpy.context.window.scene=s
prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.get_devices()
for d in prefs.devices:d.use=d.type=='OPTIX'
s.render.engine='CYCLES';s.cycles.device='GPU';s.cycles.samples=32
o=bpy.data.objects['V09 | MD | solid limestone M'];o.hide_viewport=False;o.hide_set(False);bpy.context.view_layer.update();dg=bpy.context.evaluated_depsgraph_get()
me=bpy.data.meshes.new_from_object(o.evaluated_get(dg),preserve_all_data_layers=True,depsgraph=dg);ob=bpy.data.objects.new('Probe M',me);s.collection.objects.link(ob);ob.matrix_world=o.matrix_world.copy();o.hide_render=True;o.hide_set(True);bpy.context.view_layer.update()
bm=bmesh.new();bm.from_mesh(me);print('SIGNED_VOLUME',bm.calc_volume(signed=True),flush=True);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(me);bm.free();me.materials[0]=me.materials[0].copy();me.uv_layers.new(name='LightUV');me.uv_layers.active_index=len(me.uv_layers)-1
bpy.ops.object.select_all(action='DESELECT');ob.select_set(True);bpy.context.view_layer.objects.active=ob;bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(island_margin=.02);bpy.ops.object.mode_set(mode='OBJECT')
im=bpy.data.images.new('M irradiance',width=256,height=256,float_buffer=True);im.colorspace_settings.name='Non-Color';n=me.materials[0].node_tree.nodes.new('ShaderNodeTexImage');n.image=im;me.materials[0].node_tree.nodes.active=n
s.render.bake.use_pass_direct=True;s.render.bake.use_pass_indirect=True;s.render.bake.use_pass_color=False;bpy.ops.object.bake(type='DIFFUSE',uv_layer='LightUV');im.filepath_raw=str(P/'work/lighting/m-test.exr');im.file_format='OPEN_EXR';im.save()
me.calc_loop_triangles();a=np.asarray(im.pixels[:]).reshape(256,256,4)
for t in sorted(me.loop_triangles,key=lambda t:t.area,reverse=True)[:6]:
 uv=np.mean([tuple(me.uv_layers[-1].data[i].uv) for i in t.loops],axis=0);print(tuple(t.normal),float((ob.matrix_world@t.center).y) if hasattr(t,'center') else '',uv,a[int(uv[1]*256),int(uv[0]*256),:3],flush=True)
