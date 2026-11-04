import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { hasBoltIdentityConflict, normalizeBoltEmail, normalizeBoltPhone, normalizeBoltActiveVehicle, boltStatusToPortal, boltCompensationDiagnostic, isBoltCompensationCritical, boltApiEnvelopeError, extractBoltCompanies, resolveSingleBoltCompanyId, boltPageCountIsValid, hasDuplicateBoltIdentities } from "./bolt-sync-utils.ts";

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

Deno.test("Bolt email normalization trims and lowercases", () => {
  assertEquals(normalizeBoltEmail("  DRIVER@Example.COM "), "driver@example.com");
  assertEquals(normalizeBoltEmail(null), "");
});

Deno.test("Bolt phone normalization removes whitespace but preserves punctuation and prefix", () => {
  assertEquals(normalizeBoltPhone(" +351 912-345-678 "), "+351912-345-678");
  assertEquals(normalizeBoltPhone(undefined), "");
});

Deno.test("Bolt status mapping preserves fallback and maps known states", () => {
  assertEquals(boltStatusToPortal("suspended"), "Inativo");
  assertEquals(boltStatusToPortal("approved"), "Ativo");
  assertEquals(boltStatusToPortal("pending", "Inativo"), "Inativo");
  assertEquals(boltStatusToPortal("", ""), "Inativo");
  assertEquals(boltStatusToPortal("   "), "Inativo");
  assertEquals(boltStatusToPortal(null, "Ativo"), "Inativo");
  assertEquals(boltStatusToPortal(undefined, "Ativo"), "Inativo");
});

Deno.test("Bolt compensation diagnostics distinguish restored, deleted and critical failures", () => {
  assertEquals(isBoltCompensationCritical({ ok: true, action: "restored" }), false);
  assertEquals(isBoltCompensationCritical({ ok: false, action: "restore_failed" }), true);
  assertEquals(boltCompensationDiagnostic({ ok: true, action: "restored" }), "Perfil anterior restaurado após falha de atribuição.");
  assertEquals(boltCompensationDiagnostic({ ok: true, action: "deleted" }), "Novo perfil removido após falha de atribuição.");
  assertEquals(boltCompensationDiagnostic({ ok: false, action: "restore_failed" }), "Falha crítica: não foi possível restaurar o perfil anterior.");
  assertEquals(boltCompensationDiagnostic({ ok: false, action: "delete_failed" }), "Falha crítica: não foi possível remover o novo perfil.");
});

Deno.test("Bolt status mapping handles case-insensitive inactive and active variants", () => {
  for (const value of ["SUSPENDED", "Blocked", "deactivated", "INACTIVE", "terminated", "banned", "disabled"]) {
    assertEquals(boltStatusToPortal(value), "Inativo");
  }
  for (const value of ["ACTIVE", "Activated", "enabled", "APPROVED"]) {
    assertEquals(boltStatusToPortal(value), "Ativo");
  }
});

Deno.test("Bolt status mapping does not infer unknown states as active", () => {
  assertEquals(boltStatusToPortal("pending_review"), "Inativo");
  assertEquals(boltStatusToPortal("unknown", "Inativo"), "Inativo");
});

Deno.test("Bolt status mapping prioritizes explicit negative variants", () => {
  for (const value of ["not_active", "not-active", "not active", "non-active", "not_approved", "revoked", "rejected"]) {
    assertEquals(boltStatusToPortal(value), "Inativo");
  }
});

Deno.test("Bolt pending and unverified statuses do not activate a driver", () => {
  for (const value of ["pending", "pending_review", "awaiting_approval", "unverified", "unknown"]) {
    assertEquals(boltStatusToPortal(value), "Inativo");
  }
  assertEquals(boltStatusToPortal("pending", "Ativo"), "Inativo");
});

Deno.test("Bolt status mapping fails closed for unrecognized vocabulary", () => {
  for (const value of ["review", "paused_by_admin", "custom_provider_state", "1", true, { status: "active" }]) {
    assertEquals(boltStatusToPortal(value), "Inativo");
  }
  assertEquals(boltStatusToPortal("active"), "Ativo");
  assertEquals(boltStatusToPortal("approved"), "Ativo");
});


Deno.test("Bolt API envelope rejects nonzero provider codes even on HTTP success", () => {
  assertEquals(boltApiEnvelopeError({ code: 0, data: {} }), null);
  assertEquals(boltApiEnvelopeError({ code: "0", data: {} }), null);
  assertEquals(boltApiEnvelopeError({ code: 17, message: "failed" }), "A API Bolt devolveu um código de erro.");
  assertEquals(boltApiEnvelopeError(null), "A Bolt devolveu uma resposta inválida.");
});

