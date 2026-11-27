const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

for (const dir of ['.', './teste']) {
  test(dir + ' withholds shift mileage when CarTrack pages contradict each other', async () => {
    const source = fs.readFileSync(dir + '/app.js', 'utf8');
    const load = source.slice(source.indexOf('async function loadShiftMileage()'), source.indexOf('function renderShiftRegister()'));
    const day = '2026-11-10';
    const state = { profile: { role: 'admin' }, sessionUserId: 'admin' };
    const events = { data: [], count: 0 };
    const query = { select(){return this}, gte(){return this}, lt(){return this}, order(){return this}, range(){return events} };
    let pages;
    const context = vm.createContext({
      state, document: { querySelector: key => ({value: key === '#shiftRegisterDay' ? day : ''}) },
      localDay: () => day, reportDayShift: () => day, reportMidnight: value => Date.parse(value),
      renderActivity(){}, ShiftMileage: require('../' + dir + '/shift-mileage.js'),
      supabaseClient: { from: () => query, functions: { invoke: async (_, {body}) => ({
        data: {success:true, trips:[{id:body.page}], meta:pages[body.page - 1]}
      }) } }
    });
    vm.runInContext(load, context);
    for (const [metadata, partial] of [
      [[{last_page:3,total:3},{last_page:2,total:2}], true],
      [[{last_page:2,total:2},{last_page:2,total:2}], false],
      [[null], false],
    ]) {
      pages = metadata;
      await context.loadShiftMileage();
      assert.equal(state.shiftMileage.partial, partial);
      assert.equal(state.shiftMileage.trips.length, metadata.length);
    }
  });
}

for (const dir of ['.', './teste']) {
  test(dir + ' checks form event pages before confirming mileage or a complete register', async () => {
    const source = fs.readFileSync(dir + '/app.js', 'utf8');
    const day = '2026-11-10';
    const entry = { id:'in', driver_id:'driver', vehicle_id:'car', vehicle_plate:'AA00AA',
      registered_at:day+'T08:00:00Z', event_kind:'entry' };
    const exit = { ...entry, id:'out', registered_at:day+'T16:00:00Z', event_kind:'exit' };
    const trip = { id:1, registration:'AA00AA', start:entry.registered_at, end:exit.registered_at,
      startOdometerKm:1000, endOdometerKm:1120 };
    const state = { profile:{role:'admin'}, sessionUserId:'admin' };
    let fetchPage;
    const query = { select(){return this}, gte(){return this}, lt(){return this}, order(){return this}, range(from){return fetchPage(from)} };
    const model = require('../' + dir + '/shift-mileage.js');
    const context = vm.createContext({
      state, document:{querySelector:key=>({value:key==='#shiftRegisterDay'?day:''})},
      localDay:()=>day, reportDayShift:()=>day, reportMidnight:Date.parse, renderActivity(){},
      ShiftMileage:model, supabaseClient:{from:()=>query,functions:{invoke:async()=>({data:{success:true,trips:[trip],meta:{last_page:1}}})}}
    });
    vm.runInContext(source.slice(source.indexOf('async function loadShiftMileage()'), source.indexOf('function renderBoltRideHistory()')),context);
    for (const [label, first, second, secondEvent, partial] of [
      ['stable',2,2,exit,false], ['shrinking',3,2,exit,true], ['no final count',2,null,exit,true],
      ['duplicate ID',2,2,{...exit,id:entry.id},true], ['short read',3,3,null,true],
      ['no counts',null,null,exit,true],
    ]) {
      fetchPage = offset => offset===0 ? {count:first,data:[entry]} :
        {count:second,data:offset===1&&secondEvent?[secondEvent]:[]};
      await context.loadShiftMileage();
      assert.equal(state.shiftMileage.partial,partial,label);
      const {events,trips} = state.shiftMileage;
      assert.equal(model.mileage(model.sessions(events)[0],trips,state.shiftMileage.partial).distance,partial?null:120,label);
      await context.loadShiftRegister();
      assert.equal(state.shiftRegister.partial,partial,label);
    }
  });
}
