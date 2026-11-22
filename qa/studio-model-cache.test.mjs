import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { studioModelCache } from '../src/runtime/rendering/studioModelCache.ts';
import { checkedStudioBytes } from '../src/runtime/rendering/studioModelCache.worker.ts';
import { fetchAssetBuffer } from '../src/runtime/rendering/fetchAsset.ts';

const signal = () => new AbortController().signal;
const bytes = new Uint8Array([0x67, 0x6c, 0x54, 0x46]);
const sha = createHash('sha256').update(bytes).digest('hex');
const key = '/__md-studio-cache__/model';

function globals(t, values) {
  for (const [name, value] of Object.entries(values)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    t.after(() => { if (previous) Object.defineProperty(globalThis, name, previous); else delete globalThis[name]; });
  }
}

function disk(t) {
  const entries = new Map(), writes = [];
  const store = {
    match: async key => entries.get(key)?.clone(),
    put(key, response) {
      const write = response.arrayBuffer().then(buffer => {
        entries.set(key, new Response(buffer, { headers: response.headers }));
      });
      writes.push(write);
      return write;
    },
  };
  class Reader {
    postMessage({ body, sha, size }) {
      checkedStudioBytes(body, sha, size).then(data => this.onmessage({ data }), this.onerror);
    }
    terminate() {}
  }
  globals(t, { caches: { open: async name => { assert.equal(name, 'md-studio-v1'); return store; } }, Worker: Reader });
  return { entries, writes };
}

test('full transfer remains usable if detached; verified disk hit reuses the same bytes', async t => {
  const { entries, writes } = disk(t);
  const transfer = studioModelCache(sha, bytes.length, signal());
  assert.equal(await transfer.read(), undefined);
  t.mock.method(globalThis, 'fetch', async () => new Response(bytes));
  const first = await fetchAssetBuffer('/studio', { expectedBytes: bytes.length, captureFullBody: transfer.capture });
  structuredClone(first, { transfer: [first] });
  assert.equal(first.byteLength, 0);
  await Promise.all(writes);
  assert.deepEqual([...entries.keys()], [key]);
  const warm = await studioModelCache(sha, bytes.length, signal()).read();
  assert.deepEqual(new Uint8Array(warm), bytes);
});

test('equal-length corruption, a changed digest or wrong length never reach the GLB parser', async t => {
  const { entries, writes } = disk(t);
  const headers = { 'x-md-studio-sha256': sha, 'content-length': String(bytes.length) };
  entries.set(key, new Response(new Uint8Array([0, 0, 0, 0]), { headers }));
  assert.equal(await studioModelCache(sha, bytes.length, signal()).read(), undefined);
  entries.set(key, new Response(bytes, { headers }));
  assert.equal(await studioModelCache(sha, bytes.length + 1, signal()).read(), undefined);
  const newer = new Uint8Array([9, 8, 7, 6]);
  const next = studioModelCache(createHash('sha256').update(newer).digest('hex'), newer.length, signal());
  assert.equal(await next.read(), undefined);
  const write = next.capture();
  write.write(newer);
  write.finish();
  await Promise.all(writes);
  assert.deepEqual([...entries.keys()], [key]);
  assert.deepEqual(new Uint8Array(await next.read()), newer);
});

test('short, oversized or cancelled writes cannot replace the last complete version', async t => {
  const { entries, writes } = disk(t);
  entries.set(key, new Response(bytes, { headers: { 'x-md-studio-sha256': sha, 'content-length': '4' } }));
  for (const count of [2, 6, 4]) {
    const expected = 4;
    const transfer = studioModelCache('future', expected, signal());
    await transfer.read();
    const capture = transfer.capture();
    capture.write(new Uint8Array(count));
    if (count === expected && count === 4) capture.cancel(); else capture.finish();
  }
  assert.equal(writes.length, 0);
  assert.deepEqual(new Uint8Array(await entries.get(key).arrayBuffer()), bytes);
});

