const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
(async()=>{
 const store=new Map();let rows=[],calls=[],failAfterStart=false,loadFails=false,selectedUser={id:'u',role:'driver'},counter=0;
 const client={from(){const q={select(){return q},order(){return q},limit(){return q},then(resolve,reject){return (loadFails?Promise.reject(Error('transport failure')):Promise.resolve({data:rows,error:null})).then(resolve,reject)}};return q},rpc:async(name,args)=>{
  calls.push({name,args});
  if(name==='fleet_shift_vehicle')return {data:{id:'v',plate:'AA-00-AA',brand:'<script>','model':'Test'}};
  if(name==='fleet_shift_start'){
   rows=[{id:'s',driver_name:'Synthetic',driver_id:'d',vehicle_id:'v',vehicle_plate:'AA-00-AA',started_at:'2026-11-10T08:00:00Z',ended_at:null}];
   if(failAfterStart)throw Error('lost response');return {data:rows[0]};
  }
  if(name==='fleet_shift_admin_close'){rows[0]={...rows[0],ended_at:'2026-11-10T16:00:00Z',closure_kind:'admin',closure_note:args.p_note};return {data:rows[0]};}
  rows[0]={...rows[0],ended_at:'2026-11-10T16:00:00Z'};return {data:rows[0]};
 }};
 const c={console,URL,Date,Number,JSON,crypto:{randomUUID:()=>String(++counter)},navigator:{onLine:true},sessionStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},window:{location:{origin:'https://fleet.example.test'}}};
 vm.createContext(c);
 for(const path of ['native-shifts.js','native-shift-ui.js'])vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'..',path),'utf8'),c);
 const portal=c.NativeShiftPortal.create({client,getUser:()=>selectedUser,escapeHtml:s=>String(s??'').replaceAll('<','&lt;').replaceAll('>','&gt;'),changed(){}});
 await portal.load();assert.ok(portal.render().includes('Pronto para começar'));
 await portal.lookup('https://evil.example.test/?vehicle='+('a'.repeat(32)));assert.equal(calls.length,0);
 await portal.lookup('a'.repeat(32));assert.ok(portal.render().includes('&lt;script&gt;'));
 await portal.lookup('invalid-qr');assert.ok(!portal.render().includes('Iniciar turno'));assert.ok(!portal.render().includes('AA-00-AA'));
 await portal.lookup('a'.repeat(32));
 loadFails=true;await portal.load();assert.ok(portal.render().includes('Turno por confirmar'));assert.ok(!portal.render().includes('Pronto para começar'));
 const beforeOfflineLoad=calls.length;await portal.submit('start');assert.equal(calls.length,beforeOfflineLoad);
 loadFails=false;await portal.load();
 const a=portal.submit('start'),b=portal.submit('start');await Promise.all([a,b]);
 assert.equal(calls.filter(x=>x.name==='fleet_shift_start').length,1);
 assert.deepEqual(Object.keys(calls.find(x=>x.name==='fleet_shift_start').args).sort(),['p_request_id','p_token']);
 assert.ok(portal.render().includes('Turno em curso'));
 await portal.submit('end');assert.ok(portal.render().includes('Quilómetros Cartrack por confirmar'));
 assert.deepEqual(Object.keys(calls.find(x=>x.name==='fleet_shift_end').args).sort(),['p_request_id','p_shift_id']);
 c.navigator.onLine=false;const n=calls.length;await portal.submit('start');assert.equal(calls.length,n);assert.ok(portal.render().includes('Sem ligação'));
 c.navigator.onLine=true;failAfterStart=true;await portal.submit('start');assert.ok(portal.render().includes('Turno em curso'));assert.equal(rows.length,1);
 const beforeAdmin=calls.length;await portal.adminClose('s','Synthetic explanation');assert.equal(calls.length,beforeAdmin);
 selectedUser={id:'admin',role:'admin'};await portal.load();assert.ok(portal.adminPanel().includes('Encerrar com motivo'));
 await portal.adminClose('s','short');assert.equal(calls.length,beforeAdmin);
 await portal.adminClose('s','Synthetic explanation <script>');
 assert.ok(portal.adminPanel().includes('Encerramento administrativo'));
 assert.ok(portal.adminPanel().includes('&lt;script&gt;'));
 assert.deepEqual(Object.keys(calls.find(x=>x.name==='fleet_shift_admin_close').args).sort(),['p_note','p_request_id','p_shift_id']);
 rows[0]={...rows[0],cartrack_review:{distance:12.5,start:{at:Date.parse('2026-11-10T08:01:00Z'),km:100,gapSeconds:60},end:{at:Date.parse('2026-11-10T15:59:00Z'),km:112.5,gapSeconds:60}}};
 await portal.load();const details=portal.adminPanel();
 assert.ok(details.includes('12.50 km entre leituras Cartrack'));
 assert.ok(details.includes('Leitura inicial: 10/11/2026, 08:01:00'));
 assert.ok(details.includes('Leitura final: 10/11/2026, 15:59:00'));
 assert.ok(details.includes('100 km'));assert.ok(details.includes('112.5 km'));
 rows[0].cartrack_review.distance=NaN;await portal.load();assert.ok(portal.adminPanel().includes('Quilómetros Cartrack por confirmar'));
 portal.clear();selectedUser=null;assert.ok(!portal.render().includes('AA-00-AA'));
 console.log('PASS driver shift UI: safe QR lookup, escaping, duplicate-click prevention, server-only arguments, pending mileage, offline rejection, lost-response recovery and logout clear');
})().catch(e=>{console.error(e);process.exitCode=1});
