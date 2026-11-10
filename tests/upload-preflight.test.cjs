const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
(async()=>{for(const file of ['app.js','teste/app.js']){
 const s=fs.readFileSync(path.join(__dirname,'..',file),'utf8');let chosen,reads=0;
 const c={state:{documents:[],documentContext:'vehicle',smartPreview:{vehicleId:'stale',driverId:'stale'}},selectors:{modalFields:{querySelector:()=>({files:chosen?[chosen]:[]})}},fileToBase64:async()=>{reads++;throw Error('Reached file read')}};
 vm.createContext(c);
 vm.runInContext(s.slice(s.indexOf('function validateDocumentFile('),s.indexOf('\nlet documentAnalysisRun')),c);
 vm.runInContext(s.slice(s.indexOf('async function saveDocument('),s.indexOf('\nfunction fileToBase64(')),c);
 for(const type of ['application/pdf','image/jpeg','image/png'])c.validateDocumentFile({type,size:10*1024*1024});
 for(const bad of [{type:'image/jpeg',size:0},{type:'image/jpeg',size:10*1024*1024+1},{type:'image/heic',size:100}]){
  chosen=bad;await assert.rejects(c.saveDocument({vehicleId:'vehicle'},[],''));assert.equal(reads,0);
 }
 chosen={type:'image/jpeg',size:100};await assert.rejects(c.saveDocument({},[],''),/Selecione a viatura/);assert.equal(reads,0);
 c.state.documentContext='driver';await assert.rejects(c.saveDocument({},[],''),/Selecione o motorista/);assert.equal(reads,0);
 c.state.documentContext='vehicle';await assert.rejects(c.saveDocument({vehicleId:'vehicle'},[],''),/Reached file read/);assert.equal(reads,1);
 console.log(file+': PASS file format/size/empty checks and required association before file read or upload; stale suggestions ignored.');
}})().catch(e=>{console.error(e);process.exitCode=1});
