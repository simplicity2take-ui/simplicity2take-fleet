const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { PGlite } = require('../tools/driver-lifecycle-tests/node_modules/@electric-sql/pglite');

const read = file => fs.readFile(path.join(__dirname, '..', file), 'utf8');
const uuid = n => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');

test('document SELECT policy with repository helpers and overlapping RLS policies', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated;
    CREATE TABLE profiles(id uuid PRIMARY KEY, role text, status text);
    CREATE TABLE drivers(id uuid PRIMARY KEY, profile_id uuid UNIQUE, status text);
    CREATE TABLE vehicles(id int PRIMARY KEY);
    CREATE TABLE vehicle_assignments(vehicle_id int, driver_id uuid, active boolean, active_from date, active_until date);
    CREATE TABLE documents(id text PRIMARY KEY, driver_id uuid, vehicle_id int, expiry_date date);
    CREATE TABLE document_viewers(document_id text, driver_id uuid, can_view boolean);
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;
  `);
  await db.exec(await read('supabase/migrations/20260928174000_s2t_access_control.sql'));
  // A dated record can have either legacy policy name. Keep an independent permissive
  // SELECT policy in the fixture to verify that the document boundary always applies.
  await db.exec(`
    CREATE POLICY "s2t documents select" ON documents FOR SELECT TO authenticated USING (true);
    CREATE POLICY "fixture independent grant" ON documents FOR SELECT TO authenticated USING (true);
  `);
  const candidate = await read('docs/review-proposals/documents-driver-read-policy.sql');
  await db.exec(candidate);
  await db.exec(candidate);
  const admin = uuid(1), alice = uuid(2), bob = uuid(3), orphan = uuid(4);
  const driverA = uuid(11), driverB = uuid(12);
  await db.exec(`
    INSERT INTO profiles VALUES
      ('${admin}', 'admin', 'Ativo'), ('${alice}', 'driver', 'Ativo'),
      ('${bob}', 'driver', 'Ativo'), ('${orphan}', 'driver', 'Ativo');
    INSERT INTO drivers VALUES ('${driverA}', '${alice}', 'Ativo'), ('${driverB}', '${bob}', 'Ativo');
    SET TIME ZONE 'Pacific/Honolulu';
    BEGIN;
  `);
  const today = "(now() AT TIME ZONE 'Europe/Lisbon')::date";
  await db.exec(`
    INSERT INTO vehicle_assignments VALUES
      (1, '${driverA}', true, ${today}, ${today}), (2, '${driverB}', true, ${today}, null),
      (3, '${driverA}', true, ${today}-4, ${today}-1), (4, '${driverA}', true, ${today}+1, null);
    INSERT INTO documents VALUES
      ('alice', '${driverA}', null, null), ('bob', '${driverB}', null, null),
      ('expired', '${driverA}', null, ${today}-1), ('shared', null, null, ${today}),
      ('revoked', null, null, null), ('private', null, null, null),
      ('car-1', null, 1, null), ('car-2', null, 2, null), ('car-3', null, 3, null), ('car-4', null, 4, null),
      ('invalid', '${driverA}', 1, null);
    INSERT INTO document_viewers VALUES
      ('shared', '${driverA}', true), ('revoked', '${driverA}', false),
      ('car-2', '${driverA}', true), ('bob', '${driverA}', true);
  `);

  async function visible(role, subject) {
    await db.exec(role === 'anon' ? 'SET LOCAL ROLE anon' : 'SET LOCAL ROLE authenticated');
    try {
      await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [subject]);
      const result = await db.query('SELECT id FROM documents ORDER BY id');
      return result.rows.map(row => row.id);
    } finally {
      await db.exec('RESET ROLE');
    }
  }
  const all = ['alice', 'bob', 'car-1', 'car-2', 'car-3', 'car-4', 'expired', 'invalid', 'private', 'revoked', 'shared'];
  assert.deepEqual(await visible('authenticated', admin), all);
  assert.deepEqual(await visible('authenticated', alice), ['alice', 'car-1', 'shared']);
  assert.deepEqual(await visible('authenticated', bob), ['bob', 'car-2']);
  assert.deepEqual(await visible('authenticated', orphan), []);
  assert.deepEqual(await visible('authenticated', ''), []);
  assert.deepEqual(await visible('anon', ''), []);

  await db.query("UPDATE drivers SET status = 'Inativo' WHERE id = $1", [driverA]);
  assert.deepEqual(await visible('authenticated', alice), []);
  await db.query("UPDATE profiles SET status = 'Inativo' WHERE id = $1", [bob]);
  assert.deepEqual(await visible('authenticated', bob), []);
  await db.query("UPDATE profiles SET role = 'candidate', status = 'Ativo' WHERE id = $1", [bob]);
  assert.deepEqual(await visible('authenticated', bob), []);
  await db.query('UPDATE profiles SET status = null WHERE id = $1', [admin]);
  assert.deepEqual(await visible('authenticated', admin), []);
  await db.exec('ROLLBACK');
});
