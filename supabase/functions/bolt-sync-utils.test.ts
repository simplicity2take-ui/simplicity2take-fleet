import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { hasBoltIdentityConflict, normalizeBoltEmail, normalizeBoltPhone, boltStatusToPortal, boltCompensationDiagnostic, isBoltCompensationCritical } from "./bolt-sync-utils.ts";

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
  assertEquals(boltStatusToPortal("", ""), "Inativo");\n  assertEquals(boltStatusToPortal("   "), "Inativo");\n  assertEquals(boltStatusToPortal(null, "Ativo"), "Inativo");\n  assertEquals(boltStatusToPortal(undefined, "Ativo"), "Inativo");
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
