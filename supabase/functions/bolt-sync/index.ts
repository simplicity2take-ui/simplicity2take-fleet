import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { clean, first, normalizeActiveVehicle, normalizeDriverId, normalizePlate, normalizeVehicleId, statusToPortal } from "../bolt-sync-utils.ts";
import { getBoltCollection, requestBolt, resolveBoltCompanyId } from "../bolt-api-client.ts";

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
async function planVehicle(admin: any, vehicle: any, companyId: string) {
  const boltId = normalizeVehicleId(vehicle);
  const plate = normalizePlate(vehicle);
  const model = clean(first(vehicle, ["model", "vehicle_model"]));
  const yearValue = first(vehicle, ["year", "vehicle_year"]);
  const year = Number.isFinite(Number(yearValue)) && Number(yearValue) > 1900 ? Number(yearValue) : null;
  const vin = clean(first(vehicle, ["vin", "VIN"]));
  const brand = clean(first(vehicle, ["make", "brand", "vehicle_make"]));
  const state = first(vehicle, ["state", "status"]);
  let existing: any = null;

  if (boltId) {
    const companyResult = await admin.from("vehicles").select("*")
      .eq("bolt_vehicle_uuid", boltId).eq("company_id", companyId).maybeSingle();
    if (companyResult.error) throw new Error("Não foi possível validar a viatura Bolt.");
    existing = companyResult.data;
  }
  if (!existing && boltId) {
    const identityResult = await admin.from("vehicles").select("*")
      .eq("bolt_vehicle_uuid", boltId).maybeSingle();
    if (identityResult.error) throw new Error("Não foi possível validar a identidade Bolt da viatura.");
    if (identityResult.data && identityResult.data.company_id !== companyId) {
      throw new Error("Conflito Bolt: esta viatura já está registada noutra empresa. Não foi alterada.");
    }
    existing = identityResult.data;
  }
  if (!existing && plate) {
    const plateResult = await admin.from("vehicles").select("*")
      .ilike("plate", plate).maybeSingle();
    if (plateResult.error) throw new Error("Não foi possível validar a matrícula da viatura.");
    if (plateResult.data && plateResult.data.company_id !== companyId) {
      throw new Error("Conflito de matrícula: esta viatura já está registada noutra empresa. Não foi alterada.");
    }
    existing = plateResult.data;
  }

  return {
    id: existing?.id || crypto.randomUUID(),
    is_new: !existing,
    plate: plate || existing?.plate || "",
    brand: brand || existing?.brand || "",
    model: model || existing?.model || "",
    vehicle_year: year || existing?.vehicle_year || null,
    vin: vin || existing?.vin || null,
    status: statusToPortal(state, existing?.status || "Inativo"),
    bolt_vehicle_uuid: boltId || existing?.bolt_vehicle_uuid || null
  };
}

