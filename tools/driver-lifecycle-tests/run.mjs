import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
const sourceFiles = {
 'identity.sql': '../../supabase/sql/platform-driver-identity.sql',
 'bolt.sql': '../../supabase/sql/sync-bolt-preserve-reviewed-data.sql',
 'regression.sql': '../../supabase/tests/sync_bolt_preserve_reviewed_data.sql',
 'identity-test.sql': '../../supabase/tests/platform-driver-identity.sql'
};
const read = name => readFile(new URL(sourceFiles[name], import.meta.url), 'utf8');
const schema = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.drivers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), full_name text, email text, phone text,
 status text DEFAULT 'Ativo', bolt_driver_uuid text, bolt_partner_uuid text,
 bolt_last_synced_at timestamptz, uber_driver_uuid text, uber_status text,
 uber_realtime_status text, uber_status_at timestamptz, uber_last_online_at timestamptz,
 uber_status_raw jsonb, uber_last_synced_at timestamptz, updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.vehicles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), plate text, brand text, model text,
 vehicle_year integer, vin text, status text DEFAULT 'Ativo', bolt_vehicle_uuid text,
 bolt_last_synced_at timestamptz, updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.vehicle_assignments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid REFERENCES vehicles(id),
 driver_id uuid REFERENCES drivers(id), active_from date, active_until date, source text
);`;
const identity = await read('identity.sql');
const bolt = await read('bolt.sql');
const regression = await read('regression.sql');
const identityTest = await read('identity-test.sql');
async function run(label, identitySource, boltSource, expectedFailure) {
 const db = new PGlite();
 try {
  await db.exec(schema);
  await db.exec(identitySource);
  if (boltSource) await db.exec(boltSource);
  let failure;
  try {
   await db.exec('BEGIN;');
   await db.exec(regression);
   await db.exec('ROLLBACK;');
  } catch (e) { failure=e; await db.exec('ROLLBACK;'); }
  if (expectedFailure) {
   if (!failure || !failure.message.includes(expectedFailure))
    throw new Error('Baseline did not reproduce expected regression: '+failure?.message);
   console.log('PASS '+label+': reproduced '+failure.message);
  } else {
   if (failure) throw failure;
   if (!boltSource) await db.exec(identityTest);
   const rows=await db.query('SELECT (SELECT count(*) FROM drivers)+(SELECT count(*) FROM vehicles)+(SELECT count(*) FROM vehicle_assignments) AS remaining');
   if (Number(rows.rows[0].remaining)!==0) throw new Error('Fixture rows leaked');
   console.log('PASS '+label+': lifecycle, reviewed data, contacts, assignments and rollback'+(!boltSource?', identity resolution':''));
  }
 } finally { await db.close(); }
}
const oldIdentity = identity.replace('          -- Fleet lifecycle is managed by the administrator / inactivity policy.\n          -- A platform account state must not reactivate or deactivate this driver.\n','          status = d_status,\n').replace('        uber_driver_uuid=v_uuid,uber_status=v_status','        status=\'Ativo\',uber_driver_uuid=v_uuid,uber_status=v_status');
await run('original Bolt behavior', oldIdentity, null, 'Bolt reactivated an inactive Fleet driver');
const oldUber = identity.replace('        uber_driver_uuid=v_uuid,uber_status=v_status','        status=\'Ativo\',uber_driver_uuid=v_uuid,uber_status=v_status');
await run('original Uber behavior', oldUber, null, 'Uber reactivated an inactive Fleet driver');
await run('canonical identity functions', identity, null, false);
await run('standalone Bolt definition', identity, bolt, false);
