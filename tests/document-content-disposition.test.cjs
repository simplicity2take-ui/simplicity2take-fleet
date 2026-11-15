const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

const source = fs.readFileSync(path.join(__dirname, '..', 'supabase/functions/document-access/index.ts'), 'utf8');
const start = source.indexOf('function safeInlineContentDisposition(');
const end = source.indexOf('Deno.serve(async (request)', start);
assert(start > 0 && end > start, 'The inline filename helper must be available');

const context = {};
vm.createContext(context);
vm.runInContext(stripTypeScriptTypes(source.slice(start, end)), context);

function disposition(name) {
  const value = context.safeInlineContentDisposition(name);
  const headers = new Headers();
  headers.set('content-disposition', value);
  assert.equal(headers.get('content-disposition'), value, 'Header must be valid for the HTTP response');
  assert(value.startsWith('inline; filename="'));
  assert(value.includes("; filename*=UTF-8''"));
  assert(!/[\r\n]/.test(value), 'No CR/LF injection in HTTP headers');
  return value;
}

test('Portuguese accented filenames preserve UTF-8 while providing an ASCII fallback', () => {
  assert.equal(
    disposition('Carta de Condução.pdf'),
    'inline; filename="Carta de Conducao.pdf"; filename*=UTF-8' +
      "''Carta%20de%20Condu%C3%A7%C3%A3o.pdf"
  );
});

test('non-Latin and emoji filenames produce valid HTTP headers', () => {
  const name = '文件📄-seguro.pdf';
  const value = disposition(name);
  assert(value.includes('filename*=' + "UTF-8''" + encodeURIComponent(name)));
  assert(value.includes('filename="'));
});

test('quotes, backslashes, controls and line breaks cannot inject response headers', () => {
  const value = disposition('seguro"\r\nSet-Cookie: bad\\name.pdf');
  assert(!value.includes('Set-Cookie: bad\\'));
  assert(!value.includes('\r') && !value.includes('\n'));
  assert(value.includes('filename="seguroSet-Cookie: badname.pdf"'));
});

test('unpaired surrogate characters cannot crash URI encoding', () => {
  const value = disposition('seguro\uD800.pdf');
  assert(value.includes("filename*=UTF-8''seguro.pdf"));
});

test('long names are bounded by Unicode code points without splitting emoji', () => {
  const value = disposition('📄'.repeat(200) + '.pdf');
  const encoded = value.split("filename*=UTF-8''")[1];
  const decoded = decodeURIComponent(encoded);
  assert.equal(Array.from(decoded).length, 180);
  assert.equal(decoded, '📄'.repeat(180));
});

test('empty names use a safe fallback', () => {
  assert.equal(disposition(''), 'inline; filename="documento"; filename*=UTF-8' + "''documento");
});

test('reserved RFC 5987 characters are percent encoded in filename*', () => {
  const value = disposition("Ana's (carta)!*.pdf");
  assert(value.includes('Ana%27s%20%28carta%29%21%2A.pdf'));
});