test('a burst larger than the former 16 MiB queue is saved atomically and survives transfer', async t => {
  const { entries, writes } = disk(t);
  const burst = new Uint8Array(18 * 1024 * 1024 + 1).fill(42);
  const digest = createHash('sha256').update(burst).digest('hex');
  const transfer = studioModelCache(digest, burst.length, signal());
  await transfer.read();
  const write = transfer.capture();
  assert.equal(transfer.capture(), undefined, 'only one studio may be staged per page');
  write.write(burst);
  assert.equal(entries.size, 0);
  write.finish();
  structuredClone(burst.buffer, { transfer: [burst.buffer] });
  await Promise.all(writes);
  const verified = await transfer.read();
  assert.equal(verified.byteLength, 18 * 1024 * 1024 + 1);
});

test('known low-memory devices and models beyond the staging budget take the original network path', async t => {
  const { writes } = disk(t);
  const memory = { deviceMemory: 4 };
  globals(t, { navigator: memory });
  const lowMemory = studioModelCache(sha, bytes.length, signal());
  await lowMemory.read();
  assert.equal(lowMemory.capture(), undefined);
  memory.deviceMemory = 8;
  const oversized = studioModelCache(sha, 256 * 1024 * 1024 + 1, signal());
  await oversized.read();
  assert.equal(oversized.capture(), undefined);
  assert.equal(writes.length, 0);
});

test('storage denial, a stalled lookup and a caller abort fail open promptly', async t => {
  let open = () => Promise.reject(new Error('denied'));
  globals(t, { caches: { open: () => open() } });
  const denied = studioModelCache(sha, bytes.length, signal());
  assert.equal(await denied.read(), undefined);
  assert.equal(denied.capture(), undefined);
  open = () => new Promise(() => {});
  const started = performance.now();
  assert.equal(await studioModelCache(sha, bytes.length, signal()).read(), undefined);
  assert.ok(performance.now() - started < 1500);
  const controller = new AbortController();
  const loading = studioModelCache(sha, bytes.length, controller.signal).read();
  controller.abort();
  assert.equal(await loading, undefined);
});

test('a failed optional storage write cannot affect the network result', async t => {
  globals(t, { caches: { open: async () => ({
    match: async () => undefined, put: async () => { throw Error('quota'); },
  }) } });
  const transfer = studioModelCache(sha, bytes.length, signal());
  await transfer.read();
  t.mock.method(globalThis, 'fetch', async () => new Response(bytes));
  const result = await fetchAssetBuffer('/studio', { expectedBytes: bytes.length, captureFullBody: transfer.capture });
  assert.deepEqual(new Uint8Array(result), bytes);
});

test('a truncated full body and its resumed suffix never become a cache entry', async t => {
  const { entries, writes } = disk(t);
  const controller = new AbortController();
  const transfer = studioModelCache(sha, bytes.length, controller.signal);
  await transfer.read();
  const ranges = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    ranges.push(init.headers.get('range'));
    return ranges.length === 1 ? new Response(bytes.slice(0, 2)) :
      new Response(bytes.slice(2), { status: 206, headers: { 'content-range': 'bytes 2-3/4' } });
  });
  const result = await fetchAssetBuffer('/studio', { signal: controller.signal, expectedBytes: 4, retryUrl: '/studio-raw',
    retryDelayMs: 0, resumeSHA256: sha, captureFullBody: transfer.capture });
  assert.deepEqual(new Uint8Array(result), bytes);
  assert.deepEqual(ranges, [null, 'bytes=2-']);
  assert.equal(writes.length, 0);
  assert.equal(entries.size, 0);
});

test('aborting an active transfer discards the uncommitted cache stream', async t => {
  const { entries, writes } = disk(t);
  const controller = new AbortController();
  const transfer = studioModelCache(sha, bytes.length, controller.signal);
  await transfer.read();
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(out) { out.enqueue(bytes.slice(0, 2)); },
  })));
  await assert.rejects(fetchAssetBuffer('/studio', { signal: controller.signal, expectedBytes: 4,
    onProgress: () => controller.abort(), captureFullBody: transfer.capture }), { name: 'AbortError' });
  assert.equal(writes.length, 0);
  assert.equal(entries.size, 0);
});
