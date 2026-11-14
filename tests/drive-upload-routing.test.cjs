const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, '..', 'supabase/functions/drive-upload/index.ts'), 'utf8');
assert(source.includes('drivers: "Motoristas"'), 'Driver uploads must use Motoristas');
assert(source.includes('vehicles: "Veículos"'), 'Vehicle uploads must use Veículos');
assert(source.includes('documents: "Empresa"'), 'Company uploads must use Empresa');
assert(source.includes('if (!topFolderName)'), 'Unknown folder types must be rejected');
assert(!source.includes('folderType === "drivers" ? "Motoristas" : "Veículos"'), 'No company-to-vehicle fallback');
console.log('PASS: Google Drive upload destinations are explicit and unknown types rejected.');
