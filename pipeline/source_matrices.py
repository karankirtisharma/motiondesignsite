import bpy,json
from pathlib import Path
p=Path(__file__).resolve().parents[1]
(p/'work/source-object-matrices.json').write_text(json.dumps({o.name:[list(row) for row in o.matrix_world] for o in bpy.data.objects}),encoding='utf-8')
