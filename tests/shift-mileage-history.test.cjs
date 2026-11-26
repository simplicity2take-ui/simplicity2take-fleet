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
