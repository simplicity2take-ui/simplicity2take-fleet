export function detectDelimiter(text: string): string {
  const firstLine = text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] || "";
  const candidates = [",", ";", "\t"];
  const countOutsideQuotes = (line: string, delimiter: string) => {
    let quoted = false, count = 0;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') {
        if (quoted && line[i + 1] === '"') i++;
        else quoted = !quoted;
      } else if (line[i] === delimiter && !quoted) count++;
    }
    return count;
  };
  return candidates.sort((a, b) => countOutsideQuotes(firstLine, b) - countOutsideQuotes(firstLine, a))[0];
}

export function parseCsv(text: string) {
  const source = text.replace(/^\uFEFF/, "");
  if (!source.trim()) return [];
  const delimiter = detectDelimiter(source);
  const records: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"') {
      if (quoted && source[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (c === delimiter && !quoted) {
      row.push(cell); cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && source[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some(value => value.trim())) records.push(row);
      row = [];
    } else cell += c;
  }
  if (quoted) throw new Error("CSV inválido: existe um campo entre aspas que não foi fechado.");
  row.push(cell);
  if (row.some(value => value.trim())) records.push(row);
  if (!records.length) return [];
  const headers = records[0].map(value => value.trim());
  if (!headers.some(Boolean)) return [];
  const namedHeaders = headers.filter(Boolean);
  if (new Set(namedHeaders).size !== namedHeaders.length) {
    throw new Error("CSV inválido: existem cabeçalhos duplicados.");
  }
  const unnamedColumns = headers.flatMap((header, index) => header ? [] : [index]);
  const dataRows = records.slice(1);
  for (let index = 0; index < dataRows.length; index++) {
    const values = dataRows[index];
    if (values.length !== headers.length) {
      throw new Error("CSV inválido: o registo " + (index + 2) + " tem um número incorreto de colunas.");
    }
    if (unnamedColumns.length > 1 && unnamedColumns.some(column => values[column].trim())) {
      throw new Error("CSV inválido: várias colunas sem nome contêm dados ambíguos.");
    }
  }
  return dataRows.map(values =>
    Object.fromEntries(headers.map((header, i) => [header, values[i].trim()]))
  );
}

export function numberValue(v: string) {
  const input = String(v ?? "").trim();
  if (!input) return null;
  let normalized = input.replace(/[€$£%\s\u00a0]/g, "");
  if (!normalized) return null;
  const comma = normalized.lastIndexOf(",");
  const dot = normalized.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    if (comma > dot) normalized = normalized.replace(/\./g, "").replace(",", ".");
    else normalized = normalized.replace(/,/g, "");
  } else if (comma >= 0) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  }
  // Reject malformed values instead of stripping arbitrary characters
  // (which could silently turn e.g. "12abc" into 12).
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) {
    throw new Error("Valor numérico inválido no CSV: " + input.slice(0, 40));
  }
  const n = Number(normalized);
  if (!Number.isFinite(n)) throw new Error("Valor numérico fora do intervalo permitido.");
  return n;
}

export function uberStatusTimestamp(v: string) {
  const input = String(v || "").trim();
  if (!input) return null;
  // Uber status exports include an explicit numeric offset and a timezone label,
  // e.g. "2026-10-14 15:03:37.044 +0100 WEST".
  const match = input.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))? ([+-])(\d{2})(\d{2})(?: [A-Za-z_+-]+)?$/);
  if (!match) throw new Error("Última vez online inválida no CSV: formato de data/hora não reconhecido.");
  const [, year, month, day, hour, minute, second, fraction = "", sign, offsetHour, offsetMinute] = match;
  const [y, mo, d, h, mi, sec, oh, om] = [year, month, day, hour, minute, second, offsetHour, offsetMinute].map(Number);
  const probe = new Date(Date.UTC(y, mo - 1, d, h, mi, sec));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 ||
      probe.getUTCDate() !== d || h > 23 || mi > 59 || sec > 59 ||
      oh > 14 || om > 59 || (oh === 14 && om !== 0)) {
    throw new Error("Última vez online inválida no CSV: confirme a data, hora e fuso horário.");
  }
  const milliseconds = (fraction + "000").slice(0, 3);
  return year + "-" + month + "-" + day + "T" + hour + ":" + minute + ":" + second +
    (milliseconds !== "000" ? "." + milliseconds : "") + sign + offsetHour + ":" + offsetMinute;
}

