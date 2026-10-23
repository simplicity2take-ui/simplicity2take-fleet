import { assertEquals } from "jsr:@std/assert";
import {
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
