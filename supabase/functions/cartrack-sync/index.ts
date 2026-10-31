import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.105.4";

const allowedOrigin = "https://fleet.simplicity2take.com";
const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200, origin = allowedOrigin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Access-Control-Allow-Origin": origin, "Content-Type": "application/json" },
  });
}

const BASE = "https://fleetapi-pt.cartrack.com/rest";

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin") || "";
  if (origin && origin !== allowedOrigin) return json({ success: false, error: "Origem não autorizada." }, 403);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "Método não permitido." }, 405);

  try {
    const authorization = req.headers.get("Authorization") || "";
    if (!authorization.startsWith("Bearer ")) return json({ success: false, error: "Sessão não encontrada." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const username = Deno.env.get("CARTRACK_USERNAME");
    const password = Deno.env.get("CARTRACK_PASSWORD");
    if (!supabaseUrl || !anonKey || !serviceKey) {
      return json({ success: false, error: "Configuração do servidor incompleta." }, 503);
    }
    if (!username || !password) {
      return json({ success: false, error: "As credenciais Cartrack não estão configuradas." }, 503);
    }

    // Gateway JWT validation proves authentication only; enforce global-admin authorization here.
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: userError } = await callerClient.auth.getUser();
    if (userError || !user) return json({ success: false, error: "Sessão inválida." }, 401);

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: profile, error: profileError } = await adminClient
      .from("profiles").select("role,status").eq("id", user.id).maybeSingle();
    if (profileError) throw new Error("Não foi possível validar as permissões do utilizador.");
    if (profile?.role !== "admin" || profile?.status !== "Ativo") {
      return json({ success: false, error: "Apenas o administrador global pode sincronizar a Cartrack." }, 403);
    }

    const auth = "Basic " + btoa(username + ":" + password);
    const headers = { Accept: "application/json", Authorization: auth };

    const vehiclesResp = await fetch(BASE + "/vehicles?limit=1000", { headers });
    const vehiclesText = await vehiclesResp.text();
    if (!vehiclesResp.ok) {
      console.warn("CarTrack vehicles request failed", { status: vehiclesResp.status });
      return json({
        success: false,
        stage: "vehicles",
        status: vehiclesResp.status,
        error: "Não foi possível obter a lista de viaturas CarTrack.",
      }, vehiclesResp.status);
    }
    const vehiclesJson = JSON.parse(vehiclesText);
    const vehicles = Array.isArray(vehiclesJson?.data) ? vehiclesJson.data : [];

    const statusResp = await fetch(BASE + "/vehicles/status?odometer_in_km=true", { headers });
    const statusText = await statusResp.text();
    if (!statusResp.ok) {
      console.warn("CarTrack vehicle status request failed", { status: statusResp.status });
      return json({
        success: false,
        stage: "status",
        status: statusResp.status,
        vehiclesFound: vehicles.length,
        error: "Não foi possível obter o estado das viaturas CarTrack.",
      }, statusResp.status);
    }
    const statusJson = JSON.parse(statusText);
    const statuses = Array.isArray(statusJson?.data) ? statusJson.data : [];
    const byRegistration = new Map(statuses.map((x: any) => [String(x.registration ?? "").trim().toUpperCase(), x]));
    const now = new Date().toISOString();

    const rows = vehicles.map((v: any) => {
      const registration = String(v.registration ?? "").trim().toUpperCase();
      const s: any = byRegistration.get(registration) ?? {};
      const eventTs = s.event_ts ? new Date(s.event_ts).toISOString() : null;
      return {
        vehicle_id: v.vehicle_id ?? s.vehicle_id ?? null,
        registration,
        terminal_id: v.terminal_id ?? null,
        terminal_serial: v.terminal_serial ?? null,
        vehicle_name: v.vehicle_name ?? null,
        default_timezone: v.default_timezone ?? null,
        odometer_km: s.odometer == null ? null : Number(s.odometer),
        speed_kmh: s.speed == null ? null : Number(s.speed),
        ignition: s.ignition ?? null,
        idling: s.idling ?? null,
        event_ts: eventTs,
        last_synced_at: now,
        raw: { vehicle: v, status: s },
        updated_at: now,
      };
    }).filter((x: any) => x.registration);

    const snapshots = statuses.map((s: any) => ({
      registration: String(s.registration ?? "").trim().toUpperCase(),
      vehicle_id: s.vehicle_id ?? null,
      observed_at: s.event_ts ? new Date(s.event_ts).toISOString() : now,
      odometer_km: s.odometer == null ? null : Number(s.odometer),
      speed_kmh: s.speed == null ? null : Number(s.speed),
      ignition: s.ignition ?? null,
      idling: s.idling ?? null,
      raw: s,
    })).filter((x: any) => x.registration);

    const { error: syncError } = await adminClient.rpc("sync_cartrack_data", {
      p_vehicles: rows,
      p_snapshots: snapshots,
    });
    if (syncError) {
      console.error("CarTrack database synchronization failed");
      throw new Error("Não foi possível guardar os dados CarTrack.");
    }

    return json({
      success: true,
      vehiclesFound: vehicles.length,
      statusesFound: statuses.length,
      vehiclesSaved: rows.length,
      snapshotsSaved: snapshots.length,
      message: "Cartrack ligado com sucesso. Dados de veículos e estado atual sincronizados.",
    });
  } catch {
    // Provider bodies and SQL exception details may contain credentials,
    // identifiers or internal schema information. Keep them out of client output.
    console.error("CarTrack synchronization failed");
    return json({ success: false, error: "Ocorreu um erro interno na sincronização CarTrack." }, 500);
  }
});
