/** Chrome's HTTP cache can reject the 119 MB encoded studio even with immutable headers.
 * One fixed key bounds committed storage to one decoded version across releases and tabs. */
const STORE = 'md-studio-v1';
const KEY = '/__md-studio-cache__/model';
const BLOB_BATCH = 1024 * 1024;
const MAX_MODEL_BYTES = 256 * 1024 * 1024;
let writing = false;

export type ModelCapture = { write(bytes: Uint8Array): void; finish(): void; cancel(): void };

function within<T>(pending: Promise<T>, ms: number, signal: AbortSignal): Promise<T | undefined> {
  return new Promise(resolve => {
    const done = (value?: T) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', stop);
      resolve(value);
    };
    const stop = () => done();
    const timer = setTimeout(stop, ms);
    signal.addEventListener('abort', stop, { once: true });
    pending.then(done, stop);
    if (signal.aborted) stop();
  });
}

export function studioModelCache(sha: string, size: number, signal: AbortSignal) {
  let cache: Cache | undefined;
  async function read(): Promise<ArrayBuffer | undefined> {
    try {
      // A denied, unavailable or slow disk must not hold up the first transfer.
      const hit = await within(caches.open(STORE).then(async store => {
        cache = store;
        return store.match(KEY);
      }), 250, signal);
      if (!hit?.body) return;
      if (hit.headers.get('x-md-studio-sha256') !== sha ||
          Number(hit.headers.get('content-length')) !== size || signal.aborted) {
        void hit.body.cancel().catch(() => {});
        return;
      }
      const worker = new Worker(new URL('./studioModelCache.worker.ts', import.meta.url), { type: 'module' });
      try {
        const body = hit.body;
        const checked = new Promise<ArrayBuffer | undefined>((resolve, reject) => {
          worker.onmessage = event => resolve(event.data instanceof ArrayBuffer && event.data.byteLength === size ? event.data : undefined);
          worker.onerror = () => reject(new Error('Studio cache reader unavailable'));
          worker.postMessage({ body, sha, size }, [body]);
        });
        return await within(checked, 6_000, signal);
      } finally { worker.terminate(); }
    } catch { return undefined; }
  }

  function capture(): ModelCapture | undefined {
    const memory = (globalThis.navigator as Navigator & { deviceMemory?: number } | undefined)?.deviceMemory;
    if (!cache || signal.aborted || writing || size > MAX_MODEL_BYTES || (memory && memory <= 4)) return;
    const disk = cache;
    writing = true;
    let total = 0, batchSize = 0, closed = false;
    let parts: Blob[] = [], batch: Uint8Array<ArrayBuffer>[] = [];
    const flush = () => {
      if (batchSize) parts.push(new Blob(batch));
      batch = []; batchSize = 0;
    };
    const cancel = () => {
      if (closed) return;
      closed = true; writing = false; parts = []; batch = [];
    };
    return {
      write(bytes) {
        if (closed) return;
        total += bytes.byteLength;
        if (total > size || !(bytes.buffer instanceof ArrayBuffer)) { cancel(); return; }
        // Chrome delivered a chunk larger than the 832 kB remaining queue budget on localhost.
        // Make immutable 1 MiB native Blob parts as data arrives. Their backing storage may
        // spill to disk; there is no full-model JS copy when the parser takes its own buffer.
        try {
          for (let offset = 0; offset < bytes.byteLength;) {
            const count = Math.min(BLOB_BATCH - batchSize, bytes.byteLength - offset);
            batch.push(new Uint8Array(bytes.buffer, bytes.byteOffset + offset, count));
            batchSize += count; offset += count;
            if (batchSize === BLOB_BATCH) flush();
          }
        } catch { cancel(); }
      },
      finish() {
        if (closed) return;
        if (total !== size || signal.aborted) { cancel(); return; }
        try {
          flush();
          // A Blob of existing Blobs references their immutable bytes. One atomic disk
          // replacement is independent of download pace and never blocks room entry.
          const body = new Blob(parts, { type: 'model/gltf-binary' });
          const saved = disk.put(KEY, new Response(body, { headers: {
            'content-length': String(size), 'x-md-studio-sha256': sha,
          } }));
          closed = true; parts = [];
          void saved.then(() => { writing = false; }, () => { writing = false; });
        } catch { cancel(); }
      },
      cancel,
    };
  }
  return { read, capture };
}