export function localLisbonTimestamp(value: string) {
  const input = String(value || "").trim();
  if (!input) return null;
  // Uber trip exports contain Lisbon wall-clock time without an offset.
  // Resolve the actual UTC instant by testing both Lisbon offsets around the
  // date; never infer the offset from the same wall-clock value treated as UTC.
  const match = input.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!match) throw new Error("Data/hora de viagem inválida: utilize AAAA-MM-DD HH:MM:SS.");
  const [, year, month, day, hour, minute, second] = match;
  const [y, m, d, h, min, sec] = [year, month, day, hour, minute, second].map(Number);
  const wallUtc = Date.UTC(y, m - 1, d, h, min, sec);
  const wallProbe = new Date(wallUtc);
  if (wallProbe.getUTCFullYear() !== y || wallProbe.getUTCMonth() !== m - 1 ||
      wallProbe.getUTCDate() !== d || h > 23 || min > 59 || sec > 59) {
    throw new Error("Data/hora de viagem inválida: confirme o dia e a hora no CSV.");
  }
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  });
  const localPartsAt = (timestamp: number) => {
    const values = Object.fromEntries(formatter.formatToParts(new Date(timestamp))
      .filter(part => part.type !== "literal").map(part => [part.type, Number(part.value)]));
    return [values.year, values.month, values.day, values.hour, values.minute, values.second];
  };
  const offsets = new Set<number>();
  for (const probe of [wallUtc - 36 * 60 * 60 * 1000, wallUtc, wallUtc + 36 * 60 * 60 * 1000]) {
    const [py, pm, pd, ph, pmin, ps] = localPartsAt(probe);
    offsets.add((Date.UTC(py, pm - 1, pd, ph, pmin, ps) - probe) / 60000);
  }
  const expected = [y, m, d, h, min, sec];
  const candidates = Array.from(offsets).map(offset => ({
    offset, timestamp: wallUtc - offset * 60000
  })).filter(candidate => localPartsAt(candidate.timestamp).every((part, index) => part === expected[index]));
  if (candidates.length === 0) {
    throw new Error("Data/hora de viagem inexistente em Lisboa devido à mudança da hora.");
  }
  if (candidates.length > 1) {
    throw new Error("Data/hora de viagem ambígua em Lisboa devido à mudança da hora; é necessária confirmação.");
  }
  const offset = candidates[0].offset;
  const sign = offset >= 0 ? "+" : "-";
  const absolute = Math.abs(offset);
  const suffix = sign + String(Math.floor(absolute / 60)).padStart(2, "0") + ":" +
    String(absolute % 60).padStart(2, "0");
  return year + "-" + month + "-" + day + "T" + hour + ":" + minute + ":" + second + suffix;
}

export function integerValue(v: string, fieldName = "quantidade") {
  const n = numberValue(v);
  if (n === null) return null;
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error("Valor inválido em " + fieldName + ": é esperada uma quantidade inteira não negativa.");
  }
  return n;
}

export function rateValue(v: string) {
  const n = numberValue(v);
  if (n === null) return null;
  const rate = v.includes("%") ? n / 100 : n;
  if (rate < 0 || rate > 1) {
    throw new Error("Taxa inválida no CSV: é esperado um valor entre 0% e 100%.");
  }
  return rate;
}

export function minutes(v: string, fieldName = "duração") {
  const input = String(v || "").trim();
  if (!input) return null;
  // Uber duration columns are exported as days:hours:minutes.
  const match = input.match(/^(\d+):(\d{1,2}):(\d{1,2})$/);
  if (!match) throw new Error("Valor inválido em " + fieldName + ": utilize dias:horas:minutos.");
  const days = Number(match[1]);
  const hours = Number(match[2]);
  const mins = Number(match[3]);
  if (!Number.isSafeInteger(days) || hours > 23 || mins > 59) {
    throw new Error("Duração inválida em " + fieldName + ": horas devem ser 0–23 e minutos 0–59.");
  }
  const total = days * 24 * 60 + hours * 60 + mins;
  if (!Number.isSafeInteger(total)) throw new Error("Duração demasiado elevada em " + fieldName + ".");
  return total;
}

