const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, '..', 'supabase/functions/document-access/index.ts'), 'utf8');
const checks = [
  ['POST-only access', 'request.method !== "POST"'],
  ['Malformed JSON rejected', 'Pedido JSON inválido.'],
  ['Document identifier validated', 'document_id inválido.'],
  ['User session checked', 'supabase.auth.getUser()'],
  ['Document fetched under user RLS', '.from("documents")'],
  ['Vehicle assignment enforced', 'if (!assigned)'],
  ['Driver ownership enforced', 'document.driver_id !== driver.id'],
  ['Company document viewer grants checked', '.from("document_viewers")'],
  ['Viewer grant must be active', '.eq("can_view", true)'],
  ['Expired documents blocked', 'document.expiry_date < today'],
  ['Google Drive service account', 'GOOGLE_SERVICE_ACCOUNT_JSON'],
  ['Private no-store response', '"private, no-store"'],
  ['Only supported document MIME types', 'const allowedMimeTypes = ["application/pdf", "image/jpeg", "image/png"]'],
  ['Unknown content uses safe binary MIME', '"application/octet-stream"'],
  ['Browser content sniffing disabled', '"x-content-type-options", "nosniff"'],
  ['Verify PDF signature', 'const isPdf = bytes.length'],
  ['Verify JPEG signature', 'const isJpeg = bytes.length'],
  ['Verify PNG signature', 'const isPng = bytes.length'],
  ['Downgrade mismatched file MIME', 'const verifiedType ='],
  ['Reject mismatched document bytes', 'Formato do documento não corresponde ao ficheiro.'],
  ['Do not allow download fallback', 'if (verifiedType === "application/octet-stream")'],
  ['Document size cap', 'const maxDocumentBytes = 12 * 1024 * 1024'],
  ['Reject oversized content length', 'declaredLength > maxDocumentBytes'],
  ['Reject oversized actual response', 'totalBytes > maxDocumentBytes'],
  ['Read Drive content incrementally', 'driveResponse.body.getReader()'],
  ['Cancel oversized Drive transfers', 'await reader.cancel()'],
  ['Assemble bounded content', 'new Uint8Array(totalBytes)'],
  ['Internal errors not exposed', 'Erro interno ao consultar o documento.'],
  ['Response filename sanitization', '.slice(0, 180)'],
];
for (const [label, needle] of checks) {
  assert(source.includes(needle), label);
}
assert(!source.includes('error.message\\n          : "Erro interno."'), 'Do not expose internal exception messages');
assert(source.includes('replace(/[\\x00-\\x1f\\x7f"\\\\]/g, "")'), 'Filename header must remove control characters');
console.log('PASS: document access security invariants are present in source.');
