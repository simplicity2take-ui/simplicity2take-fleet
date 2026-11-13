const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

for (const entry of ['app.js', 'teste/app.js']) {
  test(entry + ': drivers cannot list expired documents, administrators retain access', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', entry), 'utf8');
    const start = source.indexOf('function driverDocuments()');
    const end = source.indexOf('function showToast(', start);
    assert.ok(start !== -1 && end > start, 'document helpers must exist');
    const today = new Date();
    const iso = offset => new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset).toISOString().slice(0, 10);
    const documents = [
      { id: 'expired', driverId: 'driver1', expiryDate: iso(-2) },
      { id: 'valid', driverId: 'driver1', expiryDate: iso(3) },
      { id: 'no-date', driverId: 'driver1', expiryDate: '' },
      { id: 'other', driverId: 'driver2', expiryDate: iso(3) },
    ];
    const context = {
      state: { documents },
      currentUser: () => ({ driverId: 'driver1', role: 'driver' }),
      Date, Set,
    };
    vm.createContext(context);
    vm.runInContext(source.slice(start, end), context);
    assert.deepEqual(Array.from(context.driverDocuments(), doc => doc.id), ['valid', 'no-date']);
    context.currentUser = () => ({ driverId: 'driver1', role: 'admin' });
    assert.deepEqual(Array.from(context.visibleDocuments(), doc => doc.id), documents.map(doc => doc.id));
  });
}
