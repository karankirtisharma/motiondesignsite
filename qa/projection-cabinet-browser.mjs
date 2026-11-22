// Point BASE_URL at the lounge server, or run this standalone against the two bundled folders.
// QA_PLAYWRIGHT_MODULE and CHROME_PATH can select an existing browser installation.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright-core');
const webRoot = fileURLToPath(new URL('../public/', import.meta.url));
const cabinetRoot = process.env.QA_CABINET_ROOT || resolve(webRoot, 'projection-cabinet');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.wav': 'audio/wav', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function staticServer() {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
      assert.ok(url.pathname.startsWith('/projection-cabinet/'));
      const path = resolve(cabinetRoot, decodeURIComponent(url.pathname.slice('/projection-cabinet/'.length)));
      assert.ok(path.startsWith(resolve(cabinetRoot) + sep));
      const file = await readFile(path);
      res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream',
        'content-length': file.length, 'cache-control': 'public, max-age=60' }).end(file);
    } catch { res.writeHead(404).end(); }
  });
}

async function visit(page, id) {
  await page.evaluate(id => { location.hash = 'ui/' + id; }, id);
  try {
    await page.waitForFunction(id => activeRoute === id && document.querySelector('.ui')?.dataset.kind === routes[id].kind, id, { timeout: 12000 });
  } catch (error) {
    throw new Error('Route ' + id + ' did not open; landed on ' + page.url(), { cause: error });
  }
}

async function routeInventory(page) {
  const inventory = await page.evaluate(() => registry.map(r => r.id));
  assert.equal(new Set(inventory).size, 150);
  for (const id of inventory) {
    await visit(page, id);
    const bad = await page.evaluate(async () => {
      const ui = document.querySelector('.ui');
      const section = ui.querySelector(':scope > section:not(.fx-ghost)');
      const images = [...section.querySelectorAll('img')];
      await Promise.all(images.map(i => i.decode().catch(() => {})));
      return [
        ...images.filter(i => !i.naturalWidth).map(i => i.src),
        ...[...section.querySelectorAll('a[href^="#ui/"]')].filter(a => !routes[a.hash.slice(4).split('?')[0]]).map(a => a.hash),
      ];
    });
    assert.deepEqual(bad, [], id);
  }
  return inventory.length;
}

async function burst(page, kind, selector, role) {
  const ids = [0, 1, 2, 3, 0, 1];
  const result = await page.evaluate(async ({ ids, kind, selector, role }) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const events = [];
    // Observe actual GSAP transitions installed by the shipped renderer, including the immediate rendered value.
    const original = gsap.fromTo;
    gsap.fromTo = function (target, from, to, ...rest) {
      const tween = original.call(this, target, from, to, ...rest);
      if (target?.role === role && from.mix === 0 && to.mix === 1) {
        events.push({ url: target.url, from: target.mix, time: performance.now() });
      }
      return tween;
    };
    const steps = [];
    try {
      for (const id of ids) {
        const controls = [...document.querySelector('.ui > section:not(.fx-ghost)').querySelectorAll(selector)];
        const current = controls.findIndex(c => c.classList.contains('on'));
        const target = controls[(current === id ? id + 1 : id) % controls.length];
        const before = events.length;
        const at = performance.now();
        target.click();
        await sleep(120);
        steps.push({ before, after: events.length, elapsed: Math.round(performance.now() - at) });
      }
    } finally { gsap.fromTo = original; }
    return { kind, steps, events };
  }, { ids, kind, selector, role });
  assert.ok(result.steps.every(s => s.after > s.before), JSON.stringify(result));
  assert.ok(result.events.every(e => Math.abs(e.from) < 0.001), JSON.stringify(result));
  return { restarts: result.events.length, longestClickIntervalMs: Math.max(...result.steps.map(s => s.elapsed)) };
}

