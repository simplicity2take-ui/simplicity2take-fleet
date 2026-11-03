import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { baseDates, detectDelimiter, localLisbonTimestamp, minutes, numberValue, parseCsv, rateValue } from "./uber-report-utils.ts";

Deno.test("Uber CSV parser respects quoted semicolons and escaped quotes", () => {
  const csv = "\uFEFFNome;Valor;Notas\r\n\"Ana; Joana\";\"1.234,56 €\";\"disse \"\"sim\"\"\"\r\n";
  assertEquals(detectDelimiter(csv), ";");
  assertEquals(parseCsv(csv), [{ Nome: "Ana; Joana", Valor: "1.234,56 €", Notas: 'disse "sim"' }]);
});

Deno.test("Uber CSV parser preserves line breaks inside quoted fields", () => {
  assertEquals(parseCsv('uuid,nota\r\n1,"linha 1\nlinha 2"\r\n'), [{ uuid: "1", nota: "linha 1\nlinha 2" }]);
});

Deno.test("Uber CSV parser rejects unclosed quotes", () => {
  assertThrows(() => parseCsv('uuid;nota\n1;"sem fecho'), Error, "não foi fechado");
});

Deno.test("Uber numeric parser handles Portuguese and English decimals", () => {
  assertEquals(numberValue("1.234,56 €"), 1234.56);
  assertEquals(numberValue("1,234.56"), 1234.56);
  assertEquals(numberValue("-12,5"), -12.5);
  assertEquals(numberValue(""), null);
  assertEquals(numberValue("N/A"), null);
});

Deno.test("Uber rates convert percentages and preserve decimal fractions", () => {
  assertEquals(rateValue("12,5%"), 0.125);
  assertEquals(rateValue("0,5"), 0.5);
  assertEquals(rateValue(""), null);
});

Deno.test("Uber duration parser converts days, hours and minutes", () => {
  assertEquals(minutes("1:02:03"), 1503);
  assertEquals(minutes("0:00:45"), 45);
  assertEquals(minutes(""), null);
  assertEquals(minutes("01:20"), null);
  assertEquals(minutes("x:1:2"), null);
});

Deno.test("Uber timestamps use Lisbon winter and summer offsets", () => {
  assertEquals(localLisbonTimestamp("2026-01-15 12:34:56"), "2026-01-15T12:34:56+00:00");
  assertEquals(localLisbonTimestamp("2026-07-15 12:34:56"), "2026-07-15T12:34:56+01:00");
  assertEquals(localLisbonTimestamp("not-a-date"), null);
  assertEquals(localLisbonTimestamp("2026-07-15T11:34:56Z"), "2026-07-15T11:34:56.000Z");
});

Deno.test("Uber import normalizes absent period boundaries", () => {
  assertEquals(baseDates("", ""), { period_start: null, period_end: null });
  assertEquals(baseDates("2026-10-01", "2026-10-31"), { period_start: "2026-10-01", period_end: "2026-10-31" });
});