async function planDriver(
  admin: any,
  driver: any,
  vehicleByBoltId: Map<string, any>,
  vehicleByPlate: Map<string, any>,
  companyId: string
) {
  const boltId = normalizeDriverId(driver);
  const partnerUuid = clean(first(driver, ["partner_uuid", "partnerUuid"]));
  const firstName = clean(first(driver, ["first_name", "firstName"]));
  const lastName = clean(first(driver, ["last_name", "lastName"]));
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim() ||
    clean(first(driver, ["display_name", "name"]));
  const email = clean(first(driver, ["email"]));
  const phone = clean(first(driver, ["phone", "phone_number"]));
  const state = first(driver, ["state", "status"]);
  const activeVehicle = normalizeActiveVehicle(driver);
  const activeVehicleId = normalizeVehicleId(activeVehicle);
  const activePlate = normalizePlate(activeVehicle);
  let existing: any = null;

  if (boltId) {
    const companyResult = await admin.from("drivers").select("*")
      .eq("bolt_driver_uuid", boltId).eq("company_id", companyId).maybeSingle();
    if (companyResult.error) throw new Error("Não foi possível validar o motorista Bolt.");
    existing = companyResult.data;
  }
  if (!existing && boltId) {
    const identityResult = await admin.from("drivers").select("*")
      .eq("bolt_driver_uuid", boltId).maybeSingle();
    if (identityResult.error) throw new Error("Não foi possível validar a identidade Bolt do motorista.");
    if (identityResult.data && identityResult.data.company_id !== companyId) {
      throw new Error("Conflito Bolt: este motorista já está registado noutra empresa. Não foi alterado.");
    }
    existing = identityResult.data;
  }
  if (!existing && email) {
    const emailResult = await admin.from("drivers").select("*")
      .ilike("email", email).eq("company_id", companyId).maybeSingle();
    if (emailResult.error) throw new Error("Não foi possível validar o email do motorista.");
    existing = emailResult.data;
  }
  if (!existing && phone) {
    const phoneResult = await admin.from("drivers").select("*")
      .eq("phone", phone).eq("company_id", companyId).maybeSingle();
    if (phoneResult.error) throw new Error("Não foi possível validar o telefone do motorista.");
    existing = phoneResult.data;
  }

  let assignedVehicle = activeVehicleId ? vehicleByBoltId.get(activeVehicleId) : null;
  if (!assignedVehicle && activePlate) assignedVehicle = vehicleByPlate.get(activePlate) || null;

  return {
    id: existing?.id || crypto.randomUUID(),
    is_new: !existing,
    full_name: fullName || existing?.full_name || "Motorista Bolt",
    email: email || existing?.email || null,
    phone: phone || existing?.phone || null,
    status: statusToPortal(state, existing?.status || "Inativo"),
    bolt_driver_uuid: boltId || existing?.bolt_driver_uuid || null,
    bolt_partner_uuid: partnerUuid || existing?.bolt_partner_uuid || null,
    assigned_vehicle_id: assignedVehicle?.id || null
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return json({ ok: false, error: "Método não permitido." }, 405);
  }
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const userToken = authHeader.replace(/^Bearer\s+/i, "");
    if (!userToken) return json({ ok: false, error: "Sessão não encontrada." }, 401);
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: authData, error: authError } = await admin.auth.getUser(userToken);
    if (authError || !authData.user) return json({ ok: false, error: "Sessão inválida." }, 401);
    const { data: callerProfile, error: profileError } = await admin
      .from("profiles")
      .select("id, role, status")
      .eq("id", authData.user.id)
      .maybeSingle();
    if (profileError) throw new Error("Não foi possível validar as permissões do utilizador.");
    const isGlobalAdmin = callerProfile?.role === "admin" &&
      (callerProfile?.status == null || callerProfile.status === "Ativo");
    if (!isGlobalAdmin) return json({ ok: false, error: "Apenas um administrador global pode sincronizar a Bolt." }, 403);

    // This integration currently belongs exclusively to Simplicity2Take.
    // Resolve the trusted company key server-side; never accept company_id from the request.
    const { data: company, error: companyError } = await admin
      .from("companies")
      .select("id, status")
      .eq("slug", "simplicity2take")
      .eq("status", "Ativa")
      .maybeSingle();
    if (companyError) throw companyError;
    if (!company?.id) return json({ ok: false, error: "Empresa Simplicity2Take não encontrada. Confirme primeiro a migração de empresas." }, 409);
    const companyId = String(company.id);

    const token = await getBoltToken();
    const accessibleCompanies = await requestBolt(
      fetch,
      BOLT_API_BASE,
      "/fleetIntegration/v2/getCompanies",
      token,
    );
    const boltCompanyId = resolveBoltCompanyId(Deno.env.get("BOLT_COMPANY_ID"), accessibleCompanies);
    const [boltDrivers, boltVehicles] = await Promise.all([
      getBoltCollection(fetch, BOLT_API_BASE, "/fleetIntegration/v2/getDrivers", token, boltCompanyId, "drivers"),
      getBoltCollection(fetch, BOLT_API_BASE, "/fleetIntegration/v2/getVehicles", token, boltCompanyId, "vehicles"),
    ]);
    if (!boltDrivers.length && !boltVehicles.length) {
      return json({ ok: false, error: "A Bolt não devolveu motoristas nem viaturas para a empresa configurada." }, 502);
    }

    const now = new Date().toISOString();
    const vehiclePlans: any[] = [];
    const vehicleByBoltId = new Map<string, any>();
    const vehicleByPlate = new Map<string, any>();

    for (const vehicle of boltVehicles) {
      const plan = await planVehicle(admin, vehicle, companyId);
      vehiclePlans.push(plan);
      const mappedVehicle = { id: plan.id };
      const boltId = normalizeVehicleId(vehicle);
      const plate = normalizePlate(vehicle);
      if (boltId) vehicleByBoltId.set(boltId, mappedVehicle);
      if (plate) vehicleByPlate.set(plate, mappedVehicle);
    }

    const driverPlans: any[] = [];
    for (const driver of boltDrivers) {
      driverPlans.push(await planDriver(admin, driver, vehicleByBoltId, vehicleByPlate, companyId));
    }

    const syncResult = await admin.rpc("s2t_apply_bolt_fleet_sync", {
      p_company_id: companyId,
      p_vehicles: vehiclePlans,
      p_drivers: driverPlans,
      p_synced_at: now
    });
    if (syncResult.error) {
      if (["23505", "23514", "P0002"].includes(syncResult.error.code)) {
        return json({
          ok: false,
          error: "A sincronização Bolt encontrou um conflito de identidade ou atribuição. Nenhuma alteração foi gravada."
        }, 409);
      }
      throw new Error("A sincronização Bolt falhou; nenhuma alteração foi gravada.");
    }
    if (!syncResult.data || typeof syncResult.data !== "object" || Array.isArray(syncResult.data)) {
      throw new Error("A sincronização Bolt devolveu um resultado inválido.");
    }

    return json({ ok: true, source: "bolt", syncedAt: now, ...syncResult.data });
  } catch (error) {
    console.error("bolt-sync error", error);
    return json({ ok: false, error: "Não foi possível concluir a sincronização Bolt. Verifique a configuração e tente novamente." }, 500);
  }
});
