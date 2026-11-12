import {PGlite} from '../tools/driver-lifecycle-tests/node_modules/@electric-sql/pglite/dist/index.js';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
const driver='10000000-0000-4000-8000-000000000001',vehicle='20000000-0000-4000-8000-000000000001';
try{
 await db.exec(`create role service_role;
 create table drivers(id uuid primary key,bolt_driver_uuid text,status text);
 create table vehicles(id uuid primary key,bolt_vehicle_uuid text,plate text);
 create table platform_activity_events(platform text,driver_id uuid,vehicle_id uuid,platform_driver_uuid text,platform_vehicle_uuid text,status text,observed_at timestamptz,event_key text unique);
 create table platform_trip_records(platform text,source_trip_id text,driver_id uuid,vehicle_id uuid,platform_driver_uuid text,platform_vehicle_uuid text,vehicle_plate text,order_status text,accepted_at timestamptz,pickup_at timestamptz,dropoff_at timestamptz,finished_at timestamptz,ride_distance_km numeric,observed_at timestamptz,unique(platform,source_trip_id));
 insert into drivers values('${driver}','driver-1','Inativo');insert into vehicles values('${vehicle}','vehicle-1','AA-00-AA');`);
 await db.exec(await readFile(new URL('../supabase/sql/rollback-preserve-bolt-trip-history.sql',import.meta.url),'utf8'));
 await db.exec('revoke all on function public.sync_bolt_activity(jsonb,jsonb) from public; grant execute on function public.sync_bolt_activity(jsonb,jsonb) to service_role');
 const acl=async()=>(await db.query("select proacl::text acl from pg_proc where oid='public.sync_bolt_activity(jsonb,jsonb)'::regprocedure")).rows[0].acl;
 const beforeAcl=await acl();await db.exec(await readFile(new URL('../supabase/sql/preserve-bolt-trip-history.sql',import.meta.url),'utf8'));assert.equal(await acl(),beforeAcl);
 const save=trips=>db.query('select public.sync_bolt_activity($1::jsonb,$2::jsonb) result',['[]',JSON.stringify(trips)]);
 const full={source_trip_id:'trip-1',driver_uuid:'driver-1',vehicle_uuid:'vehicle-1',vehicle_plate:'AA-00-AA',order_status:'completed',accepted_at:'2026-11-10T10:00:00Z',pickup_at:'2026-11-10T10:05:00Z',dropoff_at:'2026-11-10T10:30:00Z',finished_at:'2026-11-10T10:31:00Z',ride_distance_km:20.5,observed_at:'2026-11-10T10:32:00Z'};
 await save([full]);const read=async()=>(await db.query("select * from platform_trip_records where source_trip_id='trip-1'")).rows[0];
 const baseline=await read();await save([{source_trip_id:'trip-1',observed_at:full.observed_at}]);assert.deepEqual(await read(),baseline);
 await save([{source_trip_id:'trip-1',driver_uuid:'driver-1',vehicle_uuid:'vehicle-1',vehicle_plate:'aa00aa',observed_at:full.observed_at}]);assert.equal((await read()).driver_id,driver);assert.equal((await read()).vehicle_id,vehicle);
 for(const conflict of [{driver_uuid:'different-driver'},{vehicle_uuid:'different-vehicle'},{vehicle_plate:'BB-11-BB'}]){
  const before=await read();await assert.rejects(()=>save([{...full,...conflict},{...full,source_trip_id:'not-inserted'}]),/BOLT_TRIP_IDENTITY_CONFLICT/);assert.deepEqual(await read(),before);assert.equal((await db.query("select count(*)::int n from platform_trip_records where source_trip_id='not-inserted'")).rows[0].n,0);
 }
 // Exercise the conditional UPSERT guard independently of the early precheck.
 const beforeConditional=await read();
 const guardedSql=await readFile(new URL('../supabase/sql/preserve-bolt-trip-history.sql',import.meta.url),'utf8');
 const conditionalOnly=guardedSql.replace(/  -- Existing trip identity[\s\S]*?end if;\n/,'');
 assert.notEqual(conditionalOnly,guardedSql);await db.exec(conditionalOnly);
 await assert.rejects(()=>save([{...full,driver_uuid:'changed-after-precheck'},{...full,source_trip_id:'not-inserted'}]),/concurrent change/);
 assert.deepEqual(await read(),beforeConditional);assert.equal((await db.query("select count(*)::int n from platform_trip_records where source_trip_id='not-inserted'")).rows[0].n,0);
 await db.exec(guardedSql);
 await save([{source_trip_id:'trip-2',driver_uuid:'driver-1'}]);const empty=(await db.query("select * from platform_trip_records where source_trip_id='trip-2'")).rows[0];assert.equal(empty.accepted_at,null);assert.equal(empty.finished_at,null);assert.equal(empty.vehicle_id,null);
 assert.equal((await db.query('select status from drivers where id=$1',[driver])).rows[0].status,'Inativo');
 assert.equal((await db.query('select count(*)::int n from platform_trip_records')).rows[0].n,2);
 console.log('PASS Bolt history database: null fields preserve known data, exact identities, conflicting imports roll back atomically, unknown times stay null, lifecycle/permissions preserved');
}finally{await db.close();}
