"""Conservative body clearance against source furniture bounds along the authored route."""
import json,math,re
from pathlib import Path
P=Path(__file__).resolve().parents[1]
E=Path('C:/Users/karan_z7alww2/Documents/Codex/2026-09-12/front-exterior-x20-x20-motion-gallery/work/web_spec_evidence/objects.json')
rows=json.loads(E.read_text());route=json.loads((P/'work/rail-samples.json').read_text())
objects=[r for r in rows if r['type']=='MESH' and r.get('bounds') and r['render_scenes'] and not r['hide_render'] and re.search('DESK|SOFA|CHAIR|PLANTER|TABLE|CABINET|COUNTER|PEDESTAL|WORKBENCH',r['name'],re.I)]
failures=[];samples=0
for i,(a,b) in enumerate(zip(route,route[1:])):
 a,b=a['position'],b['position'];count=max(1,math.ceil(math.dist(a,b)/.05))
 for j in range(count+1):
  p=[x+(y-x)*j/count for x,y in zip(a,b)];samples+=1
  if p[1]<0:continue
  for r in objects:
   lo,hi=r['bounds']
   if hi[2]<p[2]-1.5 or lo[2]>p[2]+.2:continue
   if all(lo[k]-.245<p[k]<hi[k]+.245 for k in [0,1]):
    if not any(f['segment']==i and f['object']==r['name'] for f in failures):failures.append({'segment':i,'object':r['name'],'point':p,'bounds':r['bounds']})
report={'sampleSpacingMetres':.05,'bodyRadiusMetres':.245,'samples':samples,'objects':len(objects),'failures':failures,'failureCount':len(failures),'scope':'Conservative axis-aligned furniture bounds along the floor-to-eye body; complements architectural surface checks.'}
(P/'pipeline/furniture-clearance.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report,indent=2))
