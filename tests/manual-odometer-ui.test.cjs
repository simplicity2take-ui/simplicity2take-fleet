const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

test('admin manual reading retries retain the request id and a previous dialog cannot show late data', async () => {
  const field = {}, submit = {}, status = {}, heading = {}, auto = {}, close = {};
  const list = {replaceChildren(...items){this.items=items;}};
  const form = {elements:{km:field},reportValidity:()=>true,querySelector:()=>submit,reset(){field.valueAsNumber=NaN;}};
  const dialog = {
    querySelector(selector){return {form, '[data-status]':status,ol:list,h2:heading,'[data-cartrack]':auto,'[data-close]':close}[selector];},
    querySelectorAll(){return [status,heading,auto,list];}, showModal(){this.open=true;},close(){this.open=false;}
  };
  const store = new Map(), calls = [];
  const c={window:{},document:{getElementById:()=>dialog,createElement:()=>({})},crypto:{randomUUID:()=>String(calls.length+1)},
    sessionStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../vehicle-manual-odometer.js'),'utf8'),c);
  const controller=c.window.FleetManualOdometer;
  const user={id:'admin',role:'driver'};
  let data=[], read=async()=>({data}), reads=0;
  const client={from(){reads++;return {select(){return this;},eq(){return this;},order(){return this;},limit:()=>read()};},
    async rpc(name,args){
      assert.equal(name,'fleet_record_manual_odometer');
      calls.push(args);
      if(calls.length===1)throw Error('transport');
      data=[{km:0,recorded_by:user.id,recorded_at:'2026-11-26T12:00:00Z'}];
      return {data:data[0].recorded_at};
    }};
  const options={client,vehicle:{id:'v',plate:'AA-00-AA'},getUser:()=>user,cartrack:'Sem leitura CarTrack'};
  await controller.open(options);
  assert.equal(reads,0);
  user.role='admin';
  await controller.open(options);
  assert.equal(submit.disabled,false);
  field.valueAsNumber=0;
  const send=()=>form.onsubmit({preventDefault(){}});
  await send();
  assert.match(status.textContent,/por confirmar/);
  await send();
  assert.deepEqual(calls[0],calls[1]);
  assert.match(status.textContent,/Leitura registada/);
  assert.match(list.items[0].textContent,/0 km.*Registada por si/);
  let finish;
  read=()=>new Promise(resolve=>{finish=resolve;});
  const opening=controller.open(options);
  controller.clear();
  finish({data:[{km:9000,recorded_by:'other',recorded_at:'2026-11-26T12:00:00Z'}]});
  await opening;
  assert.equal(dialog.open,false);
  assert.doesNotMatch(list.items[0].textContent,/9000/);
});
