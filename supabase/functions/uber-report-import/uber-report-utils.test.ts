import {
  baseDates, clockMinutes, detectDelimiter, fetchPaginatedRestRows, integerValue, localLisbonTimestamp,
  minutes, numberValue, parseCsv, rateValue, uberStatusTimestamp, validatePeriodDates,
  validateRequiredPeriodDates
} from "./uber-report-utils.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
  }
}

function assertThrows(run: () => unknown, fragment: string): void {
  try {
    run();
  } catch (error) {
    if (error instanceof Error && error.message.includes(fragment)) return;
    throw error;
  }
  throw new Error("Expected an error containing: " + fragment);
}

Deno.test("Uber CSV parser handles delimiters, quoted semicolons, escaped quotes and newlines", () => {
  const csv = "\uFEFFNome;Valor;Notas\r\n\"Ana; Joana\";\"1.234,56 €\";\"disse \"\"sim\"\"\r\nlinha 2\"\r\n";
  assertEquals(detectDelimiter(csv), ";");
  assertEquals(parseCsv(csv), [{ Nome: "Ana; Joana", Valor: "1.234,56 €", Notas: 'disse "sim"\r\nlinha 2' }]);
  assertEquals(parseCsv('uuid,nota\r\n1,"linha 1\nlinha 2"\r\n'), [{ uuid: "1", nota: "linha 1\nlinha 2" }]);
  assertEquals(parseCsv("\uFEFF"), []);
});

Deno.test("Uber CSV parser rejects malformed quoting", () => {
  assertThrows(() => parseCsv('uuid;nota\n1;"sem fecho'), "não foi fechado");
});

Deno.test("Uber numeric and rate parsing is locale-aware and rejects malformed values", () => {
  assertEquals(numberValue("1.234,56 €"), 1234.56);
  assertEquals(numberValue("1,234.56"), 1234.56);
  assertEquals(numberValue("-12,5"), -12.5);
  assertEquals(numberValue(""), null);
  assertThrows(() => numberValue("12abc"), "numérico inválido");
  assertEquals(integerValue("2.000,0"), 2000);
  assertThrows(() => integerValue("2,5"), "inteira não negativa");
  assertEquals(rateValue("12,5%"), 0.125);
  assertEquals(rateValue("0,5"), 0.5);
  assertThrows(() => rateValue("120%"), "entre 0% e 100%");
});

Deno.test("Uber duration parsers distinguish days-hours-minutes from clock duration", () => {
  assertEquals(minutes("1:02:03"), 1563);
  assertEquals(minutes(""), null);
  assertThrows(() => minutes("0:24:00"), "horas devem ser");
  assertEquals(clockMinutes("00:07:60"), 8);
  assertEquals(clockMinutes("25:01:30"), 1501);
  assertThrows(() => clockMinutes("00:00:61"), "minutos devem ser");
});

Deno.test("Uber status timestamps validate explicit offsets and fractions", () => {
  assertEquals(uberStatusTimestamp("2026-10-14 15:03:37.044 +0100 WEST"), "2026-10-14T15:03:37.044+01:00");
  assertEquals(uberStatusTimestamp("2026-01-14 15:03:37 +0000 WET"), "2026-01-14T15:03:37+00:00");
  assertThrows(() => uberStatusTimestamp("2026-02-31 15:03:37 +0000"), "data, hora e fuso");
  assertThrows(() => uberStatusTimestamp("2026-10-14 15:03:37 +1500"), "data, hora e fuso");
});

Deno.test("Uber trip timestamps resolve Lisbon seasons and reject daylight-saving gaps/folds", () => {
  assertEquals(localLisbonTimestamp("2026-01-15 12:34:56"), "2026-01-15T12:34:56+00:00");
  assertEquals(localLisbonTimestamp("2026-07-15 12:34:56"), "2026-07-15T12:34:56+01:00");
  assertThrows(() => localLisbonTimestamp("2026-03-29 01:30:00"), "inexistente em Lisboa");
  assertThrows(() => localLisbonTimestamp("2026-10-25 01:30:00"), "ambígua em Lisboa");
  assertThrows(() => localLisbonTimestamp("2026-02-31 12:00:00"), "confirme o dia");
});

Deno.test("Uber period and base-date helpers validate calendar dates", () => {
  assertEquals(baseDates("", ""), { period_start: null, period_end: null });
  assertEquals(baseDates("2026-10-01", "2026-10-31"), { period_start: "2026-10-01", period_end: "2026-10-31" });
  validatePeriodDates("2024-02-29", "2024-03-01");
  assertThrows(() => validatePeriodDates("2026-02-29", "2026-03-01"), "Data inicial inválida");
  assertThrows(() => validatePeriodDates("2026-10-02", "2026-10-01"), "posterior à data final");
});

Deno.test("Uber aggregate reports require both period dates for idempotent imports", () => {
  validateRequiredPeriodDates("2026-10-01", "2026-10-31");
  assertThrows(() => validateRequiredPeriodDates(null, null), "exige as datas inicial e final");
  assertThrows(() => validateRequiredPeriodDates("2026-10-01", null), "exige as datas inicial e final");
  assertThrows(() => validateRequiredPeriodDates(null, "2026-10-31"), "exige as datas inicial e final");
  assertThrows(() => validateRequiredPeriodDates("2026-02-30", "2026-03-01"), "Data inicial inválida");
  assertThrows(() => validateRequiredPeriodDates("2026-10-02", "2026-10-01"), "posterior à data final");
});

Deno.test("Supabase REST matching reads every page with stable offset and ordering", async () => {
  const requested: URL[] = [];
  const fakeFetch: typeof fetch = async (input) => {
    const url = new URL(String(input));
    requested.push(url);
    const rows = url.searchParams.get("offset") === "0"
      ? [{ id: "a" }, { id: "b" }]
      : [{ id: "c" }];
    return new Response(JSON.stringify(rows), { status: 200 });
  };
  const rows = await fetchPaginatedRestRows(
    fakeFetch,
    "https://database.example/",
    "drivers?company_id=eq.tenant&select=id",
    { apikey: "test" },
    2,
  );
  assertEquals(rows, [{ id: "a" }, { id: "b" }, { id: "c" }]);
  assertEquals(requested.map(url => url.searchParams.get("offset")), ["0", "2"]);
  assertEquals(requested.map(url => url.searchParams.get("limit")), ["2", "2"]);
  assertEquals(requested[0].searchParams.get("order"), "id.asc");
});

Deno.test("Supabase REST matching rejects malformed and repeated pages", async () => {
  const malformedFetch: typeof fetch = async () => new Response(JSON.stringify({ rows: [] }), { status: 200 });
  await assertRejects(
    () => fetchPaginatedRestRows(malformedFetch, "https://database.example", "drivers?select=id", {}, 2),
    "não devolveu uma lista",
  );

  const repeatedFetch: typeof fetch = async () => new Response(JSON.stringify([{ id: "same-1" }, { id: "same-2" }]), { status: 200 });
  await assertRejects(
    () => fetchPaginatedRestRows(repeatedFetch, "https://database.example", "drivers?select=id", {}, 2),
    "repetiu uma página",
  );
});

async function assertRejects(action: () => Promise<unknown>, fragment: string): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (error instanceof Error && error.message.includes(fragment)) return;
    throw error;
  }
  throw new Error("Expected a rejected operation containing: " + fragment);
}
