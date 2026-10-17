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
  if (!response.ok) throw new Error("Falha ao consultar correspondências internas (" + response.status + ").");
  return await response.json();
}
function localLisbonTimestamp(value: string) {
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
function rateValue(v: string) {
  const n = numberValue(v);
  if (n === null) return null;
  return v.includes("%") ? n / 100 : n;
}
function minutes(v: string) {
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
function baseDates(periodStart: string | null, periodEnd: string | null) {
  return { period_start: periodStart || null, period_end: periodEnd || null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  try {
    const auth = req.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) return new Response(JSON.stringify({ error: "Não autenticado" }), { status: 401, headers: { "Content-Type": "application/json" } });
    const token = auth.slice(7);
    const me = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` } });
    if (!me.ok) return new Response(JSON.stringify({ error: "Sessão inválida" }), { status: 401, headers: { "Content-Type": "application/json" } });

    const url = new URL(req.url);
    const type = url.searchParams.get("type") || "status";
    const periodStart = url.searchParams.get("period_start");
    const periodEnd = url.searchParams.get("period_end");
    const rows = parseCsv(await req.text());
    if (!rows.length) throw new Error("CSV vazio ou sem linhas de dados.");
    const headers = new Set(Object.keys(rows[0] || {}));
    const requireAnyHeader = (names: string[], description: string) => {
      if (!names.some(name => headers.has(name))) {
        throw new Error(`Este CSV não parece ser um relatório de ${description}. Colunas esperadas: ${names.join(" ou ")}.`);
      }
    };
    if (type === "status" || type === "activity" || type === "driver_time_distance" || type === "driver_quality" || type === "driver_payments" || type === "trip_activity") {
      requireAnyHeader(["UUID do motorista"], "motoristas");
    } else if (type === "vehicle_performance") {
      requireAnyHeader(["UUID do veículo", "Número da matrícula do veículo"], "desempenho de viaturas");
    } else if (type === "vehicle_time_distance") {
      requireAnyHeader(["UUID do veículo", "Matrícula do veículo"], "tempo e distância de viaturas");
    } else {
      throw new Error("Tipo de relatório inválido");
    }

    if (type === "trip_activity") {
      const requiredTripHeaders = ["UUID da viagem", "UUID do motorista", "Estado da viagem"];
      const missingTripHeaders = requiredTripHeaders.filter(name => !headers.has(name));
      if (missingTripHeaders.length) throw new Error("CSV de viagens incompleto. Colunas em falta: " + missingTripHeaders.join(", ") + ".");
      const driverRows = await getRestRows("drivers?select=id,uber_driver_uuid,full_name&limit=1000");
      const vehicleRows = await getRestRows("vehicles?select=id,uber_vehicle_uuid,plate&limit=1000");
      const driversByUuid = new Map(driverRows.filter((item: any) => item.uber_driver_uuid).map((item: any) => [item.uber_driver_uuid, item.id]));
      const normalizePersonName = (value: string) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-PT");
      const driverIdsByName = new Map<string, string[]>();
      for (const driver of driverRows as any[]) {
        const normalizedName = normalizePersonName(driver.full_name || "");
        if (!normalizedName) continue;
        const ids = driverIdsByName.get(normalizedName) || [];
        ids.push(driver.id);
        driverIdsByName.set(normalizedName, ids);
      }
      const vehiclesByUuid = new Map(vehicleRows.filter((item: any) => item.uber_vehicle_uuid).map((item: any) => [item.uber_vehicle_uuid, item.id]));
      const vehiclesByPlate = new Map(vehicleRows.filter((item: any) => item.plate).map((item: any) => [String(item.plate).replace(/[^A-Z0-9]/gi, "").toUpperCase(), item.id]));
      const normalized = rows.map(r => {
        const tripId = (r["UUID da viagem"] || "").trim();
        const driverUuid = (r["UUID do motorista"] || "").trim();
        const driverName = ((r["Nome próprio do motorista"] || "") + " " + (r["Apelido do motorista"] || "")).trim();
        const nameMatches = driverIdsByName.get(normalizePersonName(driverName)) || [];
        const matchedDriverId = driversByUuid.get(driverUuid) || (nameMatches.length === 1 ? nameMatches[0] : null);
        const vehicleUuid = (r["UUID do veículo"] || "").trim();
        const plate = (r["Matrícula"] || "").trim();
        const status = (r["Estado da viagem"] || "").trim().toLowerCase();
        const requestedAt = localLisbonTimestamp(r["Hora do pedido de viagem"] || "");
        const arrivedAt = localLisbonTimestamp(r["Hora de chegada da viagem"] || "");
        const completed = status === "completed";
        return {
          platform: "uber",
          source_trip_id: tripId,
          driver_id: matchedDriverId,
          vehicle_id: vehiclesByUuid.get(vehicleUuid) || vehiclesByPlate.get(plate.replace(/[^A-Z0-9]/gi, "").toUpperCase()) || null,
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
      const uniqueTrips = Array.from(new Map(normalized.map((row: any) => [row.source_trip_id, row])).values());
      const duplicateRowsInCsv = normalized.length - uniqueTrips.length;
      const linkedDrivers = uniqueTrips.filter((r: any) => r.driver_id).length;
      const linkedVehicles = uniqueTrips.filter((r: any) => r.vehicle_id).length;
      const tripIds = uniqueTrips.map((r: any) => String(r.source_trip_id));
      const validUuidTripIds = tripIds.filter((id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id));
      const existingRows = validUuidTripIds.length
        ? await getRestRows("platform_trip_records?select=source_trip_id&platform=eq.uber&source_trip_id=in.(" + validUuidTripIds.join(",") + ")&limit=1000")
        : [];
      const existingIds = new Set((existingRows as any[]).map(row => String(row.source_trip_id)));
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
      const response = await fetch(SUPABASE_URL + "/rest/v1/platform_trip_records?on_conflict=platform,source_trip_id", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SERVICE_ROLE_KEY,
          Authorization: "Bearer " + SERVICE_ROLE_KEY,
          Prefer: "resolution=merge-duplicates,return=minimal"
        },
        body: JSON.stringify(uniqueTrips)
      });
      const responseText = await response.text();
      if (!response.ok) throw new Error("Falha ao guardar viagens Uber (" + response.status + "): " + responseText);
      return new Response(JSON.stringify({
        ok: true, type, rows: uniqueTrips.length,
        result: { saved: uniqueTrips.length, skipped: rows.length - uniqueTrips.length, linkedDrivers, linkedVehicles, duplicateRowsInCsv, alreadyImported, newTrips }
      }), { headers: { "Content-Type": "application/json" } });
    }

    if (type === "status") {
      const normalizeIdentity = (value: string) => String(value || "").normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLocaleUpperCase("pt-PT").replace(/[^A-Z0-9]+/g, " ").trim();
      const normalizePhone = (value: string) => String(value || "").replace(/\\D/g, "");
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
        const matchedDriverIds = new Set<string>();
        let duplicateUuidRows = 0, matchedExisting = 0, wouldCreate = 0, ambiguousMatches = 0;
        const existingDrivers = await getRestRows("drivers?select=id,email,phone,uber_driver_uuid&limit=1000");
        for (const row of eligibleRows as any[]) {
          const uuid = String(row["UUID do motorista"] || "").trim();
          if (seenUuids.has(uuid)) duplicateUuidRows++;
          seenUuids.add(uuid);
          const email = String(row["E-mail do motorista"] || "").trim().toLowerCase();
          const phone = normalizePhone(row["Telemóvel"] || "");
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
      const existingForImport = await getRestRows("drivers?select=id,email,phone,uber_driver_uuid&limit=1000");
      const seenImportUuids = new Set<string>();
      const seenImportDriverIds = new Set<string>();
      let importDuplicateUuidRows = 0;
      let importAmbiguousMatches = 0;
      for (const row of eligibleForImport as any[]) {
        const uuid = String(row["UUID do motorista"] || "").trim();
        if (seenImportUuids.has(uuid)) importDuplicateUuidRows++;
        seenImportUuids.add(uuid);
        const email = String(row["E-mail do motorista"] || "").trim().toLowerCase();
        const phone = normalizePhone(row["Telemóvel"] || "");
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
        last_online_at: r["Última vez online"],
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
        completed_trips: numberValue(r["Viagens concluídas"]),
        online_duration_minutes: minutes(r["Tempo online (dias: horas: minutos)"]),
        trip_duration_minutes: minutes(r["Tempo em viagem (dias: horas: minutos)"]),
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
        total_trips: numberValue(r["Total Trips"]),
        acceptance_rate: rateValue(r["Acceptance Rate"]),
        cancellation_rate: rateValue(r["Taxa de cancelamento"]),
        accepted_trips: numberValue(r["Viagens aceites (excluindo radar de viagem ou semelhante)"]),
        rejected_trips: numberValue(r["Viagens rejeitadas"]),
        cancelled_trips: numberValue(r["Viagens Canceladas"]),
        failed_trips: numberValue(r["Falha nas viagens"]),
        total_trip_assignments: numberValue(r["Total de Atribuições de Viagens"]),
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
        opening_minutes: minutes(r["Hora de abertura"]),
        route_minutes: minutes(r["Tempo em rota"]),
        trip_minutes: minutes(r["Tempo em viagem"]),
        unavailable_minutes: minutes(r["Tempo indisponível"]),
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
        opening_minutes: minutes(r["Hora de abertura"]),
        route_minutes: minutes(r["Tempo em rota"]),
        trip_minutes: minutes(r["Tempo em viagem"]),
        unavailable_minutes: minutes(r["Tempo indisponível"]),
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
        completed_trips: numberValue(r["Viagens concluídas"]),
        acceptance_rate: rateValue(r["Taxa de aceitação"]),
        cancellation_rate: rateValue(r["Taxa de cancelamento"]),
        completion_rate: rateValue(r["Taxa de conclusão"]),
        rating_last_4_weeks: numberValue(r["Classificações do motorista (últimas 4 semanas)"]),
        rating_last_500_trips: numberValue(r["Classificações do motorista (500 viagens anteriores)"]),
        current_acceptance_rate: rateValue(r["Taxa de aceitação atual do motorista, tal como apresentada na aplicação para motoristas"]),
        current_cancellation_rate: rateValue(r["Taxa de cancelamento atual do motorista, tal como apresentada na aplicação para motoristas"]),
        accepted_trips: numberValue(r["Viagens aceites (excluindo radar de viagem ou semelhante)"]),
        rejected_trips: numberValue(r["Viagens rejeitadas"]),
        cancelled_trips: numberValue(r["Viagens Canceladas"]),
        driver_cancelled_trips: numberValue(r["Viagens canceladas por motoristas responsáveis"]),
        failed_trips: numberValue(r["Falha nas viagens"]),
        total_trip_assignments: numberValue(r["Total de Atribuições de Viagens"]),
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
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
});