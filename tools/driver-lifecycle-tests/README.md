# Isolated Fleet driver lifecycle regression

Run from the repository root:

```sh
npm ci --prefix tools/driver-lifecycle-tests
npm test --prefix tools/driver-lifecycle-tests
```

Uses PGlite 0.5.16 (PostgreSQL compiled to WebAssembly), synthetic tables and fixtures only. No production URL, key or external database is used. Each scenario gets a new in-memory database; fixture transactions are rolled back and empty tables verified.

The suite reproduces the previous Bolt and Uber reactivation bugs, checks the corrected canonical identity functions and standalone Bolt definition, and runs the existing identity-resolution cases. It verifies inactive/active lifecycle preservation, platform observations, reviewed vehicle details, primary contacts and assignment history.

The synthetic schema covers the columns consumed by these functions. This is an isolated function regression, not a full Supabase permissions, RLS or deployment test. The permanent Rúben Peres exemption is configured in the inactivity automation and is not implemented by these sync functions.
