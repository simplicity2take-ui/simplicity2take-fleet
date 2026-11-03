import {
  assertBoltCompanyAccessible,
  getBoltCollection,
  normalizeBoltCompanyId,
  resolveBoltCompanyId,
  requestBolt,
} from "./bolt-api-client.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
  }
}

function assertThrows(action: () => unknown, expectedMessage: string): void {
  let actual = "";
  try {
    action();
  } catch (error) {
    actual = error instanceof Error ? error.message : String(error);
  }
  if (!actual.includes(expectedMessage)) {
    throw new Error(`Expected error containing "${expectedMessage}", got "${actual}"`);
  }
}

Deno.test("Bolt v2 company ID requires a positive safe integer", () => {
  assertEquals(normalizeBoltCompanyId("12345"), 12345);
  for (const invalid of [undefined, "", "0", "-1", "1.5", "abc", "9007199254740992"]) {
    assertThrows(() => normalizeBoltCompanyId(invalid), "BOLT_COMPANY_ID");
  }
});

Deno.test("Bolt v2 company ID must be accessible and active", () => {
  const companies = {
    code: 0,
    data: {
      companies: [
        { company_id: 12345, status_code: "active" },
        { company_id: 67890, status_code: "deactivated" },
      ],
    },
  };
  assertBoltCompanyAccessible(12345, companies);
  assertEquals(resolveBoltCompanyId("12345", companies), 12345);
  assertEquals(resolveBoltCompanyId(undefined, { code: 0, data: { companies: [{ company_id: 55, status_code: "active" }] } }), 55);
  assertThrows(() => assertBoltCompanyAccessible(67890, companies), "empresa ativa acessível");
  assertThrows(() => assertBoltCompanyAccessible(77777, companies), "empresa ativa acessível");
  assertThrows(() => assertBoltCompanyAccessible(12345, { code: 0, data: {} }), "lista de empresas inválida");
  assertThrows(() => resolveBoltCompanyId(undefined, companies), "BOLT_COMPANY_ID");
  assertThrows(() => resolveBoltCompanyId("99999", companies), "empresa ativa acessível");
});

Deno.test("Bolt v2 company discovery sends no body and uses the access token", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const fakeFetch: typeof fetch = async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(JSON.stringify({ code: 0, data: { companies: [] } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  await requestBolt(fakeFetch, "https://bolt.example", "/fleetIntegration/v2/getCompanies", "token");
  assertEquals(requestUrl, "https://bolt.example/fleetIntegration/v2/getCompanies");
  assertEquals(requestInit?.method, "POST");
  assertEquals(new Headers(requestInit?.headers).get("Authorization"), "Bearer token");
  assertEquals(requestInit?.body, undefined);
});

Deno.test("Bolt v2 collection follows total_rows with documented offset and limit", async () => {
  const offsets: number[] = [];
  const fakeFetch: typeof fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body));
    offsets.push(payload.offset);
    const drivers = payload.offset === 0
      ? [{ uuid: "driver-1" }, { uuid: "driver-2" }]
      : [{ uuid: "driver-3" }];
    return new Response(JSON.stringify({
      code: 0,
      message: "OK",
      data: { drivers, total_rows: 3 },
    }), { status: 200 });
  };
  const rows = await getBoltCollection(
    fakeFetch,
    "https://bolt.example",
    "/fleetIntegration/v2/getDrivers",
    "token",
    12345,
    "drivers",
    2,
  );
  assertEquals(rows, [{ uuid: "driver-1" }, { uuid: "driver-2" }, { uuid: "driver-3" }]);
  assertEquals(offsets, [0, 2]);
});

Deno.test("Bolt v2 pagination rejects incomplete and malformed collections", async () => {
  const incompleteFetch: typeof fetch = async () => new Response(JSON.stringify({
    code: 0, data: { drivers: [{ uuid: "driver-1" }], total_rows: 2 },
  }), { status: 200 });
  let incomplete = false;
  try {
    await getBoltCollection(incompleteFetch, "https://bolt.example", "/drivers", "token", 1, "drivers", 2);
  } catch (error) {
    incomplete = error instanceof Error && error.message.includes("não corresponde");
  }
  if (!incomplete) throw new Error("Expected incomplete Bolt pagination to fail closed");

  const malformedFetch: typeof fetch = async () => new Response(JSON.stringify({
    code: 0, data: { items: [] },
  }), { status: 200 });
  let malformed = false;
  try {
    await getBoltCollection(malformedFetch, "https://bolt.example", "/drivers", "token", 1, "drivers", 2);
  } catch (error) {
    malformed = error instanceof Error && error.message.includes("lista drivers inválida");
  }
  if (!malformed) throw new Error("Expected a malformed Bolt collection to fail closed");
});

Deno.test("Bolt v2 HTTP 200 responses with provider error codes are rejected", async () => {
  const fakeFetch: typeof fetch = async () => new Response(JSON.stringify({
    code: 498810,
    message: "COMPANY_NOT_ALLOWED",
  }), { status: 200 });
  let rejected = false;
  try {
    await requestBolt(fakeFetch, "https://bolt.example", "/fleetIntegration/v2/getCompanies", "token");
  } catch (error) {
    rejected = error instanceof Error && error.message.includes("código de erro");
  }
  if (!rejected) throw new Error("Expected a Bolt error envelope to be rejected");
});
