const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
for(const file of ['app.js','teste/app.js']){
 const s=fs.readFileSync(file,'utf8'),c={Number};vm.createContext(c);vm.runInContext(s.slice(s.indexOf('function cartrackCurrentStateLabel('),s.indexOf('function cartrackTimestampIsStale(')),c);
 const label=c.cartrackCurrentStateLabel;
 assert.equal(label({ignition:false,speedKmh:0}),'Ignição desligada');
 assert.equal(label({ignition:true,speedKmh:0}),'Ignição ligada');
 assert.equal(label({ignition:true,idling:true,speedKmh:0}),'Ignição ligada · Parada');
 assert.equal(label({ignition:true,speedKmh:30}),'Ignição ligada · Em movimento');
 assert.equal(label({ignition:false,speedKmh:30}),'Ignição desligada · Em movimento');
 assert.equal(label({ignition:null,idling:true,speedKmh:0}),'Sem dados de ignição');
 assert.equal(label({speedKmh:30}),'Sem dados de ignição · Em movimento');
 assert.equal(label({speedKmh:'bad'}),'Sem dados de ignição');assert.equal(label(null),'Sem dados de ignição');
 console.log(file+': PASS explicit ignition off/on/unknown, idling and movement without inferring missing ignition state.');
}
