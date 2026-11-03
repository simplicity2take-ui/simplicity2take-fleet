import {
  arrayFrom, boltApiEnvelopeError, clean, first, normalizeActiveVehicle,
  normalizeDriverId, normalizePlate, normalizeVehicleId, statusToPortal
} from "./bolt-sync-utils.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
  }
}

Deno.test("Bolt identity and vehicle fields are normalized", () => {
  assertEquals(clean(null), "");
  assertEquals(first({ uuid: "", id: " id-1 " }, ["uuid", "id"]), " id-1 ");
  assertEquals(normalizeVehicleId({ vehicle_uuid: "  v-1  " }), "v-1");
  assertEquals(normalizeDriverId({ driver_uuid: "  d-1  " }), "d-1");
  assertEquals(normalizePlate({ registration_number: " AA-11-BB " }), "AA-11-BB");
});

Deno.test("Bolt response extraction supports direct and nested provider payloads", () => {
  assertEquals(arrayFrom([{ id: 1 }], ["drivers"]), [{ id: 1 }]);
  assertEquals(arrayFrom({ data: { result: { drivers: [{ id: 2 }] } } }, ["drivers"]), [{ id: 2 }]);
  assertEquals(arrayFrom({ response: { items: [{ id: 3 }] } }, ["items"]), [{ id: 3 }]);
  assertEquals(arrayFrom({ data: { message: "empty" } }, ["drivers"]), []);
});

Deno.test("Bolt status mapping activates only recognized positive states", () => {
  for (const status of ["active", "ACTIVE", "activated", "enabled", "approved", "driver_active"]) {
    assertEquals(statusToPortal(status), "Ativo");
  }
  for (const status of [
    "inactive", "suspended", "blocked", "deactivated", "terminated", "banned", "disabled",
    "not_active", "not-active", "not active", "non-active", "not_approved", "revoked",
    "rejected", "pending", "awaiting_approval", "unverified", "unknown"
  ]) {
    assertEquals(statusToPortal(status), "Inativo");
  }
});

Deno.test("Bolt missing and unknown statuses do not activate new records", () => {
  assertEquals(statusToPortal(null), "Inativo");
  assertEquals(statusToPortal("  "), "Inativo");
  assertEquals(statusToPortal(undefined, "Ativo"), "Ativo");
  assertEquals(statusToPortal("provider-added-state", "Inativo"), "Inativo");
  assertEquals(statusToPortal("provider-added-state", "Ativo"), "Ativo");
});

Deno.test("Bolt supports selected active vehicles without guessing other assignments", () => {
  assertEquals(normalizeActiveVehicle({ active_vehicle: { uuid: "v1" } }), { uuid: "v1" });
  assertEquals(normalizeActiveVehicle({ vehicles: { selected: { uuid: "v2" }, other_assigned: [{ uuid: "v3" }] } }), { uuid: "v2" });
  assertEquals(normalizeActiveVehicle({ vehicles: { other_assigned: [{ uuid: "v3" }] } }), null);
  assertEquals(normalizeActiveVehicle({ active_vehicle: [] }), null);
});

Deno.test("Bolt API envelope rejects provider errors on HTTP success", () => {
  assertEquals(boltApiEnvelopeError([{ id: 1 }]), null);
  assertEquals(boltApiEnvelopeError({ code: 0, data: {} }), null);
  assertEquals(boltApiEnvelopeError({ code: "0", data: {} }), null);
  assertEquals(boltApiEnvelopeError({ code: 17, message: "failed" }), "A API Bolt devolveu um código de erro.");
  assertEquals(boltApiEnvelopeError(null), "A Bolt devolveu uma resposta inválida.");
});
