import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://fleet.simplicity2take.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

const BOLT_TOKEN_URL = "https://oidc.bolt.eu/token";
const BOLT_API_BASE = "https://node.bolt.eu/fleet-integration-gateway";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}
function clean(value: unknown) { return value === undefined || value === null ? "" : String(value); }
function first(obj: any, keys: string[]) {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}
function arrayFrom(payload: any, keys: string[]) {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) if (Array.isArray(payload?.[key])) return payload[key];
  for (const key of ["data", "result", "response"]) {
    if (payload?.[key] && typeof payload[key] === "object") {
      const nested = arrayFrom(payload[key], keys);
      if (nested.length) return nested;
    }
  }
  return [];
}
function statusToPortal(value: unknown, current = "Ativo") {
  const s = clean(value).toLowerCase();
  if (!s) return current || "Ativo";
  if (/(suspend|blocked|deactiv|inactive|terminated|banned|disabled)/.test(s)) return "Inativo";
  if (/(active|activated|enabled|approved)/.test(s)) return "Ativo";
  return current || "Ativo";
}
function normalizeVehicleId(vehicle: any) { return clean(first(vehicle, ["uuid", "vehicle_uuid", "id"])); }
function normalizePlate(vehicle: any) { return clean(first(vehicle, ["reg_number", "registration_number", "plate", "license_plate"])); }
function normalizeDriverId(driver: any) { return clean(first(driver, ["driver_uuid", "uuid", "id"])); }
function normalizeActiveVehicle(driver: any) {
  const v = driver?.active_vehicle;
  return v && typeof v === "object" ? v : null;
}
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
async function boltPost(path: string, token: string) {
  const attempts = [{ pager: { offset: 0, limit: 1000 } }, { page: { offset: 0, limit: 1000 } }, {}];
  let lastError = "Pedido Bolt recusado.";
  for (const payload of attempts) {
    const response = await fetch(BOLT_API_BASE + path, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload)
    });
    const text = await response.text();
    let data: any = {};
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (response.ok) return data;
    lastError = clean(data?.message || data?.error || text || lastError);
  }
  throw new Error(lastError);
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
  if (boltId) existing = (await admin.from("vehicles").select("*").eq("bolt_vehicle_uuid", boltId).maybeSingle()).data;
  if (!existing && plate) existing = (await admin.from("vehicles").select("*").eq("plate", plate).maybeSingle()).data;
  const payload: any = {
    plate: plate || existing?.plate || "",
    model: model || existing?.model || "",
    vehicle_year: year || existing?.vehicle_year || null,
    vin: vin || existing?.vin || null,
    status: statusToPortal(state, existing?.status || "Ativo"),
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
  const state = first(driver, ["state", "status"]);
  const activeVehicle = normalizeActiveVehicle(driver);
  const activeVehicleId = normalizeVehicleId(activeVehicle);
  const activePlate = normalizePlate(activeVehicle);
  let existing: any = null;
  if (boltId) existing = (await admin.from("drivers").select("*").eq("bolt_driver_uuid", boltId).maybeSingle()).data;
  if (!existing && email) existing = (await admin.from("drivers").select("*").ilike("email", email).maybeSingle()).data;
  if (!existing && phone) existing = (await admin.from("drivers").select("*").eq("phone", phone).maybeSingle()).data;
  const payload: any = {
    full_name: fullName || existing?.full_name || "Motorista Bolt",
    email: email || existing?.email || null,
    phone: phone || existing?.phone || null,
    status: statusToPortal(state, existing?.status || "Ativo"),
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
  if (assignedVehicle?.id) {
    await admin.from("vehicle_assignments").delete().eq("driver_id", row.id);
    const assignment = await admin.from("vehicle_assignments").insert({
      vehicle_id: assignedVehicle.id, driver_id: row.id, active_from: new Date().toISOString().slice(0, 10), active_until: null
    });
    if (assignment.error) throw assignment.error;
  }
  return { row, created, assignedVehicleId: assignedVehicle?.id || null };
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

    const token = await getBoltToken();
    const [driversPayload, vehiclesPayload] = await Promise.all([
      boltPost("/fleetIntegration/v1/getDrivers", token),
      boltPost("/fleetIntegration/v1/getVehicles", token)
    ]);
    const boltDrivers = arrayFrom(driversPayload, ["drivers", "fleet_drivers", "items"]);
    const boltVehicles = arrayFrom(vehiclesPayload, ["vehicles", "fleet_vehicles", "items"]);
    if (!boltDrivers.length && !boltVehicles.length) return json({ ok: false, error: "A Bolt respondeu sem motoristas nem viaturas. Confirme no Swagger os parâmetros de paginação da tua conta." }, 502);

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
    let driversCreated = 0, assignmentsUpdated = 0;
    for (const driver of boltDrivers) {
      const result = await upsertDriver(admin, driver, vehicleByBoltId, vehicleByPlate, now);
      if (result.created) driversCreated++;
      if (result.assignedVehicleId) assignmentsUpdated++;
    }
    return json({
      ok: true, source: "bolt", syncedAt: now,
      drivers: { received: boltDrivers.length, created: driversCreated, updated: boltDrivers.length - driversCreated },
      vehicles: { received: boltVehicles.length, created: vehiclesCreated, updated: boltVehicles.length - vehiclesCreated },
      assignmentsUpdated
    });
  } catch (error) {
    console.error("bolt-sync error", error);
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
