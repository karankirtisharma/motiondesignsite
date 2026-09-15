"""Import the user-selected local reference's material maps and dusk environment.
Geometry and source master remain unchanged. All output stays in this project.
"""
import json, struct, hashlib, math
from pathlib import Path
import numpy as np
from PIL import Image

P=Path(__file__).resolve().parents[1]
REF=Path('D:/Claude/Motion Design Site/web')
OUT=P/'public/look'; OUT.mkdir(exist_ok=True)
materials={}
for path in (REF/'public/assets/rooms').glob('*.glb'):
    b=path.read_bytes();n=struct.unpack_from('<I',b,12)[0];g=json.loads(b[20:20+n]);blob=b[28+n:]
    def tex(info):
        if not info:return None
        t=g['textures'][info['index']];i=t.get('source',t.get('extensions',{}).get('EXT_texture_webp',{}).get('source'))
        im=g['images'][i];v=g['bufferViews'][im['bufferView']];data=blob[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']]
        name=hashlib.sha256(data).hexdigest()[:16]+'.webp';(OUT/name).write_bytes(data)
        return {'uri':'/look/'+name,'uv':info.get('texCoord',0),'scale':info.get('scale',1)}
    for m in g.get('materials',[]):
        if m['name'] in materials:continue
        pbr=m.get('pbrMetallicRoughness',{})
        if not pbr.get('baseColorTexture'):continue
        materials[m['name']]={'color':pbr.get('baseColorFactor',[1,1,1,1]),'metallic':pbr.get('metallicFactor',1),'roughness':pbr.get('roughnessFactor',1),'albedo':tex(pbr.get('baseColorTexture')),'normal':tex(m.get('normalTexture')),'surface':tex(pbr.get('metallicRoughnessTexture'))}
(OUT/'materials.json').write_text(json.dumps(materials,indent=2),encoding='utf-8')

# Use the current master's visible emitters with the reference's fixed light-pool method.
evidence=Path('C:/Users/karan_z7alww2/Documents/Codex/2026-09-12/front-exterior-x20-x20-motion-gallery/work/web_spec_evidence/objects.json')
lights=[{'name':r['name'],'position':[r['location'][0],r['location'][2],-r['location'][1]],'color':r['color'],'energy':r['energy'],'size':max(r.get('size',1),r.get('size_y',1))} for r in json.loads(evidence.read_text()) if r['type']=='LIGHT' and r.get('light_type')!='SUN' and r['render_scenes'] and not r['hide_render'] and r['energy']*.07>=.4]
(OUT/'lights.json').write_text(json.dumps(lights,indent=2),encoding='utf-8')

def smooth(a,b,x):
    t=np.clip((x-a)/(b-a),0,1);return t*t*(3-2*t)
def hdr(path,rgb):
    # Standard Radiance RGBE, uncompressed scanlines (accepted by Babylon HDRTools).
    v=np.max(rgb,axis=2);m,e=np.frexp(v);scale=np.where(v>1e-32,m*256/np.maximum(v,1e-32),0)
    out=np.zeros((*v.shape,4),np.uint8);out[:,:,:3]=np.clip(rgb*scale[:,:,None],0,255).astype(np.uint8);out[:,:,3]=np.where(v>1e-32,e+128,0)
    path.write_bytes(f'#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y {rgb.shape[0]} +X {rgb.shape[1]}\n'.encode()+out.tobytes())
w,h=2048,1024
lon=(np.arange(w)+.5)/w*2*np.pi-np.pi;lat=(np.arange(h)+.5)/h*np.pi
x=np.sin(lat)[:,None]*np.cos(lon)[None,:];y=np.broadcast_to(np.cos(lat)[:,None],(h,w));z=np.sin(lat)[:,None]*np.sin(lon)[None,:]
t=smooth(-.04,.55,y)**.62
zen=np.array([.010,.016,.040]);horizon=np.array([.150,.095,.070]);ground=np.array([.012,.012,.014])
sky=horizon[None,None,:]*(1-t[:,:,None])+zen[None,None,:]*t[:,:,None]
az=np.maximum((-.35*x-.94*z)/np.maximum(np.sqrt(x*x+z*z),1e-5),0)
sky+=np.array([.62,.30,.10])*((az**2.6)*np.exp(-np.maximum(y,0)*7))[:,:,None]
angle=np.arctan2(z,x);ridge=.032+.020*np.sin(angle*3+1.7)+.013*np.sin(angle*7.3+.4)+.007*np.sin(angle*13.1+2.2)+.0035*np.sin(angle*29+.9)+.0018*np.sin(angle*61)
m=1-smooth(ridge-.003,ridge+.003,y);s=smooth(ridge-.10,ridge,y)
mountain=(ground*(2.2*(1-s[:,:,None])+.8*s[:,:,None]))*.38+horizon*.75*.62
sky=sky*(1-m[:,:,None])+mountain*m[:,:,None];below=smooth(-.005,-.06,y)
sky=sky*(1-below[:,:,None])+ground*below[:,:,None]
hdr(OUT/'dusk.hdr',sky)
t=smooth(.05,.75,y)[:,:,None]
room=np.array([.068,.054,.042])*(1-t)+np.array([.115,.086,.060])*t
t=smooth(-.05,-.65,y)[:,:,None];room=room*(1-t)+np.array([.020,.016,.013])*t
room+=np.array([.52,.30,.13])*np.exp(-((y-.34)/.075)**2)[:,:,None]
hdr(OUT/'interior.hdr',room)
# Gentle waves for the water's reflected normal, generated from a continuous height field.
a=np.arange(256)/256*2*np.pi;xx,yy=np.meshgrid(a,a)
dx=.045*np.cos(xx*3+yy*2)+.025*np.cos(xx*7-yy*3)
dy=.030*np.cos(xx*3+yy*2)-.015*np.cos(xx*7-yy*3)
normal=np.stack([dx,dy,np.ones_like(dx)],axis=-1);normal/=np.linalg.norm(normal,axis=-1,keepdims=True)
Image.fromarray(((normal*.5+.5)*255).astype(np.uint8)).save(OUT/'water-normal.png')
(P/'pipeline/reference-look.json').write_text(json.dumps({'reference':str(REF),'technique':['procedural dusk sky','warm indoor reflection environment','fixed fading light pool','separate material detail maps','planar water reflection'],'materialCount':len(materials),'visibleLightCount':len(lights),'geometry':'Current frozen master, unchanged'},indent=2),encoding='utf-8')
print('REFERENCE_LOOK_READY',len(materials),len(lights))
