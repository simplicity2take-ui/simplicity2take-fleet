import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import { assertBoltSuccess, extractBoltCompanies, fetchAllBoltPages } from "./bolt-v2.ts";

Deno.test("Bolt v2 success envelope requires code zero and object data", () => {
  assertEquals(assertBoltSuccess({ code: 0, data: { drivers: [] } }).data, { drivers: [] });
  assertThrows(() => assertBoltSuccess({ data: { drivers: [] } }), Error, "código");
  assertThrows(() => assertBoltSuccess({ code: 5, data: {} }), Error, "código");
  assertThrows(() => assertBoltSuccess({ code: "", data: {} }), Error, "código");
  assertThrows(() => assertBoltSuccess({ code: "   ", data: {} }), Error, "código");
  assertThrows(() => assertBoltSuccess({ code: false as unknown as string, data: {} }), Error, "código");
  assertThrows(() => assertBoltSuccess({ code: 0, data: [] }), Error, "data");
});

Deno.test("company extraction validates and rejects duplicate IDs", () => {
  assertEquals(extractBoltCompanies({ code: 0, data: { companies: [{ company_id: 12 }, { company_id: 13 }] } }), [
    { company_id: 12 }, { company_id: 13 },
  ]);
  assertThrows(() => extractBoltCompanies({ code: 0, data: { companies: [{ company_id: 12 }, { company_id: 12 }] } }), Error, "duplicado");
  assertThrows(() => extractBoltCompanies({ code: 0, data: { companies: [{ company_id: 0 }] } }), Error, "válido");
});

Deno.test("pagination uses top-level offset and limit and stops at short page", async () => {
  const calls: Array<[number, number]> = [];
  const rows = await fetchAllBoltPages<{ id: number }>(async (offset, limit) => {
    calls.push([offset, limit]);
    return { code: 0, data: { drivers: offset === 0 ? [{ id: 1 }, { id: 2 }] : [{ id: 3 }] } };
  }, "drivers", { limit: 2 });
  assertEquals(rows, [{ id: 1 }, { id: 2 }, { id: 3 }]);
  assertEquals(calls, [[0, 2], [2, 2]]);
});

Deno.test("pagination returns an empty collection when the first page is empty", async () => {
  const rows = await fetchAllBoltPages(async () => ({ code: 0, data: { vehicles: [] } }), "vehicles", { limit: 5 });
  assertEquals(rows, []);
});

Deno.test("pagination rejects missing collection and repeated pages", async () => {
  await assertRejects(() => fetchAllBoltPages(async () => ({ code: 0, data: {} }), "drivers", { limit: 2 }), Error, "sem lista");
  await assertRejects(() => fetchAllBoltPages(async () => ({
    code: 0, data: { drivers: [{ uuid: "same" }, { uuid: "page" }] },
  }), "drivers", { limit: 2, maxPages: 3 }), Error, "repetiu");
});

Deno.test("pagination fails closed when the page ceiling is reached", async () => {
  await assertRejects(() => fetchAllBoltPages(async (offset) => ({
    code: 0, data: { drivers: [{ uuid: String(offset) }, { uuid: String(offset + 1) }] },
  }), "drivers", { limit: 2, maxPages: 2 }), Error, "limite de segurança");
});

Deno.test("pagination requests the next page after a full page and accepts an empty terminator", async () => {
  const offsets: number[] = [];
  const rows = await fetchAllBoltPages<{ uuid: string }>(async (offset, limit) => {
    offsets.push(offset);
    if (offset === 0) {
      return { code: 0, data: { drivers: [{ uuid: "d1" }, { uuid: "d2" }] } };
    }
    return { code: 0, data: { drivers: [] } };
  }, "drivers", { limit: 2 });

  assertEquals(rows, [{ uuid: "d1" }, { uuid: "d2" }]);
  assertEquals(offsets, [0, 2]);
});

Deno.test("pagination rejects invalid limit", async () => {
  await assertRejects(() => fetchAllBoltPages(async () => ({ code: 0, data: { drivers: [] } }), "drivers", { limit: 1001 }), Error, "inválido");
});

Deno.test("pagination rejects a response that exceeds the configured row ceiling", async () => {
  await assertRejects(
    () => fetchAllBoltPages(async () => ({
      code: 0,
      data: { vehicles: [{ uuid: "v1" }, { uuid: "v2" }, { uuid: "v3" }] },
    }), "vehicles", { limit: 3, maxRows: 2 }),
    Error,
    "excede o limite de segurança",
  );
});

Deno.test("pagination rejects non-zero Bolt application codes even when data contains rows", async () => {
  await assertRejects(
    () => fetchAllBoltPages(async () => ({
      code: 17,
      data: { vehicles: [{ uuid: "v1" }] },
    }), "vehicles", { limit: 3 }),
    Error,
    "código de erro",
  );
});

Deno.test("pagination rejects invalid safety ceilings before requesting a page", async () => {
  let calls = 0;
  const fetchPage = async () => {
    calls++;
    return { code: 0, data: { drivers: [] } };
  };
  await assertRejects(
    () => fetchAllBoltPages(fetchPage, "drivers", { maxPages: 0 }),
    Error,
    "Limites de segurança",
  );
  await assertRejects(
    () => fetchAllBoltPages(fetchPage, "drivers", { maxRows: 0 }),
    Error,
    "Limites de segurança",
  );
  assertEquals(calls, 0);
});

Deno.test("company extraction rejects malformed and unsafe company identifiers", () => {
  assertThrows(
    () => extractBoltCompanies({ code: 0, data: { companies: [null] } }),
    Error,
    "inválida",
  );
  assertThrows(
    () => extractBoltCompanies({ code: 0, data: { companies: [{ company_id: Number.MAX_SAFE_INTEGER + 1 }] } }),
    Error,
    "válido",
  );
  assertThrows(
    () => extractBoltCompanies({ code: 0, data: {} }),
    Error,
    "sem lista",
  );
});

Deno.test("pagination rejects a page larger than the requested limit", async () => {
  let calls = 0;
  await assertRejects(
    () => fetchAllBoltPages(async () => {
      calls++;
      return {
        code: 0,
        data: { drivers: [{ uuid: "d1" }, { uuid: "d2" }, { uuid: "d3" }] },
      };
    }, "drivers", { limit: 2 }),
    Error,
    "mais registos do que o limite",
  );
  assertEquals(calls, 1);
});
