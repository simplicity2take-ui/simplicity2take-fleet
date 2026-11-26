const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {PGlite} = require('../tools/driver-lifecycle-tests/node_modules/@electric-sql/pglite');
const schema = fs.readFileSync(path.join(__dirname, '../supabase/sql/vehicle-manual-odometer.sql'), 'utf8');

test('manual readings enforce vehicle visibility, active admin, immutable history and request identity', async () => {
  const db = new PGlite();
  const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
  const [admin, driver, inactive, mechanic, accountant, car, other, request] = Array.from({length:8}, (_,i)=>uuid(i+1));
  const save = (vehicle, km, id=request) => db.query('select public.fleet_record_manual_odometer($1,$2,$3) as at',[vehicle,id,km]);
  const login = id => db.query("select set_config('fixture.uid',$1,false)",[id]);
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('fixture.uid',true),'')::uuid$$;
      grant usage on schema auth to authenticated;
      create table public.profiles(id uuid primary key, role text, status text);
      create table public.vehicles(id uuid primary key, visible boolean);
      alter table public.vehicles enable row level security;
      create policy fixture_visible on public.vehicles for select using (visible);
      grant select on public.vehicles, public.profiles to authenticated;`);
    for(const [id,role,status] of [[admin,'admin','Ativo'],[inactive,'admin','Inativo'],[driver,'driver','Ativo'],[mechanic,'mechanic','Ativo'],[accountant,'accountant','Ativo']])
      await db.query('insert into profiles values ($1,$2,$3)',[id,role,status]);
    await db.query('insert into vehicles values ($1,true),($2,false)',[car,other]);
    await db.exec(schema);
    await db.exec('set role authenticated');
    await login(admin);
    const result = await save(car,0);
    assert.deepEqual(await save(car,0),result);
    await assert.rejects(save(car,100,request));
    await assert.rejects(save(other,100,uuid(10)));
    for(const km of [-1,1.1,'NaN','Infinity']) await assert.rejects(save(car,km,uuid(11)));
    assert.equal((await db.query('select recorded_by from fleet_manual_odometer')).rows[0].recorded_by,admin);
    await assert.rejects(db.query('update fleet_manual_odometer set km=250'));
    await assert.rejects(db.query('delete from fleet_manual_odometer'));
    await assert.rejects(db.query('insert into fleet_manual_odometer(vehicle_id,request_id,recorded_by,km) values($1,$2,$3,1)',[car,uuid(12),driver]));
    for (const id of [driver,mechanic,accountant,inactive]) {
      await login(id);
      assert.deepEqual((await db.query('select * from fleet_manual_odometer')).rows,[]);
      await assert.rejects(save(car,10));
    }
    await db.exec('reset role; set role anon');
    await assert.rejects(save(car,10));
    await db.exec('reset role');
    assert.equal((await db.query('select count(*)::int as n from fleet_manual_odometer')).rows[0].n,1);
    const restored = new PGlite({loadDataDir: await db.dumpDataDir()});
    try {
      await restored.exec('set role authenticated');
      await restored.query("select set_config('fixture.uid',$1,false)", [admin]);
      const recovered = await restored.query('select vehicle_id,recorded_by,recorded_at as at,km from fleet_manual_odometer');
      assert.equal(recovered.rows[0].vehicle_id,car);
      assert.equal(recovered.rows[0].recorded_by,admin);
      assert.equal(Number(recovered.rows[0].km),0);
      assert.deepEqual(recovered.rows[0].at,result.rows[0].at);
      await restored.query("select set_config('fixture.uid',$1,false)", [driver]);
      assert.deepEqual((await restored.query('select * from fleet_manual_odometer')).rows,[]);
    } finally {await restored.close();}
  } finally {await db.close();}
});
