import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
function parseCsv(text: string) {
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
function numberValue(v: string) {
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
function uberStatusTimestamp(v: string) {
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
function localLisbonTimestamp(value: string) {
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
function integerValue(v: string, fieldName = "quantidade") {
  const n = numberValue(v);
  if (n === null) return null;
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error("Valor inválido em " + fieldName + ": é esperada uma quantidade inteira não negativa.");
  }
  return n;
}
function rateValue(v: string) {
  const n = numberValue(v);
  if (n === null) return null;
  const rate = v.includes("%") ? n / 100 : n;
  if (rate < 0 || rate > 1) {
    throw new Error("Taxa inválida no CSV: é esperado um valor entre 0% e 100%.");
  }
  return rate;
}
function minutes(v: string, fieldName = "duração") {
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
function clockMinutes(v: string, fieldName = "duração") {
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
function validatePeriodDates(periodStart: string | null, periodEnd: string | null) {
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
function baseDates(periodStart: string | null, periodEnd: string | null) {
  return { period_start: periodStart || null, period_end: periodEnd || null };
}

Deno.serve(async (req) => {
  const response = await (async () => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Método não permitido" }), {
      status: 405,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Allow": "POST, OPTIONS" }
    });
  }
  try {
    const auth = req.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) return new Response(JSON.stringify({ error: "Não autenticado" }), { status: 401, headers: { "Content-Type": "application/json" } });
    const token = auth.slice(7);
    const me = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` } });
    if (!me.ok) return new Response(JSON.stringify({ error: "Sessão inválida" }), { status: 401, headers: { "Content-Type": "application/json" } });

    // This import endpoint uses the service-role key and performs company-wide
    // writes. Until tenant-aware import workflows exist, restrict it server-side
    // to active global administrators (UI visibility is not an authorization boundary).
    const authenticatedUser = await me.json();
    const adminProfiles = await getRestRows(
      "profiles?select=id,role,status&id=eq." + encodeURIComponent(authenticatedUser.id) + "&role=eq.admin&limit=1"
    );
    const isActiveGlobalAdmin = (adminProfiles as any[]).some(profile =>
      profile.id === authenticatedUser.id && profile.role === "admin" &&
      (profile.status == null || profile.status === "Ativo")
    );
    if (!isActiveGlobalAdmin) {
      return new Response(JSON.stringify({ error: "Sem permissões para importar relatórios." }), {
        status: 403,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
      });
    }

    // This endpoint remains an S2T global-admin workflow until every Uber RPC
    // has an explicit tenant parameter and company-scoped SQL implementation.
    // Resolve the owning company on the server; never accept company_id from CSV,
    // query parameters or the browser.
    const companies = await getRestRows(
      "companies?select=id,slug,status&slug=eq.simplicity2take&status=eq.Ativa&limit=1"
    );
    const companyId = String((companies as any[])[0]?.id || "");
    if (!companyId) {
      return new Response(JSON.stringify({ error: "Empresa de importação não configurada." }), {
        status: 409,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
      });
    }

    const url = new URL(req.url);
    const requestedType = url.searchParams.get("type") || "status";
    // The frontend uses a hyphenated type for individual trip CSV previews.
    const type = requestedType === "trip-activity" ? "trip_activity" : requestedType;
    const periodStart = url.searchParams.get("period_start");
    const periodEnd = url.searchParams.get("period_end");
    if (type !== "status" && type !== "trip_activity") {
      validatePeriodDates(periodStart, periodEnd);
    }
    const rows = parseCsv(await req.text());
    if (!rows.length) throw new Error("CSV vazio ou sem linhas de dados.");
    const headers = new Set(Object.keys(rows[0] || {}));
    const requireHeaders = (names: string[], description: string) => {
      const missing = names.filter(name => !headers.has(name));
      if (missing.length) {
        throw new Error("CSV de " + description + " incompleto. Colunas em falta: " + missing.join(", ") + ".");
      }
    };
    const requireAnyHeader = (names: string[], description: string) => {
      if (!names.some(name => headers.has(name))) {
        throw new Error("Este CSV não parece ser um relatório de " + description + ". Colunas esperadas: " + names.join(" ou ") + ".");
      }
    };
    if (type === "status") {
      requireHeaders(["UUID do motorista", "Estado", "Última vez online"], "estado dos motoristas");
    } else if (type === "activity") {
      requireHeaders(["UUID do motorista", "Viagens concluídas", "Tempo online (dias: horas: minutos)", "Tempo em viagem (dias: horas: minutos)"], "atividade dos motoristas");
    } else if (type === "driver_time_distance") {
      requireHeaders(["UUID do motorista", "Hora de abertura", "Tempo em rota", "Tempo em viagem", "Tempo indisponível", "Distância livre", "Distância em rota", "Distância em viagem", "Distância indisponível"], "tempo e distância dos motoristas");
    } else if (type === "driver_quality") {
      requireHeaders(["UUID do motorista", "Viagens concluídas", "Taxa de aceitação", "Taxa de cancelamento", "Taxa de conclusão", "Classificações do motorista (últimas 4 semanas)", "Classificações do motorista (500 viagens anteriores)", "Taxa de aceitação atual do motorista, tal como apresentada na aplicação para motoristas", "Taxa de cancelamento atual do motorista, tal como apresentada na aplicação para motoristas", "Viagens aceites (excluindo radar de viagem ou semelhante)", "Viagens rejeitadas", "Viagens Canceladas", "Viagens canceladas por motoristas responsáveis", "Falha nas viagens", "Total de Atribuições de Viagens"], "qualidade dos motoristas");
    } else if (type === "driver_payments") {
      requireHeaders(["UUID do motorista", "Pago a si", "Pago a si : Os seus rendimentos"], "pagamentos dos motoristas");
      requireAnyHeader(["Pago a si : Os seus rendimentos : Taxa de serviço", "Pago a si:Os seus rendimentos:Taxa de serviço"], "pagamentos dos motoristas");
      requireAnyHeader(["Pago a si : Saldo da viagem : Reembolsos : Portagem", "Pago a si:Saldo da viagem:Reembolsos:Portagem"], "pagamentos dos motoristas");
      requireAnyHeader(["Pago a si : Os seus rendimentos : Gratificação", "Pago a si:Os seus rendimentos:Gratificação"], "pagamentos dos motoristas");
      requireAnyHeader(["Pago a si : Os seus rendimentos : Outros rendimentos : Ajustes após a viagem", "Pago a si:Os seus rendimentos:Outros rendimentos:Ajustes após a viagem"], "pagamentos dos motoristas");
    } else if (type === "vehicle_performance") {
      requireHeaders(["UUID do veículo", "Número da matrícula do veículo", "Rendimentos totais", "Rendimentos/hora", "Dinheiro recebido", "Viagens/hora", "Horas online", "Horas em viagem", "Horas de trabalho", "Total Trips", "Acceptance Rate", "Taxa de cancelamento", "Viagens aceites (excluindo radar de viagem ou semelhante)", "Viagens rejeitadas", "Viagens Canceladas", "Falha nas viagens", "Total de Atribuições de Viagens"], "desempenho de viaturas");
    } else if (type === "vehicle_time_distance") {
      requireHeaders(["UUID do veículo", "Matrícula do veículo", "Hora de abertura", "Tempo em rota", "Tempo em viagem", "Tempo indisponível", "Distância livre", "Distância em rota", "Distância em viagem", "Distância indisponível"], "tempo e distância de viaturas");
    } else if (type === "trip_activity") {
      requireAnyHeader(["UUID do motorista"], "motoristas");
    } else {
      throw new Error("Tipo de relatório inválido");
    }

    // Every data row must carry its platform identity. Driver RPCs otherwise
    // silently skip rows with an empty UUID, while vehicle RPCs hit NOT NULL
    // constraints and fail the whole batch. Reject the CSV before any RPC call.
    const identityHeader = type.startsWith("vehicle_") ? "UUID do veículo" : "UUID do motorista";
    const rowsWithoutIdentity = rows
      .map((row, index) => ({ rowNumber: index + 2, value: String(row[identityHeader] || "").trim() }))
      .filter(item => !item.value);
    if (rowsWithoutIdentity.length) {
      const examples = rowsWithoutIdentity.slice(0, 5).map(item => String(item.rowNumber)).join(", ");
      throw new Error("CSV inválido: existem " + rowsWithoutIdentity.length +
        " linhas sem " + identityHeader + " (linha(s): " + examples + ").");
    }

    if (type === "trip_activity") {
      const requiredTripHeaders = ["UUID da viagem", "UUID do motorista", "Estado da viagem"];
      const missingTripHeaders = requiredTripHeaders.filter(name => !headers.has(name));
      if (missingTripHeaders.length) throw new Error("CSV de viagens incompleto. Colunas em falta: " + missingTripHeaders.join(", ") + ".");
      const driverRows = await getRestRows("drivers?select=id,uber_driver_uuid,full_name&company_id=eq." + encodeURIComponent(companyId) + "&limit=1000");
      const vehicleRows = await getRestRows("vehicles?select=id,uber_vehicle_uuid,plate&company_id=eq." + encodeURIComponent(companyId) + "&limit=1000");
      const buildUniqueIdMap = (items: any[], keyOf: (item: any) => string) => {
        const matches = new Map<string, string[]>();
        for (const item of items) {
          const key = keyOf(item);
          if (!key) continue;
          const ids = matches.get(key) || [];
          ids.push(item.id);
          matches.set(key, ids);
        }
        return new Map(Array.from(matches.entries()).map(([key, ids]) => [key, ids.length === 1 ? ids[0] : null]));
      };
      const driversByUuid = buildUniqueIdMap(driverRows, item => String(item.uber_driver_uuid || ""));
      const normalizePersonName = (value: string) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-PT");
      const driverIdsByName = new Map<string, string[]>();
      for (const driver of driverRows as any[]) {
        const normalizedName = normalizePersonName(driver.full_name || "");
        if (!normalizedName) continue;
        const ids = driverIdsByName.get(normalizedName) || [];
        ids.push(driver.id);
        driverIdsByName.set(normalizedName, ids);
      }
      const vehiclesByUuid = buildUniqueIdMap(vehicleRows, item => String(item.uber_vehicle_uuid || ""));
      const vehiclesByPlate = buildUniqueIdMap(vehicleRows, item => String(item.plate || "").replace(/[^A-Z0-9]/gi, "").toUpperCase());
      const normalized = rows.map(r => {
        const tripId = (r["UUID da viagem"] || "").trim();
        if (tripId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tripId)) {
          throw new Error("O CSV contém um UUID de viagem inválido: " + tripId);
        }
        const driverUuid = (r["UUID do motorista"] || "").trim();
        const driverName = ((r["Nome próprio do motorista"] || "") + " " + (r["Apelido do motorista"] || "")).trim();
        const nameMatches = driverIdsByName.get(normalizePersonName(driverName)) || [];
        const matchedDriverId = driversByUuid.get(driverUuid) || (nameMatches.length === 1 ? nameMatches[0] : null);
        const vehicleUuid = (r["UUID do veículo"] || "").trim();
        const plate = (r["Matrícula"] || "").trim();
        const normalizedPlate = plate.replace(/[^A-Z0-9]/gi, "").toUpperCase();
        const status = (r["Estado da viagem"] || "").trim().toLowerCase();
        const requestedAt = localLisbonTimestamp(r["Hora do pedido de viagem"] || "");
        const arrivedAt = localLisbonTimestamp(r["Hora de chegada da viagem"] || "");
        const completed = status === "completed";
        return {
          company_id: companyId,
          platform: "uber",
          source_trip_id: tripId,
          driver_id: matchedDriverId,
          vehicle_id: vehiclesByUuid.get(vehicleUuid) || vehiclesByPlate.get(normalizedPlate) || null,
          platform_driver_uuid: driverUuid || null,
          platform_vehicle_uuid: vehicleUuid || null,
          vehicle_plate: plate || null,
          order_status: status || null,
          accepted_at: null,
          pickup_at: null,
          dropoff_at: completed ? arrivedAt : null,
          finished_at: completed ? arrivedAt : null,
          ride_distance_km: numberValue(r["Distância da viagem"] || ""),
          observed_at: arrivedAt || requestedAt || new Date().toISOString()
        };
      }).filter(r => r.source_trip_id);
      if (!normalized.length) throw new Error("O CSV não contém UUIDs de viagem válidos.");
      const tripsById = new Map<string, any>();
      for (const trip of normalized as any[]) {
        const previous = tripsById.get(trip.source_trip_id);
        if (previous && JSON.stringify(previous) !== JSON.stringify(trip)) {
          throw new Error("O UUID de viagem " + trip.source_trip_id + " aparece repetido com dados diferentes no CSV. Corrija o ficheiro antes de importar.");
        }
        if (!previous) tripsById.set(trip.source_trip_id, trip);
      }
      const uniqueTrips = Array.from(tripsById.values());
      const duplicateRowsInCsv = normalized.length - uniqueTrips.length;
      const linkedDrivers = uniqueTrips.filter((r: any) => r.driver_id).length;
      const linkedVehicles = uniqueTrips.filter((r: any) => r.vehicle_id).length;
      const tripIds = uniqueTrips.map((r: any) => String(r.source_trip_id));
      const validUuidTripIds = tripIds.filter((id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id));
      // Query existing trip IDs in small batches to avoid excessively long PostgREST URLs.
      const existingRows: any[] = [];
      for (let i = 0; i < validUuidTripIds.length; i += 50) {
        const batch = validUuidTripIds.slice(i, i + 50);
        const batchRows = await getRestRows("platform_trip_records?select=source_trip_id&platform=eq.uber&company_id=eq." + encodeURIComponent(companyId) + "&source_trip_id=in.(" + batch.join(",") + ")&limit=1000");
        existingRows.push(...batchRows);
      }
      const existingIds = new Set(existingRows.map(row => String(row.source_trip_id)));
      const alreadyImported = uniqueTrips.filter((row: any) => existingIds.has(String(row.source_trip_id))).length;
      const newTrips = uniqueTrips.length - alreadyImported;
      const unlinkedDrivers = uniqueTrips.length - linkedDrivers;
      const unlinkedVehicles = uniqueTrips.length - linkedVehicles;
      const preview = {
        totalRows: rows.length,
        validTrips: normalized.length,
        uniqueTrips: uniqueTrips.length,
        duplicateRowsInCsv,
        alreadyImported,
        newTrips,
        linkedDrivers,
        unlinkedDrivers,
        linkedVehicles,
        unlinkedVehicles,
        completedTrips: uniqueTrips.filter((row: any) => row.order_status === "completed").length
      };
      if (url.searchParams.get("dry_run") === "true") {
        return new Response(JSON.stringify({ ok: true, type, dry_run: true, result: preview }), {
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
        });
      }
      const importResult = await rpc("sync_uber_trip_activity", { p_trips: uniqueTrips });
      const saved = Number(importResult?.saved || 0);
      return new Response(JSON.stringify({
        ok: true, type, rows: uniqueTrips.length,
        result: { saved, skipped: rows.length - uniqueTrips.length + (uniqueTrips.length - saved), linkedDrivers, linkedVehicles, duplicateRowsInCsv, alreadyImported, newTrips }
      }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    }

    if (type === "status") {
      const normalizeIdentity = (value: string) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleUpperCase("pt-PT").replace(/[^A-Z0-9]+/g, " ").trim();
      const normalizePhone = (value: string) => String(value || "").replace(/\D/g, "");
      const isOrganizationRow = (r: any) => {
        const name = normalizeIdentity(r["Nome do motorista"] || "");
        const organization = normalizeIdentity(r["Nome da organização"] || "");
        return Boolean(name && organization && name === organization);
      };
      const organizationRowsSkipped = rows.filter(isOrganizationRow).length;
      const driverRows = rows.filter((r: any) => !isOrganizationRow(r));
      if (url.searchParams.get("dry_run") === "true") {
        const eligibleRows = driverRows.filter((r: any) =>
          String(r["UUID do motorista"] || "").trim() &&
          ["ACTIVE", "ACCEPTED"].includes(String(r["Estado"] || "").trim().toUpperCase())
        );
        const skippedRows = driverRows.length - eligibleRows.length;
        const seenUuids = new Set<string>();
        const seenEmails = new Map<string, string>();
        const seenPhones = new Map<string, string>();
        const matchedDriverIds = new Set<string>();
        let duplicateUuidRows = 0, matchedExisting = 0, wouldCreate = 0, ambiguousMatches = 0;
        const existingDrivers = await getRestRows("drivers?select=id,email,phone,uber_driver_uuid&company_id=eq." + encodeURIComponent(companyId) + "&limit=1000");
        for (const row of eligibleRows as any[]) {
          const uuid = String(row["UUID do motorista"] || "").trim();
          if (seenUuids.has(uuid)) duplicateUuidRows++;
          seenUuids.add(uuid);
          const email = String(row["E-mail do motorista"] || "").trim().toLowerCase();
          const phone = normalizePhone(row["Telemóvel"] || "");
          if (email && seenEmails.has(email) && seenEmails.get(email) !== uuid) ambiguousMatches++;
          if (phone && seenPhones.has(phone) && seenPhones.get(phone) !== uuid) ambiguousMatches++;
          if (email) seenEmails.set(email, uuid);
          if (phone) seenPhones.set(phone, uuid);
          const candidates = (existingDrivers as any[]).filter(driver =>
            (uuid && driver.uber_driver_uuid === uuid) ||
            (email && String(driver.email || "").trim().toLowerCase() === email) ||
            (phone && normalizePhone(driver.phone || "") === phone)
          );
          const candidateIds = new Set(candidates.map(driver => String(driver.id)));
          // A UUID match does not make conflicting email/phone matches safe.
          // Also prevent two distinct report rows from claiming the same internal driver.
          if (candidateIds.size > 1) {
            ambiguousMatches++;
          } else if (candidateIds.size === 1) {
            const matchedId = Array.from(candidateIds)[0];
            if (matchedDriverIds.has(matchedId)) ambiguousMatches++;
            else {
              matchedDriverIds.add(matchedId);
              matchedExisting++;
            }
          } else {
            wouldCreate++;
          }
        }
        return new Response(JSON.stringify({
          ok: true, type, dry_run: true, rows: rows.length,
          result: {
            totalRows: rows.length,
            organizationRowsSkipped,
            eligibleRows: eligibleRows.length,
            matchedExisting,
            wouldCreate,
            skippedRows,
            ambiguousMatches,
            duplicateUuidRows
          }
        }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
      }
      // Enforce the same safety checks on the server, not only in the UI.
      // Authenticated clients must not be able to bypass the preview/confirmation guard.
      const eligibleForImport = driverRows.filter((r: any) =>
        String(r["UUID do motorista"] || "").trim() &&
        ["ACTIVE", "ACCEPTED"].includes(String(r["Estado"] || "").trim().toUpperCase())
      );
      const existingForImport = await getRestRows("drivers?select=id,email,phone,uber_driver_uuid&company_id=eq." + encodeURIComponent(companyId) + "&limit=1000");
      const seenImportUuids = new Set<string>();
      const seenImportEmails = new Map<string, string>();
      const seenImportPhones = new Map<string, string>();
      const seenImportDriverIds = new Set<string>();
      let importDuplicateUuidRows = 0;
      let importAmbiguousMatches = 0;
      for (const row of eligibleForImport as any[]) {
        const uuid = String(row["UUID do motorista"] || "").trim();
        if (seenImportUuids.has(uuid)) importDuplicateUuidRows++;
        seenImportUuids.add(uuid);
        const email = String(row["E-mail do motorista"] || "").trim().toLowerCase();
        const phone = normalizePhone(row["Telemóvel"] || "");
        if (email && seenImportEmails.has(email) && seenImportEmails.get(email) !== uuid) importAmbiguousMatches++;
        if (phone && seenImportPhones.has(phone) && seenImportPhones.get(phone) !== uuid) importAmbiguousMatches++;
        if (email) seenImportEmails.set(email, uuid);
        if (phone) seenImportPhones.set(phone, uuid);
        const candidates = (existingForImport as any[]).filter(driver =>
          (uuid && driver.uber_driver_uuid === uuid) ||
          (email && String(driver.email || "").trim().toLowerCase() === email) ||
          (phone && normalizePhone(driver.phone || "") === phone)
        );
        const candidateIds = new Set(candidates.map(driver => String(driver.id)));
        if (candidateIds.size > 1) {
          importAmbiguousMatches++;
        } else if (candidateIds.size === 1) {
          const matchedId = Array.from(candidateIds)[0];
          if (seenImportDriverIds.has(matchedId)) importAmbiguousMatches++;
          else seenImportDriverIds.add(matchedId);
        }
      }
      if (importAmbiguousMatches > 0 || importDuplicateUuidRows > 0) {
        throw new Error("Importação bloqueada no servidor: " + importAmbiguousMatches +
          " correspondências ambíguas e " + importDuplicateUuidRows +
          " linhas com UUID repetido. Reveja o CSV e corrija os conflitos antes de voltar a tentar.");
      }
      const normalized = driverRows.map(r => ({
        uber_driver_uuid: r["UUID do motorista"],
        status: r["Estado"],
        realtime_status: r["Tempo real"],
        full_name: r["Nome do motorista"],
        email: r["E-mail do motorista"],
        phone: r["Telemóvel"],
        last_online_at: uberStatusTimestamp(r["Última vez online"]),
        observed_at: new Date().toISOString(),
        raw: r
      }));
      const result = await rpc("sync_uber_driver_status", { p_rows: normalized });
      return new Response(JSON.stringify({
        ok: true, type, rows: driverRows.length,
        result: { ...(result || {}), organizationRowsSkipped }
      }), { headers: { "Content-Type": "application/json" } });
    }

    if (type === "activity") {
      const normalized = rows.map(r => ({
        uber_driver_uuid: r["UUID do motorista"],
        driver_name: [r["Nome próprio do motorista"], r["Apelido do motorista"]].filter(Boolean).join(" "),
        completed_trips: integerValue(r["Viagens concluídas"], "Viagens concluídas"),
        online_duration_minutes: minutes(r["Tempo online (dias: horas: minutos)"], "Tempo online"),
        trip_duration_minutes: minutes(r["Tempo em viagem (dias: horas: minutos)"], "Tempo em viagem"),
        ...baseDates(periodStart, periodEnd),
        raw: r
      }));
      const result = await rpc("sync_uber_driver_activity", { p_rows: normalized });
      return new Response(JSON.stringify({ ok: true, type, rows: rows.length, result }), { headers: { "Content-Type": "application/json" } });
    }

    if (type === "vehicle_performance") {
      const normalized = rows.map(r => ({
        uber_vehicle_uuid: r["UUID do veículo"],
        plate: r["Número da matrícula do veículo"],
        total_earnings: numberValue(r["Rendimentos totais"]),
        earnings_per_hour: numberValue(r["Rendimentos/hora"]),
        cash_received: numberValue(r["Dinheiro recebido"]),
        trips_per_hour: numberValue(r["Viagens/hora"]),
        online_hours: numberValue(r["Horas online"]),
        trip_hours: numberValue(r["Horas em viagem"]),
        work_hours: numberValue(r["Horas de trabalho"]),
        total_trips: integerValue(r["Total Trips"], "Total de viagens"),
        acceptance_rate: rateValue(r["Acceptance Rate"]),
        cancellation_rate: rateValue(r["Taxa de cancelamento"]),
        accepted_trips: integerValue(r["Viagens aceites (excluindo radar de viagem ou semelhante)"], "Viagens aceites"),
        rejected_trips: integerValue(r["Viagens rejeitadas"], "Viagens rejeitadas"),
        cancelled_trips: integerValue(r["Viagens Canceladas"], "Viagens canceladas"),
        failed_trips: integerValue(r["Falha nas viagens"], "Falha nas viagens"),
        total_trip_assignments: integerValue(r["Total de Atribuições de Viagens"], "Total de atribuições de viagens"),
        ...baseDates(periodStart, periodEnd),
        raw: r
      }));
      const result = await rpc("sync_uber_vehicle_performance", { p_rows: normalized });
      return new Response(JSON.stringify({ ok: true, type, rows: rows.length, result }), { headers: { "Content-Type": "application/json" } });
    }

    if (type === "vehicle_time_distance") {
      const normalized = rows.map(r => ({
        uber_vehicle_uuid: r["UUID do veículo"],
        plate: r["Matrícula do veículo"],
        opening_minutes: clockMinutes(r["Hora de abertura"], "Hora de abertura"),
        route_minutes: clockMinutes(r["Tempo em rota"], "Tempo em rota"),
        trip_minutes: clockMinutes(r["Tempo em viagem"], "Tempo em viagem"),
        unavailable_minutes: clockMinutes(r["Tempo indisponível"], "Tempo indisponível"),
        free_distance_km: numberValue(r["Distância livre"]),
        route_distance_km: numberValue(r["Distância em rota"]),
        trip_distance_km: numberValue(r["Distância em viagem"]),
        unavailable_distance_km: numberValue(r["Distância indisponível"]),
        ...baseDates(periodStart, periodEnd),
        raw: r
      }));
      const result = await rpc("sync_uber_vehicle_time_distance", { p_rows: normalized });
      return new Response(JSON.stringify({ ok: true, type, rows: rows.length, result }), { headers: { "Content-Type": "application/json" } });
    }

    if (type === "driver_time_distance") {
      const normalized = rows.map(r => ({
        uber_driver_uuid: r["UUID do motorista"],
        driver_name: [r["Nome próprio do motorista"], r["Apelido do motorista"]].filter(Boolean).join(" "),
        opening_minutes: clockMinutes(r["Hora de abertura"], "Hora de abertura"),
        route_minutes: clockMinutes(r["Tempo em rota"], "Tempo em rota"),
        trip_minutes: clockMinutes(r["Tempo em viagem"], "Tempo em viagem"),
        unavailable_minutes: clockMinutes(r["Tempo indisponível"], "Tempo indisponível"),
        free_distance_km: numberValue(r["Distância livre"]),
        route_distance_km: numberValue(r["Distância em rota"]),
        trip_distance_km: numberValue(r["Distância em viagem"]),
        unavailable_distance_km: numberValue(r["Distância indisponível"]),
        ...baseDates(periodStart, periodEnd),
        raw: r
      }));
      const result = await rpc("sync_uber_driver_time_distance", { p_rows: normalized });
      return new Response(JSON.stringify({ ok: true, type, rows: rows.length, result }), { headers: { "Content-Type": "application/json" } });
    }

    if (type === "driver_quality") {
      const normalized = rows.map(r => ({
        uber_driver_uuid: r["UUID do motorista"],
        driver_name: [r["Nome próprio do motorista"], r["Apelido do motorista"]].filter(Boolean).join(" "),
        completed_trips: integerValue(r["Viagens concluídas"], "Viagens concluídas"),
        acceptance_rate: rateValue(r["Taxa de aceitação"]),
        cancellation_rate: rateValue(r["Taxa de cancelamento"]),
        completion_rate: rateValue(r["Taxa de conclusão"]),
        rating_last_4_weeks: numberValue(r["Classificações do motorista (últimas 4 semanas)"]),
        rating_last_500_trips: numberValue(r["Classificações do motorista (500 viagens anteriores)"]),
        current_acceptance_rate: rateValue(r["Taxa de aceitação atual do motorista, tal como apresentada na aplicação para motoristas"]),
        current_cancellation_rate: rateValue(r["Taxa de cancelamento atual do motorista, tal como apresentada na aplicação para motoristas"]),
        accepted_trips: integerValue(r["Viagens aceites (excluindo radar de viagem ou semelhante)"], "Viagens aceites"),
        rejected_trips: integerValue(r["Viagens rejeitadas"], "Viagens rejeitadas"),
        cancelled_trips: integerValue(r["Viagens Canceladas"], "Viagens canceladas"),
        driver_cancelled_trips: integerValue(r["Viagens canceladas por motoristas responsáveis"], "Viagens canceladas por motoristas"),
        failed_trips: integerValue(r["Falha nas viagens"], "Falha nas viagens"),
        total_trip_assignments: integerValue(r["Total de Atribuições de Viagens"], "Total de atribuições de viagens"),
        ...baseDates(periodStart, periodEnd),
        raw: r
      }));
      const result = await rpc("sync_uber_driver_quality", { p_rows: normalized });
      return new Response(JSON.stringify({ ok: true, type, rows: rows.length, result }), { headers: { "Content-Type": "application/json" } });
    }

    if (type === "driver_payments") {
      const normalized = rows.map(r => ({
        uber_driver_uuid: r["UUID do motorista"],
        driver_name: [r["Nome próprio do motorista"], r["Apelido do motorista"]].filter(Boolean).join(" "),
        paid_to_you: numberValue(r["Pago a si"]),
        earnings: numberValue(r["Pago a si : Os seus rendimentos"]),
        cash_received: numberValue(r["Pago a si : Saldo da viagem : Pagamentos : Dinheiro recebido"]),
        fare: numberValue(r["Pago a si : Os seus rendimentos : Tarifa"]),
        taxes: numberValue(r["Pago a si : Os seus rendimentos : Impostos"]),
        service_fee: numberValue(r["Pago a si : Os seus rendimentos : Taxa de serviço"] || r["Pago a si:Os seus rendimentos:Taxa de serviço"] || ""),
        tolls: numberValue(r["Pago a si : Saldo da viagem : Reembolsos : Portagem"] || r["Pago a si:Saldo da viagem:Reembolsos:Portagem"] || ""),
        tips: numberValue(r["Pago a si : Os seus rendimentos : Gratificação"] || r["Pago a si:Os seus rendimentos:Gratificação"] || ""),
        adjustments: numberValue(r["Pago a si : Os seus rendimentos : Outros rendimentos : Ajustes após a viagem"] || r["Pago a si:Os seus rendimentos:Outros rendimentos:Ajustes após a viagem"] || ""),
        ...baseDates(periodStart, periodEnd),
        raw: r
      }));
      const result = await rpc("sync_uber_driver_payments", { p_rows: normalized });
      return new Response(JSON.stringify({ ok: true, type, rows: rows.length, result }), { headers: { "Content-Type": "application/json" } });
    }

    throw new Error("Tipo de relatório inválido");
  } catch (e) {
    console.error("uber-report-import failed", e);
    return new Response(JSON.stringify({ ok: false, error: "Não foi possível concluir a importação. Verifique o ficheiro e as permissões ou tente novamente." }), {
      status: 400,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
    });
  }
  })();
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Headers", "authorization, x-client-info, apikey, content-type");
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  headers.set("Access-Control-Max-Age", "86400");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
});