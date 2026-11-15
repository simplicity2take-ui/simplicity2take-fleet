const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const candidate = fs.readFileSync(
  path.join(__dirname, '..', 'docs/review-proposals/documents-driver-read-policy.sql'),
  'utf8'
);

test('driver document RLS proposal is review-only and never silently applied', () => {
  assert.match(candidate, /REVIEW ONLY: do not apply without explicit approval/);
  assert.match(candidate, /CREATE POLICY "s2t documents select"/);
  assert.match(candidate, /ON public\.documents\s+FOR SELECT\s+TO authenticated/);
  assert.match(candidate, /public\.s2t_is_admin\(\)/);
  assert.doesNotMatch(candidate, /\bSECURITY DEFINER\b|\bGRANT\s+ALL\b/);
});

test('driver metadata access excludes expired documents using Lisbon calendar date', () => {
  assert.match(candidate, /expiry_date IS NULL OR expiry_date >= \(now\(\) AT TIME ZONE 'Europe\/Lisbon'\)::date/);
  const matches = candidate.match(/\(now\(\) AT TIME ZONE 'Europe\/Lisbon'\)::date/g) || [];
  assert.equal(matches.length, 3, 'expiry and assignment dates must share the Lisbon day');
  assert.doesNotMatch(candidate, /\bCURRENT_DATE\b/i, 'database timezone must not accidentally control expiry');
});

test('driver metadata access additionally requires an active driver record', () => {
  assert.match(candidate, /FROM public\.drivers active_driver/);
  assert.match(candidate, /active_driver\.id = public\.s2t_driver_id\(\)/);
  assert.match(candidate, /active_driver\.status = 'Ativo'/);
});

test('personal, vehicle, and company document cases stay mutually exclusive', () => {
  assert.match(candidate, /driver_id IS NOT NULL\s+AND vehicle_id IS NULL\s+AND driver_id = public\.s2t_driver_id\(\)/);
  assert.match(candidate, /vehicle_id IS NOT NULL\s+AND driver_id IS NULL\s+AND EXISTS\s*\(\s*SELECT 1\s+FROM public\.vehicle_assignments va/);
  assert.match(candidate, /vehicle_id IS NULL\s+AND driver_id IS NULL\s+AND EXISTS\s*\(\s*SELECT 1\s+FROM public\.document_viewers dv/);
  assert.match(candidate, /va\.vehicle_id = documents\.vehicle_id/);
  assert.match(candidate, /va\.driver_id = public\.s2t_driver_id\(\)/);
  assert.match(candidate, /va\.active_from <= \(now\(\) AT TIME ZONE 'Europe\/Lisbon'\)::date/);
  assert.match(candidate, /va\.active_until IS NULL OR va\.active_until >= \(now\(\) AT TIME ZONE 'Europe\/Lisbon'\)::date/);
  assert.match(candidate, /dv\.document_id = documents\.id/);
  assert.match(candidate, /dv\.driver_id = public\.s2t_driver_id\(\)/);
  assert.match(candidate, /dv\.can_view IS TRUE/);
});
