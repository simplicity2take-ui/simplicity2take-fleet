import { assertEquals } from "jsr:@std/assert";
import {
  analyzeUberStatusMatches,
  isEligibleUberDriverRow,
  isOrganizationRow,
  normalizePhone,
} from "./status-import-helpers.ts";

Deno.test("accepts only ACTIVE and ACCEPTED rows with a UUID", () => {
  assertEquals(isEligibleUberDriverRow({ "UUID do motorista": "abc", Estado: "ACTIVE" }), true);
  assertEquals(isEligibleUberDriverRow({ "UUID do motorista": "abc", Estado: " accepted " }), true);
  assertEquals(isEligibleUberDriverRow({ "UUID do motorista": "abc", Estado: "WAITLISTED_FOR_MISSING_DOCS" }), false);
  assertEquals(isEligibleUberDriverRow({ "UUID do motorista": "abc", Estado: "REJECTED" }), false);
  assertEquals(isEligibleUberDriverRow({ "UUID do motorista": "", Estado: "ACTIVE" }), false);
  assertEquals(isEligibleUberDriverRow({ Estado: "ACCEPTED" }), false);
});

Deno.test("detects organization summary rows independent of accents and case", () => {
  assertEquals(isOrganizationRow({ "Nome do motorista": "SIMPLICITY2TAKE", "Nome da organização": "simplicity2take" }), true);
  assertEquals(isOrganizationRow({ "Nome do motorista": "José Silva", "Nome da organização": "JOSE SILVA" }), true);
  assertEquals(isOrganizationRow({ "Nome do motorista": "José Silva", "Nome da organização": "SIMPLICITY2TAKE" }), false);
  assertEquals(isOrganizationRow({ "Nome do motorista": "", "Nome da organização": "SIMPLICITY2TAKE" }), false);
});

Deno.test("normalizes telephone digits without changing digit order", () => {
  assertEquals(normalizePhone("+351 912-345-678"), "351912345678");
  assertEquals(normalizePhone(""), "");
});

Deno.test("rejects blank UUIDs and unknown or missing states", () => {
  assertEquals(isEligibleUberDriverRow({ "UUID do motorista": "   ", Estado: "ACTIVE" }), false);
  assertEquals(isEligibleUberDriverRow({ "UUID do motorista": "uuid-1", Estado: "WAITLISTED_AUTO_REACTIVATION" }), false);
  assertEquals(isEligibleUberDriverRow({ "UUID do motorista": "uuid-1", Estado: "" }), false);
  assertEquals(isEligibleUberDriverRow({ "UUID do motorista": "uuid-1" }), false);
});

Deno.test("trims UUID and treats state case-insensitively", () => {
  assertEquals(isEligibleUberDriverRow({ "UUID do motorista": " uuid-1 ", Estado: " active " }), true);
  assertEquals(isEligibleUberDriverRow({ "UUID do motorista": " uuid-2 ", Estado: "ACCEPTED" }), true);
});

Deno.test("matches a driver by UUID, email or normalized phone without ambiguity", () => {
  const existing = [
    { id: "driver-1", uber_driver_uuid: "uber-1", email: "one@example.com", phone: "+351 912 345 678" },
  ];
  assertEquals(analyzeUberStatusMatches([
    { "UUID do motorista": "uber-1", "E-mail do motorista": "one@example.com", "Telemóvel": "912345678" },
  ], existing), {
    matchedExisting: 1, wouldCreate: 0, ambiguousMatches: 0, duplicateUuidRows: 0,
  });
});

Deno.test("blocks conflicting identity matches and duplicate report UUIDs", () => {
  const existing = [
    { id: "driver-1", uber_driver_uuid: "uber-1", email: "one@example.com", phone: "911111111" },
    { id: "driver-2", uber_driver_uuid: "uber-2", email: "two@example.com", phone: "922222222" },
  ];
  const result = analyzeUberStatusMatches([
    { "UUID do motorista": "uber-1", "E-mail do motorista": "two@example.com", "Telemóvel": "911111111" },
    { "UUID do motorista": "uber-1", "E-mail do motorista": "one@example.com", "Telemóvel": "911111111" },
  ], existing);
  assertEquals(result.ambiguousMatches > 0, true);
  assertEquals(result.duplicateUuidRows, 1);
});

Deno.test("flags two Uber rows that resolve to the same internal driver", () => {
  const result = analyzeUberStatusMatches([
    { "UUID do motorista": "uber-1", "E-mail do motorista": "one@example.com" },
    { "UUID do motorista": "uber-2", "E-mail do motorista": "one@example.com" },
  ], [{ id: "driver-1", email: "one@example.com" }]);
  assertEquals(result.ambiguousMatches, 2);
});
