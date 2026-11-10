const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
(async()=>{for(const file of ['app.js','teste/app.js']){
 const s=fs.readFileSync(path.join(__dirname,'..',file),'utf8');let inserted=[];
 const doc={id:'company-doc',name:'Seguro empresa',type:'Seguro da Empresa',viewerDriverIds:['driver2'],driveFileId:'file',fileName:'seguro.pdf',fileType:'application/pdf'};
 const context={state:{documents:[doc],drivers:[{id:'driver1',name:'Um'},{id:'driver2',name:'Dois'}],documentContext:'company',sessionUserId:'admin'},selectors:{modalFields:{querySelector:()=>({files:[]})}},documentBlobCache:new Map(),showToast:()=>{},escapeHtml:x=>String(x||''),field:()=>'',selectField:()=>''};
 context.supabaseClient={from(table){if(table==='documents')return {update(payload){assert.equal(payload.driver_id,context.state.documentContext==='driver'?'driver1':null);assert.equal(payload.vehicle_id,null);return {eq:()=>({select:()=>({single:async()=>({data:{id:doc.id}})})})}}};return {delete:()=>({eq:async()=>({error:null})}),insert:async rows=>{inserted=rows;return {error:null}}};}};
 context.validateDocumentFile=()=>{};vm.createContext(context);
 for(const [a,b] of [['function modalFields(','\nfunction field('],['function checkList(','\nfunction smartDateFromFilename('],['async function saveDocument(','\nfunction fileToBase64(']])vm.runInContext(s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a))),context);
 const html=context.modalFields('document',doc.id);assert(html.includes('name="viewerDriverIds" value="driver2" checked'));assert(!html.includes('name="viewerDriverIds" value="driver1" checked'));
 await context.saveDocument({name:doc.name,type:doc.type},['driver2'],doc.id);assert.equal(inserted.length,1);assert.equal(inserted[0].driver_id,'driver2');assert.equal(inserted[0].can_view,true);
 inserted=[];await context.saveDocument({name:doc.name,type:doc.type},[],doc.id);assert.equal(inserted.length,0);
 context.state.documentContext='driver';inserted=[];await context.saveDocument({name:doc.name,type:doc.type,driverId:'driver1'},['driver2'],doc.id);assert.equal(inserted.length,0);
 console.log(file+': PASS selected company sharing preserved, explicit permission, private default and no sharing of personal documents.');
}})().catch(error=>{console.error(error);process.exitCode=1});