async function frameSample(page, id) {
  return page.evaluate(async id => {
    const times = [];
    const start = performance.now(), long = [];
    const syncDurations = [], stage = FX.stage, oldSync = stage.sync;
    stage.sync = function (...args) {
      const begin = performance.now();
      try { return oldSync.apply(this, args); }
      finally { syncDurations.push(performance.now() - begin); }
    };
    const observer = new PerformanceObserver(entries => long.push(...entries.getEntries().map(e => e.duration)));
    observer.observe({ type: 'longtask' });
    let prev = await new Promise(requestAnimationFrame);
    location.hash = 'ui/' + id;
    while (performance.now() - start < 1600) {
      const now = await new Promise(requestAnimationFrame);
      times.push(now - prev);
      prev = now;
    }
    observer.disconnect();
    stage.sync = oldSync;
    times.sort((a, b) => a - b);
    const q = p => Math.round(times[Math.min(times.length - 1, Math.floor(times.length * p))] * 10) / 10;
    return { samples: times.length, medianMs: q(.5), p95Ms: q(.95), worstMs: q(1),
      syncCalls: syncDurations.length, syncMs: Math.round(syncDurations.reduce((a, b) => a + b, 0)),
      above50Ms: times.filter(t => t > 50).length, maxLongTaskMs: Math.round(Math.max(...long, 0)) };
  }, id);
}

async function layout(page, width, height) {
  await page.setViewportSize({ width, height });
  const ids = await page.evaluate(() => registry.map(r => r.id));
  for (const id of ids) {
    await visit(page, id);
    const bounds = await page.evaluate(() => {
      const r = document.querySelector('.ui').getBoundingClientRect();
      return { width: innerWidth, height: innerHeight, scroll: document.documentElement.scrollWidth,
        left: r.left, top: r.top + scrollY, right: r.right, bottom: r.bottom + scrollY };
    });
    assert.ok(bounds.scroll <= width + 1 && bounds.left < 1 && bounds.right >= width - 1 &&
      bounds.top < 1 && bounds.bottom >= height - 1, JSON.stringify({ id, bounds }));
  }
  return ids.length;
}

async function materials(page) {
  const signatures = {};
  for (const id of ['index', 'search', 'studio', 'process', 'home', 'film/vanta-launch-film', 'controls']) {
    await visit(page, id);
    // Finish the GSAP choreography, then check the live CSS geometry and optical uniforms. Dust is independent.
    const actors = await page.evaluate(async () => {
      await Promise.all([...document.querySelectorAll('.ui img')].map(i => i.decode().catch(() => {})));
      FX.settle(1 / 30);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      FX.settle(1 / 30);
      return FX.stage.slabs.filter(s => !s.gone).map(s => {
        const g = s.el.getBoundingClientRect(), style = getComputedStyle(s.el);
        const values = [g.x, g.y, g.width, g.height, s.radius, ...s.u.uRect.value.toArray(), ...s.u.uTint.value.toArray()];
        return [s.cfg.role, s.level, s.cfg.framed || false, style.borderTopColor, style.backgroundImage,
          ...values.map(v => Math.round(v * 10) / 10)];
      });
    });
    signatures[id] = [actors.length, createHash('sha256').update(JSON.stringify(actors)).digest('hex').slice(0, 16)];
  }
  return signatures;
}

