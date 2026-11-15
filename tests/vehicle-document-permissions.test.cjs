const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const start = source.indexOf('function driverDocuments()');
const end = source.indexOf('\nfunction driverVehicles()', start);
assert(start >= 0 && end > start, 'driverDocuments function must exist');

const today = new Date();
const isoDay = (offset) => {
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
  return [day.getFullYear(), String(day.getMonth() + 1).padStart(2, '0'), String(day.getDate()).padStart(2, '0')].join('-');
};
const docs = [
  { id: 'own-valid', driverId: 'driver-a', expiryDate: isoDay(1) },
  { id: 'own-expired', driverId: 'driver-a', expiryDate: isoDay(-1) },
  { id: 'own-today', driverId: 'driver-a', expiryDate: isoDay(0) },
  { id: 'assigned', vehicleId: 'vehicle-a', expiryDate: isoDay(1) },
  { id: 'assigned-expired', vehicleId: 'vehicle-a', expiryDate: isoDay(-1) },
  { id: 'unassigned', vehicleId: 'vehicle-b', driverId: 'driver-a', viewerDriverIds: ['driver-a'] },
  { id: 'company-shared', viewerDriverIds: ['driver-a'], expiryDate: null },
  { id: 'other-driver', driverId: 'driver-b' },
  { id: 'no-expiry', driverId: 'driver-a', expiryDate: '' },
];
const ctx = {
  state: { documents: docs },
  currentUser: () => ({ driverId: 'driver-a' }),
  driverVehicles: () => [{ id: 'vehicle-a' }],
  daysUntil: (date) => {
    const d = new Date(date + 'T12:00:00');
    const now = new Date();
    return Math.round((d - new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12)) / 86400000);
  },
};
vm.createContext(ctx);
vm.runInContext(source.slice(start, end), ctx);
const actual = Array.from(ctx.driverDocuments(), d => d.id).sort();
assert.deepEqual(actual, ['assigned', 'company-shared', 'no-expiry', 'own-today', 'own-valid'].sort());
console.log('PASS: driver documents hide expired files, require vehicle assignment, allow valid and no-expiry files.');
