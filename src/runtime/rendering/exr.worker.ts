import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
// Decode the unchanged half-float data with the same pinned Three.js parser.
self.onmessage = (event: MessageEvent<{ format: 'exr' | 'hdr'; buffer: ArrayBuffer }>) => {
  try {
    const loader = event.data.format === 'hdr' ? new HDRLoader() : new EXRLoader();
    const result = loader.parse(event.data.buffer);
    const pixels = result.data as Uint16Array;
    self.postMessage({ result: { ...result, header: undefined } }, { transfer: [pixels.buffer as ArrayBuffer] });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
