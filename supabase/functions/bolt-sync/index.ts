import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://fleet.simplicity2take.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

const BOLT_TOKEN_URL = "https://oidc.bolt.eu/token";
const BOLT_API_BASE = "https://node.bolt.eu/fleet-integration-gateway-v2";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}
import { assertCompatibleExternalId, assertNoDuplicateExternalIdentity, assertRequiredExternalIdentities, clean, decideAssignment, hasOtherDriverAssignment, first, normalizeActiveVehicle, normalizeDriverId, normalizePlate, normalizeVehicleId, safeSyncError, statusForSync, statusToPortal, isBoltWriteAllowed, isActiveGlobalAdmin } from "./normalization.ts";
import { extractBoltCompanies, fetchAllBoltPages } from "./bolt-v2.ts";

async function getBoltToken() {
  const clientId = Deno.env.get("BOLT_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("BOLT_CLIENT_SECRET") || "";
  if (!clientId || !clientSecret) throw new Error("Faltam BOLT_CLIENT_ID e BOLT_CLIENT_SECRET nos Secrets do Supabase.");
  const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials", scope: "fleet-integration:api" });
  const response = await fetch(BOLT_TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const text = await response.text();
  let data: any = {};
  try { data = JSON.parse(text); } catch {}
  if (!response.ok || !data.access_token) throw new Error("A Bolt recusou a autenticação API. Verifique as credenciais e o acesso Fleet Integration.");
  return data.access_token as string;
}
let lastBoltRequestAt = 0;
async function boltPost(path: string, token: string, payload?: unknown) {
  // Stay below the documented limit of 2 requests/second/API key.
  const waitMs = Math.max(0, 550 - (Date.now() - lastBoltRequestAt));
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  const response = await fetch(BOLT_API_BASE + path, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) })
  });
  lastBoltRequestAt = Date.now();
  const text = await response.text();
  let data: any = {};
  try { data = JSON.parse(text); } catch { throw new Error("A Bolt devolveu uma resposta que não é JSON válido."); }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("A Bolt recusou a autenticação ou as permissões da integração Fleet. Verifique o acesso autorizado.");
    }
    if (response.status === 429) throw new Error("A Bolt limitou temporariamente os pedidos da integração. Tente novamente mais tarde.");
    throw new Error("A API Bolt recusou o pedido. Verifique o contrato e as permissões da integração.");
  }
  return data;
}
async function fetchBoltDrivers(token: string, companyId: number) {
  return await fetchAllBoltPages<any>(
    (offset, limit) => boltPost("/fleetIntegration/v2/getDrivers", token, { company_id: companyId, offset, limit }),
    "drivers",
  );
}
async function fetchBoltVehicles(token: string, companyId: number) {
  return await fetchAllBoltPages<any>(
    (offset, limit) => boltPost("/fleetIntegration/v2/getVehicles", token, { company_id: companyId, offset, limit }),
    "vehicles",
  );
}
async function upsertVehicle(admin: any, vehicle: any, now: string) {
  const boltId = normalizeVehicleId(vehicle);
  const plate = normalizePlate(vehicle);
  if (!boltId && !plate) {
    throw new Error("A Bolt devolveu uma viatura sem UUID nem matrícula. Sincronização interrompida para evitar criar registos duplicados.");
  }
  const model = clean(first(vehicle, ["model", "vehicle_model"]));
  const yearValue = first(vehicle, ["year", "vehicle_year"]);
  const year = Number.isFinite(Number(yearValue)) && Number(yearValue) > 1900 ? Number(yearValue) : null;
  const vin = clean(first(vehicle, ["vin", "VIN"]));
  const state = first(vehicle, ["state", "status"]);
  let existing: any = null;
  if (boltId) {
    const lookup = await admin.from("vehicles").select("*").eq("bolt_vehicle_uuid", boltId).maybeSingle();
    if (lookup.error) throw new Error("Não foi possível validar a viatura pela referência Bolt; sincronização interrompida para evitar duplicados.");
    existing = lookup.data;
  }
  if (!existing && plate) {
    const lookup = await admin.from("vehicles").select("*").eq("plate", plate).maybeSingle();
    if (lookup.error) throw new Error("Não foi possível validar a matrícula da viatura; sincronização interrompida para evitar duplicados.");
    existing = lookup.data;
  }
  assertCompatibleExternalId(boltId, existing?.bolt_vehicle_uuid, "da viatura");
  const payload: any = {
    plate: plate || existing?.plate || "",
    model: model || existing?.model || "",
    vehicle_year: year || existing?.vehicle_year || null,
    vin: vin || existing?.vin || null,
    status: existing ? statusForSync(state, existing.status) : statusToPortal(state, "Inativo"),
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
  const email = clean(first(driver, ["email"]));
  const phone = clean(first(driver, ["phone", "phone_number"]));
  if (!boltId && !email && !phone) {
    throw new Error("A Bolt devolveu um motorista sem UUID, email nem telefone. Sincronização interrompida para evitar criar registos duplicados.");
  }
  const state = first(driver, ["state", "status"]);
  const activeVehicle = normalizeActiveVehicle(driver);
  const activeVehicleId = normalizeVehicleId(activeVehicle);
  const activePlate = normalizePlate(activeVehicle);
  let existing: any = null;
  if (boltId) {
    const lookup = await admin.from("drivers").select("*").eq("bolt_driver_uuid", boltId).maybeSingle();
    if (lookup.error) throw new Error("Não foi possível validar o motorista pela referência Bolt; sincronização interrompida para evitar duplicados.");
    existing = lookup.data;
  }
  if (!existing && email) {
    const lookup = await admin.from("drivers").select("*").ilike("email", email).maybeSingle();
    if (lookup.error) throw new Error("O email do motorista corresponde a registos ambíguos; sincronização interrompida para revisão manual.");
    existing = lookup.data;
  }
  if (!existing && phone) {
    const lookup = await admin.from("drivers").select("*").eq("phone", phone).maybeSingle();
    if (lookup.error) throw new Error("O telefone do motorista corresponde a registos ambíguos; sincronização interrompida para revisão manual.");
    existing = lookup.data;
  }
  assertCompatibleExternalId(boltId, existing?.bolt_driver_uuid, "do motorista");
  const payload: any = {
    full_name: fullName || existing?.full_name || "Motorista Bolt",
    email: email || existing?.email || null,
    phone: phone || existing?.phone || null,
    status: existing ? statusForSync(state, existing.status) : statusToPortal(state, "Inativo"),
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
    row = result.data; created = true;
  }
  let assignedVehicle = activeVehicleId ? vehicleByBoltId.get(activeVehicleId) : null;
  if (!assignedVehicle && activePlate) assignedVehicle = vehicleByPlate.get(activePlate) || null;
  let assignmentAction: "none" | "unchanged" | "created" | "conflict" = "none";
  if (assignedVehicle?.id) {
    // Never delete assignment history during an external sync. If a different
    // active assignment exists, flag it for review instead of silently replacing it.
    const assignmentDate = new Date().toISOString().slice(0, 10);
    const activeResult = await admin.from("vehicle_assignments")
      .select("id, vehicle_id")
      .eq("driver_id", row.id)
      .lte("active_from", assignmentDate)
      .or(`active_until.is.null,active_until.gte.${assignmentDate}`);
    if (activeResult.error) throw activeResult.error;
    const activeAssignments = activeResult.data || [];

    // Check the other side of the relationship as well: another driver may
    // already have this vehicle active. This is a fail-closed pre-insert check;
    // a database transaction/constraint is still required to prevent races.
    const vehicleActiveResult = await admin.from("vehicle_assignments")
      .select("id, driver_id")
      .eq("vehicle_id", assignedVehicle.id)
      .lte("active_from", assignmentDate)
      .or(`active_until.is.null,active_until.gte.${assignmentDate}`);
    if (vehicleActiveResult.error) throw vehicleActiveResult.error;
    const vehicleHasOtherDriver = hasOtherDriverAssignment(
      vehicleActiveResult.data || [],
      row.id,
    );

    const decision = decideAssignment(activeAssignments, assignedVehicle.id);
    if (vehicleHasOtherDriver) {
      assignmentAction = "conflict";
    } else if (decision === "unchanged") {
      assignmentAction = "unchanged";
    } else if (decision === "conflict") {
      assignmentAction = "conflict";
    } else {
      const assignment = await admin.from("vehicle_assignments").insert({
        vehicle_id: assignedVehicle.id,
        driver_id: row.id,
        active_from: new Date().toISOString().slice(0, 10),
        active_until: null,
        source: "bolt"
      });
      if (assignment.error) throw assignment.error;
      assignmentAction = "created";
    }
  }
  return { row, created, assignedVehicleId: assignedVehicle?.id || null, assignmentAction };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Método não permitido." }, 405);
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const userToken = authHeader.replace(/^Bearer\s+/i, "");
    if (!userToken) return json({ ok: false, error: "Sessão não encontrada." }, 401);
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: authData, error: authError } = await admin.auth.getUser(userToken);
    if (authError || !authData.user) return json({ ok: false, error: "Sessão inválida." }, 401);
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("role,status")
      .eq("id", authData.user.id)
      .maybeSingle();
    if (profileError || !isActiveGlobalAdmin(profile)) {
      return json({ ok: false, error: "Apenas um administrador ativo pode sincronizar a Bolt." }, 403);
    }

    const token = await getBoltToken();
    const companiesPayload = await boltPost("/fleetIntegration/v2/getCompanies", token);
    const companies = extractBoltCompanies(companiesPayload);
    // The current Fleet database does not yet enforce tenant-scoped writes.
    // Fail closed if the Bolt key exposes more than one company; never mix fleets.
    if (companies.length !== 1) {
      return json({
        ok: false,
        error: companies.length === 0
          ? "A chave Bolt não devolveu nenhuma empresa acessível."
          : "A chave Bolt tem acesso a várias empresas. A sincronização está bloqueada até existir mapeamento e isolamento por empresa."
      }, 409);
    }
    const companyId = companies[0].company_id;
    const boltDrivers = await fetchBoltDrivers(token, companyId);
    const boltVehicles = await fetchBoltVehicles(token, companyId);
    if (!boltDrivers.length && !boltVehicles.length) {
      return json({ ok: false, error: "A Bolt devolveu motoristas e viaturas vazios. Sincronização interrompida para revisão." }, 502);
    }

    // Validate the full response before any database writes, so duplicate source
    // identities cannot cause partial or ambiguous upserts.
    // Check the identity actually used for matching, including fallback fields,
    // before any database writes. This prevents duplicate fallback identities
    // (email/phone or registration) from reaching the upsert loops.
    // Validate each fallback channel independently. A unique UUID must not
    // hide duplicate emails, phone numbers, or registrations in other records.
    assertNoDuplicateExternalIdentity(
      boltDrivers,
      "UUID de motorista",
      (driver: any) => normalizeDriverId(driver),
    );
    assertNoDuplicateExternalIdentity(
      boltDrivers,
      "email de motorista",
      (driver: any) => clean(first(driver, ["email"])).trim().toLowerCase(),
    );
    assertNoDuplicateExternalIdentity(
      boltDrivers,
      "telefone de motorista",
      (driver: any) => clean(first(driver, ["phone", "phone_number"])).replace(/\s+/g, ""),
    );
    assertNoDuplicateExternalIdentity(
      boltVehicles,
      "UUID de viatura",
      (vehicle: any) => normalizeVehicleId(vehicle),
    );
    assertNoDuplicateExternalIdentity(
      boltVehicles,
      "matrícula de viatura",
      (vehicle: any) => normalizePlate(vehicle).replace(/[\s-]+/g, "").toUpperCase(),
    );
    assertRequiredExternalIdentities(
      boltDrivers,
      "motorista",
      (driver: any) => normalizeDriverId(driver) || clean(first(driver, ["email"])) || clean(first(driver, ["phone", "phone_number"])),
    );
    assertRequiredExternalIdentities(
      boltVehicles,
      "viatura",
      (vehicle: any) => normalizeVehicleId(vehicle) || normalizePlate(vehicle),
    );

    // Explicit preview mode: validate Bolt responses and identities, then return counts
    // without querying or writing Fleet tables. This is safe for first credential checks.
    const requestBody = await req.clone().json().catch(() => ({}));
    if (requestBody?.dry_run === true) {
      return json({
        ok: true,
        mode: "dry_run",
        source: "bolt",
        companyId,
        preview: true,
        driversReceived: boltDrivers.length,
        vehiclesReceived: boltVehicles.length,
        writesPerformed: false,
        note: "Os dados foram validados em memória; não foram consultados nem alterados registos do Fleet."
      });
    }

    // Fail closed: write mode requires both an explicit server-side opt-in and
    // an explicit per-request confirmation. Neither is enabled by this change.
    const writesEnabled = Deno.env.get("BOLT_SYNC_ALLOW_WRITES");
    if (!isBoltWriteAllowed(writesEnabled, requestBody?.confirm_write)) {
      return json({
        ok: false,
        code: "BOLT_SYNC_WRITES_DISABLED",
        error: "A sincronização com gravações está bloqueada. Use dry_run para pré-visualizar; a ativação exige configuração e aprovação explícitas.",
        writesPerformed: false
      }, 409);
    }

    const now = new Date().toISOString();
    const vehicleByBoltId = new Map<string, any>();
    const vehicleByPlate = new Map<string, any>();
    let vehiclesCreated = 0;
    for (const vehicle of boltVehicles) {
      const result = await upsertVehicle(admin, vehicle, now);
      if (result.created) vehiclesCreated++;
      const boltId = normalizeVehicleId(vehicle);
      const plate = normalizePlate(vehicle);
      if (boltId) vehicleByBoltId.set(boltId, result.row);
      if (plate) vehicleByPlate.set(plate, result.row);
    }
    let driversCreated = 0, assignmentsCreated = 0, assignmentsConflicts = 0;
    for (const driver of boltDrivers) {
      const result = await upsertDriver(admin, driver, vehicleByBoltId, vehicleByPlate, now);
      if (result.created) driversCreated++;
      if (result.assignmentAction === "created") assignmentsCreated++;
      if (result.assignmentAction === "conflict") assignmentsConflicts++;
    }
    return json({
      ok: true, source: "bolt", syncedAt: now,
      drivers: { received: boltDrivers.length, created: driversCreated, updated: boltDrivers.length - driversCreated },
      vehicles: { received: boltVehicles.length, created: vehiclesCreated, updated: boltVehicles.length - vehiclesCreated },
      assignments: { created: assignmentsCreated, conflictsRequiringReview: assignmentsConflicts }
    });
  } catch (error) {
    // Do not return or log raw provider/database exceptions; they may contain
    // internal schema details or sensitive request/response data.
    const safeError = safeSyncError(error);
    console.error("bolt-sync failed", { code: safeError.code });
    return json({ ok: false, ...safeError }, 500);
  }
});