async function runEdition(browser, base, edition, networkOnly = false) {
  const viewport = edition === 'site' ? { width: 1728, height: 608 } : { width: 1920, height: 1080 };
  const ctx = await browser.newContext({ viewport });
  try {
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
    if (networkOnly) {
      const network = await ctx.newCDPSession(page);
      await network.send('Network.enable');
      await network.send('Network.emulateNetworkConditions', { offline: false, latency: 100,
        downloadThroughput: 10_000_000 / 8, uploadThroughput: 2_000_000 / 8 });
    }
    if (process.env.QA_CPU_SLOWDOWN) {
      const cpu = await ctx.newCDPSession(page);
      await cpu.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.QA_CPU_SLOWDOWN) });
    }
    await page.addInitScript(() => {
      window.qaSounds = [];
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args) {
        qaSounds.push({ duration: this.buffer?.duration, audioState: this.context.state });
        return start.apply(this, args);
      };
    });
    const url = new URL('/projection-cabinet/' + edition + '/index.html', base).href;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.FX?.level === 'full' && FX.stage?.ok &&
      !document.documentElement.classList.contains('fx-boot') &&
      FX.stage.plates.some(p => p.role === 'hero' && p.b?.ready && p.mix > 0));
    const cold = await page.evaluate(() => {
      const gl = FX.stage.r.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
      const three = performance.getEntriesByType('resource').find(e => e.name.endsWith('/three.module.min.js'));
      return { readyMs: Math.round(performance.now()), threeStartMs: Math.round(three.startTime), gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        transferBytes: performance.getEntriesByType('resource').reduce((n, e) => n + e.transferSize, 0) };
    });
    await page.locator('.dockframe').nth(1).click({ force: true });
    await page.waitForFunction(() => document.querySelectorAll('.dockframe')[1]?.getAttribute('aria-pressed') === 'true');
    cold.firstClickConfirmedMs = await page.evaluate(() => Math.round(performance.now()));
    if (networkOnly) {
      console.log(edition, '10 Mbps / 100 ms', JSON.stringify(cold));
      return;
    }
    if (process.argv.includes('--materials')) {
      console.log(edition, 'material signatures', JSON.stringify(await materials(page)));
      return;
    }
    await page.waitForFunction(() => qaSounds.some(s => s.duration > 0 && s.audioState === 'running'));
    console.log(edition, 'cold full FX', JSON.stringify(cold));
    const frames = {};
    for (const id of ['index','search','studio','process']) {
      frames[id] = await frameSample(page, id);
      console.log(edition, id, JSON.stringify(frames[id]));
    }
    if (process.argv.includes('--timing-only')) return;
    await visit(page, 'home');
    await page.waitForFunction(() => FX.stage?.plates.find(p => !p.gone && p.role === 'hero')?.b);
    await page.waitForTimeout(300);
    const dock = await burst(page, 'home', '.dockframe', 'hero');
    await visit(page, 'film/vanta-launch-film');
    await page.waitForFunction(() => FX.stage?.plates.find(p => !p.gone && p.role === 'still')?.b);
    await page.waitForTimeout(300);
    const films = await burst(page, 'film', '.siblingrail a', 'still');
    await visit(page, 'controls');
    await page.locator('[data-pref="motion"]').click({ force: true });
    await page.waitForFunction(() => FX.level === 'reduced');
    await page.locator('[data-pref="motion"]').click({ force: true });
    await page.waitForFunction(() => FX.level === 'full');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => FX.level === 'reduced');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForFunction(() => FX.level === 'full');
    await page.locator('[data-pref="lite"]').click({ force: true });
    await page.waitForFunction(() => FX.level === 'off' && !FX.stage);
    await page.locator('[data-pref="lite"]').click({ force: true });
    await page.waitForFunction(() => FX.level === 'full' && !!FX.stage);
    await visit(page, 'search');
    await page.locator('#filmsearch').fill('vanta');
    await page.waitForFunction(() => document.querySelector('#results .tile.fx-glass') &&
      document.querySelector('#matchcount').textContent.includes('matching'));
    await visit(page, 'index');
    const cell = page.locator('.mcell').nth(12);
    await cell.click({ force: true });
    await page.waitForFunction(() => document.querySelector('#inspectentry a')?.hash === document.querySelector('.mcell.picked')?.hash);
    // The ready-to-download page requires a filled-in brief in normal viewing mode.
    await visit(page, 'brief/format');
    for (const answer of ['Product Launch', 'Automotive', '45 seconds', '4–6 weeks']) {
      await page.getByRole('button', { name: answer, exact: true }).click();
      await page.getByRole('button', { name: 'Continue' }).click();
    }
    await page.locator('#field-name').fill('QA Producer');
    await page.locator('#field-email').fill('qa@example.test');
    // Exercise every hash route with the actual full-motion renderer and decode its artwork.
    const routes = await routeInventory(page);
    assert.equal(await page.evaluate(() => FX.level), 'full');
    const sizes = {};
    if (edition === 'site-web') {
      // Proof mode uses the same responsive CSS, with the motion settled so animated overflow can't bias bounds.
      await page.goto(url + '?proof=1');
      for (const [w, h] of [[1920, 1080], [1280, 1024], [375, 812]]) sizes[w + 'x' + h] = await layout(page, w, h);
    }
    assert.deepEqual(errors, []);
    console.log(edition, 'PASS', JSON.stringify({ routes, dock, films, sound: 'decoded WAV, running context', sizes, errors }));
  } finally { await ctx.close(); }
}

const server = process.env.BASE_URL ? null : staticServer();
if (server) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  try {
    const origin = process.env.BASE_URL || 'http://127.0.0.1:' + server.address().port;
    const networkOnly = process.argv.includes('--network-only');
    for (let round = 0; round < (networkOnly ? 3 : 1); round++) {
      for (const edition of ['site', 'site-web']) await runEdition(browser, origin, edition, networkOnly);
    }
  } finally { await browser.close(); }
} finally { if (server) await new Promise(resolve => server.close(resolve)); }
