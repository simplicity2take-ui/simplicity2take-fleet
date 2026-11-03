function detectDelimiter(text: string): string {
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
  return records.slice(1).map(values =>
    Object.fromEntries(headers.map((header, i) => [header, (values[i] ?? "").trim()]))
  );
}
export function numberValue(v: string) {
  if (!v) return null;
  let normalized = String(v).trim().replace(/[%€$£\s]/g, "");
  if (!normalized) return null;
  const comma = normalized.lastIndexOf(",");
  const dot = normalized.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    if (comma > dot) normalized = normalized.replace(/\./g, "").replace(",", ".");
    else normalized = normalized.replace(/,/g, "");
  } else if (comma >= 0) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  }
  normalized = normalized.replace(/[^0-9+\-.]/g, "");
  const n = Number(normalized);
  return normalized && Number.isFinite(n) ? n : null;
}
async function getRestRows(path: string) {
  const response = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: "Bearer " + SERVICE_ROLE_KEY }
  });
  if (!response.ok) {
    const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 300);
    const label = path.split("?")[0].replace(/[^a-zA-Z0-9_./-]/g, "").slice(0, 100);
    console.error("uber-report-import getRestRows failed", { status: response.status, path: label, detail });
    throw new Error("Falha ao consultar correspondências internas (" + response.status + ") em " + label + (detail ? ": " + detail : "."));
  }
  return await response.json();
}
export function localLisbonTimestamp(value: string) {
  if (!value) return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!match) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  const [, year, month, day, hour, minute, second] = match;
  const probe = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
  const zone = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Lisbon", timeZoneName: "shortOffset" })
    .formatToParts(probe).find(part => part.type === "timeZoneName")?.value || "GMT+0";
  const offset = zone.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  const suffix = offset ? offset[1] + offset[2].padStart(2, "0") + ":" + (offset[3] || "00") : "+00:00";
  return year + "-" + month + "-" + day + "T" + hour + ":" + minute + ":" + second + suffix;
}
export function rateValue(v: string) {
  const n = numberValue(v);
  if (n === null) return null;
  return v.includes("%") ? n / 100 : n;
}
export function minutes(v: string) {
  if (!v) return null;
  const p = v.split(":").map(Number);
  if (p.some(Number.isNaN)) return null;
  if (p.length === 3) return p[0] * 24 * 60 + p[1] * 60 + p[2];
  return null;
}
async function rpc(name: string, body: unknown) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": SERVICE_ROLE_KEY, "Authorization": `Bearer ${SERVICE_ROLE_KEY}` },
    body: JSON.stringify(body)
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${name}: ${r.status} ${text}`);
  return JSON.parse(text);
}
export function baseDates(periodStart: string | null, periodEnd: string | null) {
  return { period_start: periodStart || null, period_end: periodEnd || null };
}
