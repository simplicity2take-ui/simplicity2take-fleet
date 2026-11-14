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
  ['Expired documents blocked', 'document.expiry_date < today'],
  ['Google Drive service account', 'GOOGLE_SERVICE_ACCOUNT_JSON'],
  ['Private no-store response', '"private, no-store"'],
  ['Internal errors not exposed', 'Erro interno ao consultar o documento.'],
  ['Response filename sanitization', '.slice(0, 180)'],
];
for (const [label, needle] of checks) {
  assert(source.includes(needle), label);
}
assert(!source.includes('error.message\\n          : "Erro interno."'), 'Do not expose internal exception messages');
assert(source.includes('replace(/[\\x00-\\x1f\\x7f"\\\\]/g, "")'), 'Filename header must remove control characters');
console.log('PASS: document access security invariants are present in source.');