export function clockMinutes(v: string, fieldName = "duração") {
  const input = String(v || "").trim();
  if (!input) return null;
  // Uber time-and-distance reports use HH:MM:SS, unlike driver activity's
  // D:HH:MM columns. Preserve the original value in raw and store whole minutes.
  const match = input.match(/^(\d+):(\d{2}):(\d{2})$/);
  if (!match) throw new Error("Valor inválido em " + fieldName + ": utilize horas:minutos:segundos.");
  const hours = Number(match[1]);
  const mins = Number(match[2]);
  const seconds = Number(match[3]);
  if (!Number.isSafeInteger(hours) || mins > 59 || seconds > 60) {
    throw new Error("Duração inválida em " + fieldName + ": minutos devem ser 0–59 e segundos 0–60.");
  }
  const totalSeconds = hours * 3600 + mins * 60 + seconds;
  if (!Number.isSafeInteger(totalSeconds)) throw new Error("Duração demasiado elevada em " + fieldName + ".");
  // Some supplied Uber exports contain 60 seconds (e.g. 00:07:60).
  // Treat it as the next minute; raw retains the exact source value.
  return Math.floor(totalSeconds / 60);
}

export function validatePeriodDates(periodStart: string | null, periodEnd: string | null) {
  const isCalendarDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day;
  };
  if (periodStart && !isCalendarDate(periodStart)) {
    throw new Error("Data inicial inválida. Utilize o formato AAAA-MM-DD.");
  }
  if (periodEnd && !isCalendarDate(periodEnd)) {
    throw new Error("Data final inválida. Utilize o formato AAAA-MM-DD.");
  }
  if (periodStart && periodEnd && periodStart > periodEnd) {
    throw new Error("O período do relatório é inválido: a data inicial é posterior à data final.");
  }
}

export function validateRequiredPeriodDates(periodStart: string | null, periodEnd: string | null) {
  validatePeriodDates(periodStart, periodEnd);
  if (!periodStart || !periodEnd) {
    throw new Error("O relatório agregado exige as datas inicial e final. Inclua-as no nome do ficheiro (AAAAMMDD-AAAAMMDD).");
  }
}

export function baseDates(periodStart: string | null, periodEnd: string | null) {
  return { period_start: periodStart || null, period_end: periodEnd || null };
}

/** Read a Supabase REST collection page by page without silently truncating at the 1000-row default. */
export async function fetchPaginatedRestRows(
  fetcher: typeof fetch,
  baseUrl: string,
  path: string,
  headers: HeadersInit,
  pageSize = 1000,
): Promise<any[]> {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
    throw new Error("O tamanho da página REST tem de estar entre 1 e 1000.");
  }
  const label = path.split("?")[0].replace(/[^a-zA-Z0-9_./-]/g, "").slice(0, 100);
  const endpoint = new URL(baseUrl.replace(/\/+$/, "") + "/rest/v1/" + path);
  if (!endpoint.searchParams.has("order")) endpoint.searchParams.set("order", "id.asc");

  const rows: any[] = [];
  const seenPages = new Set<string>();
  let offset = 0;
  for (let pageNumber = 0; pageNumber < 10000; pageNumber++) {
    endpoint.searchParams.set("limit", String(pageSize));
    endpoint.searchParams.set("offset", String(offset));
    const response = await fetcher(endpoint.toString(), { headers });
    if (!response.ok) {
      const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 300);
      throw new Error("Falha ao consultar correspondências internas (" + response.status + ") em " + label + (detail ? ": " + detail : "."));
    }

    let page: unknown;
    try {
      page = await response.json();
    } catch {
      throw new Error("Resposta REST inválida em " + label + ".");
    }
    if (!Array.isArray(page)) throw new Error("A consulta REST não devolveu uma lista em " + label + ".");
    if (page.length > pageSize) throw new Error("A consulta REST excedeu o limite pedido em " + label + ".");
    if (page.length === 0) return rows;

    const fingerprint = JSON.stringify(page);
    if (seenPages.has(fingerprint)) throw new Error("A paginação REST repetiu uma página em " + label + ".");
    seenPages.add(fingerprint);
    rows.push(...page);
    if (page.length < pageSize) return rows;
    offset += page.length;
  }

  throw new Error("A paginação REST excedeu o limite de segurança em " + label + ".");
}
