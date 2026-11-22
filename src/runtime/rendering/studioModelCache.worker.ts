/** A disk hit is untrusted. Materialize and hash 186 MB off the UI thread, then
 * transfer the verified buffer directly to the existing parser. */
export async function checkedStudioBytes(body: ReadableStream<Uint8Array>, sha: string, size: number) {
  const bytes = await new Response(body).arrayBuffer();
  if (bytes.byteLength !== size) return;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  if (Array.from(digest, b => b.toString(16).padStart(2, '0')).join('') === sha) return bytes;
}

type StudioRead = { body: ReadableStream<Uint8Array>; sha: string; size: number };
if (typeof self !== 'undefined') self.onmessage = async ({ data }: MessageEvent<StudioRead>) => {
  const bytes = await checkedStudioBytes(data.body, data.sha, data.size).catch(() => undefined);
  self.postMessage(bytes, { transfer: bytes ? [bytes] : [] });
};
