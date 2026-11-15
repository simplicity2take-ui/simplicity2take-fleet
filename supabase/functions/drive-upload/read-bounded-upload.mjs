// Shared by the Supabase Edge Function and the Node regression tests.
// A declared Content-Length alone cannot protect against streaming/chunked uploads.
export const MAX_UPLOAD_REQUEST_BYTES = 14_000_000;

export class UploadRequestTooLargeError extends Error {
  constructor() {
    super('Upload request exceeds the allowed size');
    this.name = 'UploadRequestTooLargeError';
  }
}

export async function readBoundedUploadJson(request, maxBytes = MAX_UPLOAD_REQUEST_BYTES) {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null && /^\d+$/.test(declaredLength) && Number(declaredLength) > maxBytes) {
    throw new UploadRequestTooLargeError();
  }

  if (!request.body) throw new SyntaxError('Missing request body');
  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        // Stop consuming the request as soon as it exceeds the hard byte limit.
        try { await reader.cancel(); } catch { /* No need to expose transport errors. */ }
        throw new UploadRequestTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
