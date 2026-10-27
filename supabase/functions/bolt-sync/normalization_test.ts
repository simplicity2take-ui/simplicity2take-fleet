import {
  arrayFrom,
  assertNoDuplicateExternalIdentity,
  normalizeActiveVehicle,
  normalizeDriverId,
  normalizePlate,
  normalizeVehicleId,
  statusToPortal,
} from "./normalization.ts";
import { assertEquals, assertThrows } from "jsr:@std/assert@1";

Deno.test("status mapping rejects inactive before checking active", () => {
  assertEquals(statusToPortal("inactive", "Ativo"), "Inativo");
  assertEquals(statusToPortal("deactivated", "Ativo"), "Inativo");
  assertEquals(statusToPortal("approved", "Inativo"), "Ativo");
  assertEquals(statusToPortal("pending", "Inativo"), "Inativo");
});

Deno.test("unknown status preserves existing state but defaults new records to inactive", () => {
  assertEquals(statusToPortal("pending", "Ativo"), "Ativo");
  assertEquals(statusToPortal("pending", "Inativo"), "Inativo");
  assertEquals(statusToPortal("pending"), "Ativo");
});

Deno.test("arrayFrom finds nested supported arrays", () => {
  assertEquals(arrayFrom({ data: { result: { drivers: [{ uuid: "d1" }] } } }, ["drivers"]), [{ uuid: "d1" }]);
  assertEquals(arrayFrom({ data: { items: [] } }, ["drivers"]), []);
});

Deno.test("normalizers accept known identity fields", () => {
  assertEquals(normalizeDriverId({ driver_uuid: "driver-1" }), "driver-1");
  assertEquals(normalizeVehicleId({ vehicle_uuid: "vehicle-1" }), "vehicle-1");
  assertEquals(normalizePlate({ registration_number: "AA-00-BB" }), "AA-00-BB");
});

Deno.test("duplicate identity check is case and whitespace insensitive", () => {
  assertThrows(
    () => assertNoDuplicateExternalIdentity(
      [{ uuid: " AbC " }, { uuid: "abc" }],
      "UUID de motorista",
      normalizeDriverId,
    ),
    Error,
    "duplicado",
  );
});

Deno.test("duplicate identity check ignores missing identities for caller validation", () => {
  assertEquals(
    assertNoDuplicateExternalIdentity([{ uuid: "" }, {}], "UUID", normalizeDriverId),
    undefined,
  );
});

Deno.test("active vehicle normalizer accepts object and flat identity fields", () => {
  assertEquals(normalizeActiveVehicle({ active_vehicle: { uuid: "v1" } }), { uuid: "v1" });
  assertEquals(normalizeActiveVehicle({ active_vehicle_uuid: "v2", active_vehicle_reg_number: "AA-00-BB" }), { uuid: "v2", reg_number: "AA-00-BB" });
  assertEquals(normalizeActiveVehicle({}), null);
});
