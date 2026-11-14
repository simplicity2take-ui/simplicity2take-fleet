const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
(async()=>{
  for(const file of ['app.js','teste/app.js']){
    const s=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
    let role='admin',payload,fetches=0;
    const existing={id:'d1',driverId:'driver1',name:'Carta',type:'Carta de Condução',number:'N123',policyNumber:'P456',issueDate:'2025-01-02',observations:'Manter nota',driveFileId:'file1',fileName:'carta.pdf',fileType:'application/pdf',driveUrl:'url1'};
    const context={state:{vehicles:[],drivers:[{id:'driver1',name:'Um'}],documents:[existing,{id:'d2',driverId:'driver2',name:'Outro motorista'}],documentContext:'driver',sessionUserId:'admin'},currentUser:()=>({role}),escapeHtml:v=>String(v||''),alertLevel:()=> 'OK',driverName:()=> 'Motorista',vehicleName:()=> 'Viatura',emptyCard:msg=>msg,showToast:()=>{},selectors:{modalFields:{querySelector:()=>({files:[]})}},documentBlobCache:new Map([['d1','old-file']]),fetchDocumentBlob:()=>{fetches++;throw Error('Unexpected fetch')}};
    context.supabaseClient = { from(table) {
      if (table === 'documents') return { update(value) {
        payload = value;
        return { eq: () => ({ select: () => ({ single: async () => ({ data: { id:'d1' } }) }) }) };
      }};
      return { delete: () => ({ eq: async () => ({ error:null }) }) };
    }};

    context.validateDocumentFile=()=>{};vm.createContext(context);
    for(const [a,b] of [['function documentCard(','\n\nfunction renderApplications('],['function driverDocumentsPanel(','\nfunction driverRow('],['async function downloadDocument(','\nasync function savePassword('],['async function saveDocument(','\nfunction fileToBase64(']])vm.runInContext(s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a))),context);
    let html=context.driverDocumentsPanel({id:'driver1',name:'Um'});
    assert(html.includes('data-open-doc="d1"'));assert(!html.includes('data-open-doc="d2"'));assert(html.includes('data-edit-document="d1"'));assert(html.includes('data-delete-document="d1"'));
    role='driver';assert.equal(context.driverDocumentsPanel({id:'driver1'}),'');html=context.documentCard(existing,false);assert(html.includes('data-open-doc="d1"'));assert(!html.includes('data-download-doc'));assert(!html.includes('data-edit-document'));assert(!html.includes('data-delete-document'));
    await assert.rejects(context.downloadDocument('d1'),/administrador/);assert.equal(fetches,0);
    role='admin';await context.saveDocument({name:'Carta atualizada',type:'Carta de Condução',driverId:'driver1',expiryDate:'2027-12-31'},[],'d1');
    assert.equal(payload.document_number,'N123');assert.equal(payload.policy_number,'P456');assert.equal(payload.issue_date,'2025-01-02');assert.equal(payload.observations,'Manter nota');assert.equal(payload.drive_file_id,'file1');assert.equal(payload.driver_id,'driver1');assert.equal(payload.vehicle_id,null);assert.equal(context.documentBlobCache.has('d1'),false);assert.equal(context.state.requestedDriverId,'driver1');
    console.log(file+': PASS private driver document panel, admin actions, driver viewing-only controls, metadata/file preservation, cache invalidation.');
  }
})().catch(error=>{console.error(error);process.exitCode=1});
