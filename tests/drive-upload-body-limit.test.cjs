const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const url = pathToFileURL(path.join(__dirname, '..', 'supabase/functions/drive-upload/read-bounded-upload.mjs')).href;

const request = (value, headers) => new Request('https://localhost/upload', {
  method: 'POST',
  body: typeof value === 'string' ? value : JSON.stringify(value),
  headers,
});

test('reads a valid document request without a declared length', async () => {
  const { readBoundedUploadJson } = await import(url);
  const input = { fileName: 'inspecao.pdf', mimeType: 'application/pdf', base64: 'JVBERi0=' };
  assert.deepEqual(await readBoundedUploadJson(request(input)), input);
});

test('accepts a request exactly at the byte limit', async () => {
  const { readBoundedUploadJson } = await import(url);
  assert.deepEqual(await readBoundedUploadJson(request('{}'), 2), {});
});

test('rejects an oversized declared Content-Length before reading a body', async () => {
  const { readBoundedUploadJson, UploadRequestTooLargeError } = await import(url);
  await assert.rejects(readBoundedUploadJson(request('{}', { 'content-length': '1000' }), 10), UploadRequestTooLargeError);
});

test('rejects a chunked body over the byte limit despite no Content-Length', async () => {
  const { readBoundedUploadJson, UploadRequestTooLargeError } = await import(url);
  let canceled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"a":'));
      controller.enqueue(new TextEncoder().encode('"abcdefghijk"}'));
    },
    cancel() { canceled = true; },
  });
  const chunked = new Request('https://localhost/upload', { method: 'POST', body: stream, duplex: 'half' });
  await assert.rejects(readBoundedUploadJson(chunked, 10), UploadRequestTooLargeError);
  assert.equal(canceled, true);
});

test('rejects malformed JSON and empty bodies', async () => {
  const { readBoundedUploadJson } = await import(url);
  await assert.rejects(readBoundedUploadJson(request('{broken json')), SyntaxError);
  await assert.rejects(readBoundedUploadJson(new Request('https://localhost/upload', { method: 'POST' })), SyntaxError);
});

test('enforces UTF-8 decoding rather than replacing malformed bytes', async () => {
  const { readBoundedUploadJson } = await import(url);
  const req = new Request('https://localhost/upload', { method: 'POST', body: new Uint8Array([0x7b, 0xff, 0x7d]) });
  await assert.rejects(readBoundedUploadJson(req), TypeError);
});
