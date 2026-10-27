import {
  arrayFrom,
  assertNoDuplicateExternalIdentity,
  assertRequiredExternalIdentities,
  decideAssignment,
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
  assertEquals(statusToPortal("pending"), "Inativo");
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

Deno.test("assignment decision preserves a single matching active assignment", () => {
  assertEquals(decideAssignment([{ vehicle_id: "vehicle-1" }], "vehicle-1"), "unchanged");
});

Deno.test("assignment decision flags a different active vehicle without replacement", () => {
  assertEquals(decideAssignment([{ vehicle_id: "vehicle-1" }], "vehicle-2"), "conflict");
});

Deno.test("assignment decision flags multiple active rows even when vehicle matches", () => {
  assertEquals(decideAssignment([{ vehicle_id: "vehicle-1" }, { vehicle_id: "vehicle-1" }], "vehicle-1"), "conflict");
});

Deno.test("assignment decision creates only when no active assignment exists", () => {
  assertEquals(decideAssignment([], "vehicle-1"), "create");
});

Deno.test("required identity validation rejects missing vehicle identity before writes", () => {
  assertThrows(
    () => assertRequiredExternalIdentities([{}, { uuid: "v2" }], "viatura", normalizeVehicleId),
    Error,
    "antes de qualquer escrita",
  );
});

Deno.test("required identity validation accepts driver email or phone fallback", () => {
  assertEquals(
    assertRequiredExternalIdentities([{ email: "driver@example.com" }], "motorista", (row) => row.uuid || row.email || row.phone || ""),
    undefined,
  );
});

Deno.test("duplicate fallback driver email is rejected before writes", () => {
  assertThrows(
    () => assertNoDuplicateExternalIdentity(
      [{ email: "Driver@example.com" }, { email: "driver@example.com" }],
      "identificação de motorista",
      (driver) => String(driver.email || "").trim().toLowerCase(),
    ),
    Error,
    "duplicado",
  );
});

Deno.test("duplicate fallback vehicle registration is rejected before writes", () => {
  assertThrows(
    () => assertNoDuplicateExternalIdentity(
      [{ registration_number: "AA-00-BB" }, { registration_number: "AA00BB" }],
      "identificação de viatura",
      (vehicle) => String(vehicle.registration_number || "").replace(/[\s-]+/g, "").toUpperCase(),
    ),
    Error,
    "duplicado",
  );
});
