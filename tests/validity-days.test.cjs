const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
process.env.TZ='Europe/Lisbon';
for(const file of ['app.js','teste/app.js']){
 const source=fs.readFileSync(require('node:path').join(__dirname,'..',file),'utf8'),context={Date};vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('function daysUntil('),source.indexOf('\nfunction visibleDocuments(')),context);
 for(const [expiry,now,expected] of [
  ['2026-07-10','2026-07-11T00:30:00+01:00',-1],
  ['2026-07-11','2026-07-11T23:59:00+01:00',0],
  ['2026-07-12','2026-07-11T00:30:00+01:00',1],
  ['2026-03-30','2026-03-29T00:30:00Z',1],
  ['2026-10-26','2026-10-25T00:30:00+01:00',1],
  ['2026-11-05','2026-11-10T12:00:00Z',-5]
 ]) assert.equal(context.daysUntil(expiry,new Date(now)),expected);
 assert(Number.isNaN(context.daysUntil('2026-02-31')));
 assert.equal(context.alertLevel({expiryDate:'2026-02-31'}),'Sem validade');
 console.log(file+': PASS calendar expiry at midnight, summer/winter time, DST transitions and invalid dates.');
}
