import sys, json, hashlib
from pathlib import Path
P=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(P.parents[1]/'work/python-libs'))
import PyOpenColorIO as ocio
import numpy as np
from PIL import Image
config_file=Path('D:/Claude/tools/Blender-5.2/5.2/datafiles/colormanagement/config.ocio')
c=ocio.Config.CreateFromFile(str(config_file));size=64
look=ocio.LookTransform(src='scene_linear',dst='scene_linear',looks='AgX - Medium High Contrast')
view=ocio.DisplayViewTransform(src='scene_linear',display='sRGB',view='AgX')
group=ocio.GroupTransform([look,view]);cpu=c.getProcessor(group).getDefaultCPUProcessor()
y,x=np.mgrid[0:size,0:size*size];a=np.stack([x%size,y,x//size],axis=-1).astype(np.float32)/(size-1)
a=np.ascontiguousarray(2.0**(a*22.0-12.0));cpu.applyRGB(a)
dest=P/'public/lighting';dest.mkdir(exist_ok=True)
Image.fromarray(np.uint8(np.clip(a,0,1)*255+.5)).save(dest/'agx-lut.png')
(dest/'agx.json').write_text(json.dumps({'ocioVersion':ocio.__version__,'configSha256':hashlib.sha256(config_file.read_bytes()).hexdigest(),'view':'AgX','look':'AgX - Medium High Contrast','display':'sRGB','input':'scene-linear Rec.709','log2Range':[-12,10],'size':64,'packing':'red-x, green-y, blue-horizontal-slices','quantization':'8-bit display output; fixture comparison pending'},indent=2))
print('AGX_LUT_COMPLETE', (dest/'agx-lut.png').stat().st_size)