Deno.test("Bolt company extraction and resolution fail closed on ambiguity", () => {
  assertEquals(extractBoltCompanies({ data: { companies: [{ company_id: " c-1 " }, { company_id: "c-2" }] } }), [
    { company_id: "c-1" }, { company_id: "c-2" }
  ]);
  assertEquals(resolveSingleBoltCompanyId([{ company_id: "c-1" }]), "c-1");
  assertEquals(resolveSingleBoltCompanyId([{ company_id: "c-1" }, { company_id: "c-2" }]), null);
  assertEquals(resolveSingleBoltCompanyId([]), null);
});

Deno.test("Bolt page metadata accepts consistent totals and rejects malformed or oversized totals", () => {
  assertEquals(boltPageCountIsValid(100, 100), true);
  assertEquals(boltPageCountIsValid(100, 250), true);
  assertEquals(boltPageCountIsValid(101, 100), false);
  assertEquals(boltPageCountIsValid(0, -1), false);
  assertEquals(boltPageCountIsValid(0, 5001), false);
  assertEquals(boltPageCountIsValid(0, "10"), false);
});


Deno.test("Bolt company resolution deduplicates repeated company IDs safely", () => {
  assertEquals(resolveSingleBoltCompanyId([
    { company_id: " c-1 " }, { company_id: "c-1" }, { company_id: "" }
  ]), "c-1");
});

Deno.test("Bolt company extraction rejects malformed company collections", () => {
  assertEquals(extractBoltCompanies({ data: { companies: "c-1" } }), []);
  assertEquals(extractBoltCompanies({ data: { companies: [null, {}, { company_id: 7 }, { company_id: " " }] } }), []);
  assertEquals(extractBoltCompanies([]), []);
});

Deno.test("Bolt pagination guard accepts exact safety boundary and rejects fractional values", () => {
  assertEquals(boltPageCountIsValid(1000, 5000), true);
  assertEquals(boltPageCountIsValid(1.5, 10), false);
  assertEquals(boltPageCountIsValid(0, 10.5), false);
  assertEquals(boltPageCountIsValid(5001, 5000), false);
});

Deno.test("Bolt selected vehicle normalization supports v1 and v2 without guessing", () => {
  const v1 = { uuid: "vehicle-v1", registration_number: "AA-00-AA" };
  const v2 = { uuid: "vehicle-v2", registration_number: "BB-00-BB" };
  assertEquals(normalizeBoltActiveVehicle({ active_vehicle: v1 }), v1);
  assertEquals(normalizeBoltActiveVehicle({ vehicles: { selected: v2, other_assigned: [v1] } }), v2);
  assertEquals(normalizeBoltActiveVehicle({ vehicles: { selected: null, other_assigned: [v1] } }), null);
  assertEquals(normalizeBoltActiveVehicle({ vehicles: { other_assigned: [v1] } }), null);
  assertEquals(normalizeBoltActiveVehicle({ vehicles: null }), null);
  assertEquals(normalizeBoltActiveVehicle(null), null);
  assertEquals(normalizeBoltActiveVehicle({ active_vehicle: "invalid" }), null);
});

Deno.test("Bolt pre-write guard detects repeated provider identities", () => {
  assertEquals(hasDuplicateBoltIdentities([{ id: "one" }, { id: "one" }], (r: any) => r.id), true);
  assertEquals(hasDuplicateBoltIdentities([{ id: "one" }, { id: "two" }], (r: any) => r.id), false);
  assertEquals(hasDuplicateBoltIdentities([{ id: "" }, { id: null }], (r: any) => r.id), false);
  assertEquals(hasDuplicateBoltIdentities([{ id: " one " }, { id: "one" }], (r: any) => r.id), true);
});

Deno.test("Bolt duplicate guard detects normalized email and phone collisions", () => {
  const drivers = [
    { email: " Driver@Example.com ", phone: "+351 912 345 678" },
    { email: "driver@example.com", phone: "+351912345678" },
  ];
  assertEquals(hasDuplicateBoltIdentities(drivers, (d: any) => normalizeBoltEmail(d.email)), true);
  assertEquals(hasDuplicateBoltIdentities(drivers, (d: any) => normalizeBoltPhone(d.phone)), true);
  assertEquals(hasDuplicateBoltIdentities([{ email: "" }, { email: null }], (d: any) => normalizeBoltEmail(d.email)), false);
});
