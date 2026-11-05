import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { isBoltSyncBlocked, resolveBoltDriverMatch, hasBoltIdentityConflict, normalizeBoltEmail, normalizeBoltPhone, normalizeBoltActiveVehicle, boltStatusToPortal, boltCompensationDiagnostic, isBoltCompensationCritical, boltApiEnvelopeError, extractBoltCompanies, resolveSingleBoltCompanyId, boltPageCountIsValid, hasDuplicateBoltIdentities } from "../bolt-sync-utils.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://fleet.simplicity2take.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

const BOLT_TOKEN_URL = "https://oidc.bolt.eu/token";
const BOLT_API_BASE = "https://node.bolt.eu/fleet-integration-gateway";
const BOLT_API_BASE_V2 = "https://node.bolt.eu/fleet-integration-gateway-v2";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}
function clean(value: unknown) { return value === undefined || value === null ? "" : String(value); }
function safeErrorMessage(error: unknown, fallback = "Erro inesperado na sincronização Bolt.") {
  const raw = error instanceof Error ? error.message : clean(error);
  // Avoid leaking tokens, credentials, personal data or unbounded third-party payloads.
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [redacted]")
    .replace(/(client_secret|access_token|refresh_token|password|authorization)(\s*[:=]\s*)[^,;\s]+/gi, "$1$2[redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 500) || fallback;
}
function first(obj: any, keys: string[]) {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}
function arrayFrom(payload: any, keys: string[], depth = 0): any[] {
  if (depth > 5) return [];
  if (Array.isArray(payload)) return payload;
  for (const key of keys) if (Array.isArray(payload?.[key])) return payload[key];
  for (const key of ["data", "result", "response"]) {
    if (payload?.[key] && typeof payload[key] === "object") {
      const nested = arrayFrom(payload[key], keys, depth + 1);
      if (nested.length) return nested;
    }
  }
  return [];
}
function hasExpectedCollection(payload: any, keys: string[], depth = 0): boolean {
  if (depth > 5) return false;
  if (Array.isArray(payload)) return true;
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return true;
  }
  for (const key of ["data", "result", "response"]) {
    if (payload?.[key] && typeof payload[key] === "object" &&
        hasExpectedCollection(payload[key], keys, depth + 1)) return true;
  }
  return false;
}
function normalizeVehicleId(vehicle: any) { return clean(first(vehicle, ["uuid", "vehicle_uuid", "id"])).trim(); }
function normalizePlate(vehicle: any) { return clean(first(vehicle, ["reg_number", "registration_number", "plate", "license_plate"])).trim().toUpperCase(); }
function normalizeDriverId(driver: any) { return clean(first(driver, ["driver_uuid", "uuid", "id"])).trim(); }
function normalizeActiveVehicle(driver: any) {
  return normalizeBoltActiveVehicle(driver);
}
function normalizeEmail(value: unknown) {
  return clean(value).trim().toLowerCase();
}
function normalizePhone(value: unknown) {
  // Normalize presentation whitespace only; retain punctuation and country
  // prefixes because phone formats are not safely equivalent without a region.
  return clean(value).replace(/\s+/g, "").trim();
}
async function getBoltToken() {
  const clientId = Deno.env.get("BOLT_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("BOLT_CLIENT_SECRET") || "";
  if (clientId.length > 512 || clientSecret.length > 4096) {
    throw new Error("As credenciais Bolt excedem o tamanho permitido.");
  }
  if (!clientId || !clientSecret) throw new Error("Faltam BOLT_CLIENT_ID e BOLT_CLIENT_SECRET nos Secrets do Supabase.");
  const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials", scope: "fleet-integration:api" });
  let response: Response;
  try {
    response = await fetch(BOLT_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
      signal: AbortSignal.timeout(20000)
    });
  } catch {
    throw new Error("Falha de rede ou timeout na autenticação Bolt.");
  }
  let data: any = {};
  try { data = await response.json(); } catch {
    throw new Error("A Bolt devolveu JSON inválido na autenticação.");
  }
  if (!response.ok || !data.access_token) throw new Error("A Bolt recusou a autenticação API. Verifique as credenciais e o acesso Fleet Integration.");
  if (typeof data.access_token !== "string" || data.access_token.length < 16 || data.access_token.length > 8192) {
    throw new Error("A Bolt devolveu um token de autenticação inválido.");
  }
  return data.access_token as string;
}
async function boltPost(path: string, token: string) {
  const attempts = [{ pager: { offset: 0, limit: 1000 } }, { page: { offset: 0, limit: 1000 } }, {}];
  let lastError = "Pedido Bolt recusado.";
  const allowedPaths = new Set(["/fleetIntegration/v1/getDrivers", "/fleetIntegration/v1/getVehicles"]);
  if (!allowedPaths.has(path)) throw new Error("Endpoint Bolt não permitido.");
  for (let index = 0; index < attempts.length; index++) {
    let response: Response;
    try {
      response = await fetch(BOLT_API_BASE + path, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(attempts[index]),
        signal: AbortSignal.timeout(20000)
      });
    } catch {
      // Network/timeout errors are not evidence that another payload shape
      // will work. Fail fast rather than duplicating a potentially processed call.
      throw new Error("Falha de rede ou timeout ao contactar a API Bolt.");
    }
    const text = await response.text();
    let data: any = {};
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (response.ok) return data;
    // Do not forward provider error bodies: they may contain personal data,
    // request details, or credentials. Keep only the HTTP status for diagnostics.
    lastError = `Pedido Bolt recusado (HTTP ${response.status}).`;
    if (![400, 422].includes(response.status)) throw new Error(lastError);
  }
  throw new Error(lastError);
}
async function boltPostV2(path: string, token: string, body: Record<string, unknown>) {
  const allowedPaths = new Set([
    "/fleetIntegration/v2/getCompanies",
    "/fleetIntegration/v2/getDrivers",
    "/fleetIntegration/v2/getVehicles"
  ]);
  if (!allowedPaths.has(path)) throw new Error("Endpoint Bolt v2 não permitido.");
  let response: Response;
  try {
    response = await fetch(BOLT_API_BASE_V2 + path, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000)
    });
  } catch {
    throw new Error("Falha de rede ou timeout ao contactar a API Bolt v2.");
  }
  let payload: any;
  try { payload = await response.json(); } catch {
    throw new Error("A Bolt v2 devolveu JSON inválido.");
  }
  if (!response.ok) throw new Error(`Pedido Bolt v2 recusado (HTTP ${response.status}).`);
  const envelopeError = boltApiEnvelopeError(payload);
  if (envelopeError) throw new Error(envelopeError);
  return payload;
}
async function getBoltV2CompanyId(token: string) {
  const payload = await boltPostV2("/fleetIntegration/v2/getCompanies", token, {});
  const companyId = resolveSingleBoltCompanyId(extractBoltCompanies(payload));
  if (!companyId) {
    throw new Error("A Bolt v2 não devolveu uma empresa única; configure credenciais para uma única empresa antes de sincronizar.");
  }
  return companyId;
}
async function getBoltV2Collection(path: string, token: string, companyId: string, collectionKeys: string[]) {
  const limit = 1000;
  const maximum = 5000;
  const records: any[] = [];
  let totalRows: number | null = null;
  for (let offset = 0; offset < maximum; offset += limit) {
    const payload = await boltPostV2(path, token, { company_id: companyId, limit, offset });
    const data = payload?.data;
    if (!hasExpectedCollection(data, collectionKeys)) {
      throw new Error("A Bolt v2 devolveu uma resposta sem a coleção esperada; sincronização interrompida.");
    }
    const page = arrayFrom(data, collectionKeys);
    const reportedTotal = data && typeof data === "object" ? data.total_rows : undefined;
    if (!boltPageCountIsValid(page.length, reportedTotal)) {
      throw new Error("A Bolt v2 devolveu metadados de paginação inválidos.");
    }
    if (totalRows === null) totalRows = reportedTotal;
    else if (reportedTotal !== totalRows) {
      throw new Error("O total de registos Bolt v2 mudou durante a paginação; sincronização interrompida.");
    }
    if (records.length + page.length > maximum || reportedTotal > maximum) {
      throw new Error("A Bolt v2 excedeu o limite de segurança de 5.000 registos.");
    }
    records.push(...page);
    if (records.length >= reportedTotal) break;
    if (page.length === 0) throw new Error("A Bolt v2 devolveu uma página vazia antes do fim; sincronização interrompida.");
  }
  if (totalRows === null || records.length !== totalRows) {
    throw new Error("A paginação Bolt v2 ficou incompleta; sincronização interrompida.");
  }
  return records;
}
async function upsertVehicle(admin: any, vehicle: any, now: string) {
  const boltId = normalizeVehicleId(vehicle);
  const plate = normalizePlate(vehicle);
  const model = clean(first(vehicle, ["model", "vehicle_model"]));
  const yearValue = first(vehicle, ["year", "vehicle_year"]);
  const year = Number.isFinite(Number(yearValue)) && Number(yearValue) > 1900 ? Number(yearValue) : null;
  const vin = clean(first(vehicle, ["vin", "VIN"]));
  const state = first(vehicle, ["state", "status"]);
  let existing: any = null;
  if (boltId) {
    const lookup = await admin.from("vehicles").select("*").eq("bolt_vehicle_uuid", boltId).maybeSingle();
    if (lookup.error) throw new Error("Falha ao consultar viatura existente por UUID Bolt.");
    existing = lookup.data;
  }
  if (plate) {
    const lookup = await admin.from("vehicles").select("*").eq("plate", plate).maybeSingle();
    if (lookup.error) throw new Error("Falha ao consultar viatura existente por matrícula.");
    if (existing && lookup.data && existing.id !== lookup.data.id) {
      throw new Error("O UUID Bolt e a matrícula correspondem a viaturas diferentes; atualização bloqueada.");
    }
    existing ??= lookup.data;
  }
  if (hasBoltIdentityConflict(existing?.bolt_vehicle_uuid, boltId)) {
    throw new Error("A matrícula corresponde a uma viatura com outro UUID Bolt; atualização bloqueada.");
  }
  const payload: any = {
    plate: plate || existing?.plate || "",
    model: model || existing?.model || "",
    vehicle_year: year || existing?.vehicle_year || null,
    vin: vin || existing?.vin || null,
    status: boltStatusToPortal(state, existing?.status || "Ativo"),
    bolt_vehicle_uuid: boltId || existing?.bolt_vehicle_uuid || null,
    bolt_last_synced_at: now
  };
  if (existing) {
    const result = await admin.from("vehicles").update(payload).eq("id", existing.id).select("*").single();
    if (result.error) throw result.error;
    return { row: result.data, created: false };
  }
  const result = await admin.from("vehicles").insert(payload).select("*").single();
  if (result.error) throw result.error;
  return { row: result.data, created: true };
}
async function upsertDriver(admin: any, driver: any, vehicleByBoltId: Map<string, any>, vehicleByPlate: Map<string, any>, now: string) {
  const boltId = normalizeDriverId(driver);
  const partnerUuid = clean(first(driver, ["partner_uuid", "partnerUuid"]));
  const firstName = clean(first(driver, ["first_name", "firstName"]));
  const lastName = clean(first(driver, ["last_name", "lastName"]));
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
  const email = normalizeBoltEmail(first(driver, ["email"]));
  const phone = normalizeBoltPhone(first(driver, ["phone", "phone_number"]));
  const state = first(driver, ["state", "status"]);
  const activeVehicle = normalizeActiveVehicle(driver);
  const activeVehicleId = normalizeVehicleId(activeVehicle);
  const activePlate = normalizePlate(activeVehicle);

  let byBoltId = null;
  let byEmail = null;
  let byPhone = null;
  if (boltId) {
    const lookup = await admin.from("drivers").select("*").eq("bolt_driver_uuid", boltId).maybeSingle();
    if (lookup.error) throw new Error("Falha ao consultar motorista existente por UUID Bolt.");
    byBoltId = lookup.data;
  }
  if (email) {
    // Match the entire address literally, including pattern characters in the local part.
    const emailPattern = "^" + email.replace(/[.*+?^${}()|[\]\\]/g, "\$&") + "$";
    const lookup = await admin.from("drivers").select("*").filter("email", "imatch", emailPattern).maybeSingle();
    if (lookup.error) throw new Error("Falha ao consultar motorista existente por email.");
    byEmail = lookup.data;
  }
  if (phone) {
    const lookup = await admin.from("drivers").select("*").eq("phone", phone).maybeSingle();
    if (lookup.error) throw new Error("Falha ao consultar motorista existente por telefone.");
    byPhone = lookup.data;
  }
  const existing = resolveBoltDriverMatch<any>(byBoltId, byEmail, byPhone);
  if (hasBoltIdentityConflict(existing?.bolt_driver_uuid, boltId)) {
    throw new Error("O email/telefone corresponde a um motorista com outro UUID Bolt; atualização bloqueada.");
  }

  let assignedVehicle = activeVehicleId ? vehicleByBoltId.get(activeVehicleId) : null;
  if (!assignedVehicle && activePlate) assignedVehicle = vehicleByPlate.get(activePlate) || null;
  const nextStatus = boltStatusToPortal(state, existing?.status || "Ativo");

  // Validate all assignment preconditions before changing the driver profile.
  if (nextStatus === "Ativo" && activeVehicle && !assignedVehicle?.id) {
    throw new Error("Não foi possível resolver a viatura ativa Bolt; perfil e atribuição não foram alterados.");
  }
  if (nextStatus === "Ativo" && activeVehicleId &&
      assignedVehicle?.bolt_vehicle_uuid !== activeVehicleId) {
    throw new Error("A viatura resolvida não corresponde ao UUID ativo Bolt; perfil e atribuição não foram alterados.");
  }
  if (nextStatus === "Ativo" && assignedVehicle?.plate && activePlate &&
      assignedVehicle.plate.toUpperCase() !== activePlate.toUpperCase()) {
    throw new Error("A matrícula resolvida não corresponde à viatura ativa Bolt; perfil e atribuição não foram alterados.");
  }

  const payload: any = {
    full_name: fullName || existing?.full_name || "Motorista Bolt",
    email: email || existing?.email || null,
    phone: phone || existing?.phone || null,
    status: nextStatus,
    bolt_driver_uuid: boltId || existing?.bolt_driver_uuid || null,
    bolt_partner_uuid: partnerUuid || existing?.bolt_partner_uuid || null,
    bolt_last_synced_at: now
  };

  let row: any, created = false;
  if (existing) {
    const result = await admin.from("drivers").update(payload).eq("id", existing.id).select("*").single();
    if (result.error) throw result.error;
    row = result.data;
  } else {
    const result = await admin.from("drivers").insert(payload).select("*").single();
    if (result.error) throw result.error;
    row = result.data;
    created = true;
  }

  // Reconcile first. If the RPC fails, do not leave the driver profile changed.
  if (row.status === "Ativo" && assignedVehicle?.id) {
    const { data: assignmentId, error: assignmentError } = await admin.rpc(
      "reconcile_bolt_vehicle_assignment",
      {
        p_driver_id: row.id,
        p_vehicle_id: assignedVehicle.id,
        p_active_from: now.slice(0, 10)
      }
    );
    if (assignmentError || !assignmentId) {
      // Best-effort compensation; include its outcome in the thrown error so
      // the caller can flag critical inconsistency for manual review.
      let compensationFailed = false;
      if (existing) {
        const rollback = await admin.from("drivers").update({
          full_name: existing.full_name,
          email: existing.email,
          phone: existing.phone,
          status: existing.status,
          bolt_driver_uuid: existing.bolt_driver_uuid,
          bolt_partner_uuid: existing.bolt_partner_uuid,
          bolt_last_synced_at: existing.bolt_last_synced_at
        }).eq("id", existing.id);
        const compensation = rollback.error
          ? { ok: false as const, action: "restore_failed" as const }
          : { ok: true as const, action: "restored" as const };
        compensationFailed = isBoltCompensationCritical(compensation);
        if (compensationFailed) {
          console.error("bolt-sync driver profile compensation failed", {
            driverId: existing.id,
            code: rollback.error?.code,
            diagnostic: boltCompensationDiagnostic(compensation)
          });
        }
      } else {
        const rollback = await admin.from("drivers").delete().eq("id", row.id);
        const compensation = rollback.error
          ? { ok: false as const, action: "delete_failed" as const }
          : { ok: true as const, action: "deleted" as const };
        compensationFailed = isBoltCompensationCritical(compensation);
        if (compensationFailed) {
          console.error("bolt-sync new driver compensation failed", {
            driverId: row.id,
            code: rollback.error?.code,
            diagnostic: boltCompensationDiagnostic(compensation)
          });
        }
      }
      if (assignmentError) {
        const message = safeErrorMessage(assignmentError);
        throw new Error(compensationFailed
          ? `Falha crítica de compensação: ${message}`
          : message);
      }
      throw new Error(compensationFailed
        ? "Falha crítica de compensação: a reconciliação Bolt não devolveu uma atribuição."
        : "A reconciliação Bolt não devolveu uma atribuição.");
    }
  }
  return { row, created, assignedVehicleId: row.status === "Ativo" ? assignedVehicle?.id || null : null };
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const userToken = authHeader.replace(/^Bearer\s+/i, "");
    if (!userToken) return json({ ok: false, error: "Sessão não encontrada." }, 401);
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: authData, error: authError } = await admin.auth.getUser(userToken);
    if (authError || !authData.user) return json({ ok: false, error: "Sessão inválida." }, 401);
    const callerEmail = (authData.user.email || "").toLowerCase();
    if (callerEmail !== "simplicity2take@gmail.com") return json({ ok: false, error: "Apenas o administrador pode sincronizar a Bolt." }, 403);

    const mode = new URL(req.url).searchParams.get("mode");
    if (mode !== null && mode !== "check") {
      return json({ ok: false, error: "Modo Bolt inválido." }, 400);
    }

    if (isBoltSyncBlocked(mode, Deno.env.get("BOLT_CHECK_ONLY"))) {
      return json({ ok: false, error: "Este ambiente Bolt só permite verificar a ligação." }, 403);
    }

    const token = await getBoltToken();
    // Require an explicit opt-in value; never infer v2 from partial configuration.
    const configuredApiVersion = (Deno.env.get("BOLT_API_VERSION") || "1").trim();
    if (configuredApiVersion !== "1" && configuredApiVersion !== "2") {
      return json({
        ok: false,
        error: "BOLT_API_VERSION inválida. Configure explicitamente 1 ou 2.",
        source: "bolt",
        syncedAt: null
      }, 500);
    }
    const apiVersion = configuredApiVersion;
    let boltDrivers: any[], boltVehicles: any[];
    if (apiVersion === "2") {
      const companyId = await getBoltV2CompanyId(token);
      [boltDrivers, boltVehicles] = await Promise.all([
        getBoltV2Collection("/fleetIntegration/v2/getDrivers", token, companyId, ["drivers", "items"]),
        getBoltV2Collection("/fleetIntegration/v2/getVehicles", token, companyId, ["vehicles", "items"])
      ]);
    } else {
      const [driversPayload, vehiclesPayload] = await Promise.all([
        boltPost("/fleetIntegration/v1/getDrivers", token),
        boltPost("/fleetIntegration/v1/getVehicles", token)
      ]);
      const driverCollectionPresent = hasExpectedCollection(driversPayload, ["drivers", "fleet_drivers", "items"]);
      const vehicleCollectionPresent = hasExpectedCollection(vehiclesPayload, ["vehicles", "fleet_vehicles", "items"]);
      if (!driverCollectionPresent) return json({
        ok: false, error: "A resposta Bolt não contém uma coleção reconhecida de motoristas; sincronização interrompida.",
        source: "bolt", syncedAt: null
      }, 502);
      if (!vehicleCollectionPresent) return json({
        ok: false, error: "A resposta Bolt não contém uma coleção reconhecida de viaturas; sincronização interrompida.",
        source: "bolt", syncedAt: null
      }, 502);
      boltDrivers = arrayFrom(driversPayload, ["drivers", "fleet_drivers", "items"]);
      boltVehicles = arrayFrom(vehiclesPayload, ["vehicles", "fleet_vehicles", "items"]);
    }
    // Refuse unexpectedly large responses rather than processing an unbounded
    // payload from the external provider in a single Edge Function invocation.
    const MAX_BOLT_DRIVERS = 5000;
    const MAX_BOLT_VEHICLES = 5000;
    if (boltDrivers.length > MAX_BOLT_DRIVERS) return json({
      ok: false, error: `A Bolt devolveu ${boltDrivers.length} motoristas; limite de segurança (${MAX_BOLT_DRIVERS}) excedido.`,
      source: "bolt", syncedAt: null
    }, 502);
    if (boltVehicles.length > MAX_BOLT_VEHICLES) return json({
      ok: false, error: `A Bolt devolveu ${boltVehicles.length} viaturas; limite de segurança (${MAX_BOLT_VEHICLES}) excedido.`,
      source: "bolt", syncedAt: null
    }, 502);
    // Treat an empty individual collection as suspicious: never interpret an
    // incomplete/empty API response as authoritative data for a fleet sync.
    if (!boltDrivers.length) return json({
      ok: false, error: "A Bolt devolveu zero motoristas; sincronização interrompida para evitar um resultado incompleto.",
      source: "bolt", syncedAt: null
    }, 502);
    if (!boltVehicles.length) return json({
      ok: false, error: "A Bolt devolveu zero viaturas; sincronização interrompida para evitar atribuições incompletas.",
      source: "bolt", syncedAt: null
    }, 502);

    // Reject contradictory provider batches before writing any driver or vehicle.
    if (hasDuplicateBoltIdentities(boltVehicles, (v: any) => normalizeVehicleId(v)) ||
        hasDuplicateBoltIdentities(boltVehicles, (v: any) => normalizePlate(v).toUpperCase()) ||
        hasDuplicateBoltIdentities(boltDrivers, (d: any) => normalizeDriverId(d)) ||
        hasDuplicateBoltIdentities(boltDrivers, (d: any) => normalizeBoltEmail(first(d, ["email"]))) ||
        hasDuplicateBoltIdentities(boltDrivers, (d: any) => normalizeBoltPhone(first(d, ["phone", "phone_number"])))) {
      return json({
        ok: false,
        error: "A Bolt devolveu identificadores duplicados; sincronização interrompida antes de alterar dados.",
        source: "bolt", syncedAt: null
      }, 502);
    }

    // Connection checks stop before any Fleet database operation.
    if (mode === "check") {
      return json({
        ok: true,
        mode,
        source: "bolt",
        apiVersion,
        syncedAt: null,
        drivers: { received: boltDrivers.length },
        vehicles: { received: boltVehicles.length },
      });
    }

    const now = new Date().toISOString();
    const vehicleByBoltId = new Map<string, any>();
    const vehicleByPlate = new Map<string, any>();
    let vehiclesCreated = 0, vehiclesUpdated = 0, vehicleFailures = 0;
    const vehicleErrors: Array<{ boltVehicleId: string; message: string }> = [];
    const seenBoltVehicleIds = new Set<string>();
    const seenBoltPlates = new Set<string>();
    let invalidVehicleRecords = 0;
    for (const vehicle of boltVehicles) {
      const incomingBoltId = normalizeVehicleId(vehicle);
      const incomingPlate = normalizePlate(vehicle).toUpperCase();
      if (!incomingBoltId && !incomingPlate) {
        vehicleFailures++;
        invalidVehicleRecords++;
        vehicleErrors.push({ boltVehicleId: "unknown", message: "Registo Bolt sem UUID e sem matrícula; registo ignorado." });
        continue;
      }
      if (incomingBoltId && seenBoltVehicleIds.has(incomingBoltId)) {
        vehicleFailures++;
        vehicleErrors.push({ boltVehicleId: incomingBoltId, message: "Resposta Bolt contém UUID de viatura duplicado; registo ignorado." });
        continue;
      }
      if (incomingPlate && seenBoltPlates.has(incomingPlate)) {
        vehicleFailures++;
        vehicleErrors.push({ boltVehicleId: incomingBoltId || "unknown", message: "Resposta Bolt contém matrícula duplicada; registo ignorado." });
        continue;
      }
      if (incomingBoltId) seenBoltVehicleIds.add(incomingBoltId);
      if (incomingPlate) seenBoltPlates.add(incomingPlate);
      try {
        const result = await upsertVehicle(admin, vehicle, now);
        if (result.created) vehiclesCreated++;
        else vehiclesUpdated++;
        const boltId = normalizeVehicleId(vehicle);
        const plate = normalizePlate(vehicle);
        if (boltId) vehicleByBoltId.set(boltId, result.row);
        if (plate) vehicleByPlate.set(plate, result.row);
      } catch (error) {
        vehicleFailures++;
        vehicleErrors.push({
          boltVehicleId: normalizeVehicleId(vehicle) || "unknown",
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }
    if (vehicleFailures > 0) {
      console.error("bolt-sync vehicle validation failures", {
        count: vehicleFailures,
        vehicleIds: vehicleErrors.map((item) => item.boltVehicleId)
      });
      return json({
        ok: false, partial: vehiclesCreated + vehiclesUpdated > 0,
        source: "bolt", syncedAt: now,
        vehicles: { received: boltVehicles.length, created: vehiclesCreated, updated: vehiclesUpdated, failed: vehicleFailures },
        vehicleErrors,
        error: "A sincronização de viaturas teve falhas; a sincronização de motoristas foi interrompida para evitar atribuições incompletas."
      }, 200);
    }
    if (vehiclesCreated + vehiclesUpdated !== boltVehicles.length) {
      return json({
        ok: false, partial: true, source: "bolt", syncedAt: now,
        vehicles: { received: boltVehicles.length, created: vehiclesCreated, updated: vehiclesUpdated, failed: boltVehicles.length - vehiclesCreated - vehiclesUpdated },
        error: "A contagem de viaturas processadas não corresponde à resposta Bolt; sincronização interrompida."
      }, 200);
    }
    let driversCreated = 0, driversUpdated = 0, assignmentsUpdated = 0, assignmentFailures = 0;
    const assignmentErrors: Array<{ boltDriverId: string; message: string }> = [];
    const seenBoltDriverIds = new Set<string>();
    const seenBoltDriverEmails = new Set<string>();
    const seenBoltDriverPhones = new Set<string>();
    let invalidDriverRecords = 0;
    for (const driver of boltDrivers) {
      const incomingDriverId = normalizeDriverId(driver);
      if (!incomingDriverId) {
        invalidDriverRecords++;
        assignmentFailures++;
        assignmentErrors.push({ boltDriverId: "unknown", message: "Registo Bolt sem identificador estável de motorista; registo ignorado." });
        continue;
      }
      if (seenBoltDriverIds.has(incomingDriverId)) {
        invalidDriverRecords++;
        assignmentFailures++;
        assignmentErrors.push({ boltDriverId: incomingDriverId, message: "Resposta Bolt contém UUID de motorista duplicado; registo ignorado." });
        continue;
      }
      const incomingEmail = normalizeEmail(first(driver, ["email"]));
      const incomingPhone = normalizePhone(first(driver, ["phone", "phone_number"]));
      if (incomingEmail && seenBoltDriverEmails.has(incomingEmail)) {
        invalidDriverRecords++;
        assignmentFailures++;
        assignmentErrors.push({ boltDriverId: incomingDriverId, message: "Resposta Bolt contém email duplicado; registo ignorado." });
        continue;
      }
      if (incomingPhone && seenBoltDriverPhones.has(incomingPhone)) {
        invalidDriverRecords++;
        assignmentFailures++;
        assignmentErrors.push({ boltDriverId: incomingDriverId, message: "Resposta Bolt contém telefone duplicado; registo ignorado." });
        continue;
      }
      seenBoltDriverIds.add(incomingDriverId);
      if (incomingEmail) seenBoltDriverEmails.add(incomingEmail);
      if (incomingPhone) seenBoltDriverPhones.add(incomingPhone);
      try {
        const result = await upsertDriver(admin, driver, vehicleByBoltId, vehicleByPlate, now);
        if (result.created) driversCreated++;
        else driversUpdated++;
        if (result.assignedVehicleId) assignmentsUpdated++;
      } catch (error) {
        assignmentFailures++;
        const safeMessage = safeErrorMessage(error);
        const isCompensationFailure = /falha crítica de compensação/i.test(safeMessage);
        assignmentErrors.push({
          boltDriverId: normalizeDriverId(driver) || "unknown",
          message: safeMessage,
          ...(isCompensationFailure ? { severity: "critical" as const, requiresManualReview: true } : {})
        });
        console.error("bolt-sync driver processing failed", {
          boltDriverId: normalizeDriverId(driver) || "unknown",
          error: safeMessage,
          ...(isCompensationFailure ? { severity: "critical", requiresManualReview: true } : {})
        });
        // Continue syncing other drivers, but report partial failure explicitly.
      }
    }
    return json({
      ok: assignmentFailures === 0, partial: assignmentFailures > 0,
      source: "bolt", syncedAt: now,
      drivers: { received: boltDrivers.length, created: driversCreated, updated: driversUpdated },
      vehicles: { received: boltVehicles.length, created: vehiclesCreated, updated: vehiclesUpdated },
      assignmentsUpdated, assignmentFailures, invalidDriverRecords, assignmentErrors
    }, 200);
  } catch (error) {
    const safeMessage = safeErrorMessage(error);
    console.error("bolt-sync error", safeMessage);
    return json({ ok: false, error: safeMessage }, 500);
  }
});
