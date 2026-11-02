import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { hasBoltIdentityConflict } from "./bolt-sync-utils.ts";

Deno.test("Bolt identity guard allows missing identifiers", () => {
  assertEquals(hasBoltIdentityConflict(null, "bolt-1"), false);
  assertEquals(hasBoltIdentityConflict("bolt-1", ""), false);
  assertEquals(hasBoltIdentityConflict(undefined, undefined), false);
});

Deno.test("Bolt identity guard accepts matching identifiers", () => {
  assertEquals(hasBoltIdentityConflict("bolt-1", "bolt-1"), false);
});

Deno.test("Bolt identity guard rejects conflicting identifiers", () => {
  assertEquals(hasBoltIdentityConflict("bolt-1", "bolt-2"), true);
});
