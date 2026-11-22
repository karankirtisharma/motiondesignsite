// Exercise the same native iframe, homography, pointer routing and readiness
// bridge that the lounge uses, without starting a second 3D world.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright-core');
const fixture = `<!doctype html><meta charset="utf-8"><style>*{margin:0}#viewport{position:fixed;inset:0;pointer-events:none}canvas{width:100%;height:100%;pointer-events:auto}</style>
<script type="importmap">{"imports":{"three":"/__three/three.module.js"}}</script>
<div id="viewport"><canvas tabindex="0"></canvas></div>
<script type="module">
import {createLiveStudioSurface} from '/__host/LiveStudioSurface.ts';
const canvas = document.querySelector('canvas');
const layout = open => dispatchEvent(new CustomEvent('md-studio:layout',{detail:{open,reducedMotion:true}}));
window.tv = createLiveStudioSurface({canvas,sampleSurface:(x,y)=>({u:x/1728,v:1-y/608}),
  onExpand:()=>layout(true), onFocus:()=>{}, onAperture:live=>document.body.dataset.aperture=String(live)});
window.inView = () => tv.update(true,[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
window.layout = layout;
inView();
</script>`;
const types = { '.html':'text/html','.js':'text/javascript','.ts':'text/javascript','.css':'text/css','.wav':'audio/wav','.woff2':'font/woff2','.webp':'image/webp' };
const server = createServer(async (request, response) => {
  try {
    const name = decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    let bytes;
    if (name === '/') { response.setHeader('Content-Type','text/html'); bytes=fixture; }
    else if (name === '/favicon.ico') { response.writeHead(204).end(); return; }
    else {
      const host = name.startsWith('/__host/'), three = name.startsWith('/__three/');
      const base = path.join(root,host ? 'src/runtime/presentation' : three ? 'node_modules/three/build' : 'public');
      const file = path.resolve(base,host || three ? path.basename(name) : '.' + name);
      assert.ok(file.startsWith(base + path.sep));
      bytes = await readFile(file);
      if (host) bytes=stripTypeScriptTypes(bytes.toString());
      response.setHeader('Content-Type',types[path.extname(file)] || 'application/octet-stream');
    }
    response.end(bytes);
  } catch { response.writeHead(404).end(); }
});
let browser;
try {
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  browser = await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1728,height:608},deviceScaleFactor:1});
  const cabinetRequests=[],errors=[];
  page.on('request',r=>{if(r.url().includes('/projection-cabinet/'))cabinetRequests.push(r.url());});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.waitForFunction(()=>window.tv);
  assert.equal(cabinetRequests.length,0,'walk-by must not fetch cabinet assets');
  const started = Date.now();
  await page.evaluate(()=>tv.prepare());
  const host=page.locator('[data-live-studio]');
  await page.locator('[data-studio-state="live"]').waitFor({state:'attached',timeout:35000});
  const ready=Date.now()-started;
  assert.equal(await host.isVisible(),false,'poster remains visible before sitting');
  await page.evaluate(()=>{tv.setInteractive(true);tv.setEngaged(true);inView();});
  await host.waitFor();
  const frame=page.frames().find(f=>f.url().includes('/projection-cabinet/site/index.html'));
  assert.ok(frame);
  await frame.waitForFunction(()=>window.FX?.level==='full' && !!window.FX.stage);
  await frame.locator('.launchimage img').evaluate(image=>image.decode());
  if (process.argv.includes('--poster')) {
    await frame.evaluate(()=>document.fonts.ready);
    // Let the actual arrival motion settle. Keep the glass and materials enabled.
    await page.waitForTimeout(2400);
    const bytes = await page.screenshot({type:'png'});
    const target=path.join(root,'public/screen-previews/presentation-cabinet-v1.webp');
    await sharp(bytes).webp({quality:88}).toFile(target);
  }
  const button=frame.locator('.dockframe').nth(1);
  const pos=await button.boundingBox();
  await page.mouse.move(pos.x+pos.width/2,pos.y+pos.height/2);
  await button.click();
  assert.equal(await button.getAttribute('aria-pressed'),'true');
  await page.setViewportSize({width:1280,height:960});
  await page.evaluate(()=>new Promise(done=>{
    addEventListener('md-studio:layout-complete',done,{once:true});
    layout(true);
  }));
  const box=await host.boundingBox();
  assert.ok(Math.abs(box.width/box.height-1728/608)<.001);
  assert.ok(Math.abs(box.y-(960-box.height)/2)<1);
  assert.deepEqual(await page.locator('[data-cabinet-backdrop]').boundingBox(),{x:0,y:0,width:1280,height:960});
  assert.equal(await frame.locator('.dockframe.on').getAttribute('aria-label'),await button.getAttribute('aria-label'));
  await page.evaluate(()=>layout(false));
  await page.waitForFunction(()=>document.body.dataset.aperture==='true');
  await page.evaluate(()=>tv.setEngaged(false));
  await host.waitFor({state:'hidden'});
  await frame.waitForTimeout(120);
  const hiddenCount=await frame.evaluate(()=>FX.stage.r.info.render.frame);
  await frame.waitForTimeout(350);
  const hiddenDraws=(await frame.evaluate(()=>FX.stage.r.info.render.frame))-hiddenCount;
  assert.equal(hiddenDraws,0,'hidden display must yield its GPU time to the lounge');
  await page.evaluate(()=>tv.setEngaged(true));
  await frame.waitForFunction(count=>FX.stage.r.info.render.frame>count,hiddenCount);
  assert.equal((await host.getAttribute('data-studio-attempt')),'1');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({idleCabinetRequests:0,preparedMs:ready,iframeLoads:1,fx:'full',nativeDockClick:true,expandReturnPreservesSelection:true,expanded1280x960:box,hiddenDrawsIn350Ms:hiddenDraws,pageErrors:errors}));
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(done=>server.close(done));
}
