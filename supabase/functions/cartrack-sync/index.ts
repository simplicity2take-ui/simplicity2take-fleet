import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.105.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://fleet.simplicity2take.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BASE = "https://fleetapi-pt.cartrack.com/rest";

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

class SyncFailure extends Error {
  readonly stage: string;
  readonly httpStatus: number;

  constructor(stage: string, message: string, httpStatus: number) {
    super(message);
    this.stage = stage;
    this.httpStatus = httpStatus;
  }
}

type ProviderRow = {
  registration?: string;
  vehicle_id?: number | string;
  terminal_id?: number | string;
  terminal_serial?: string;
  vehicle_name?: string;
  default_timezone?: string;
  event_ts?: string;
  odometer?: number | string;
  speed?: number | string;
  ignition?: boolean;
  idling?: boolean;
};

function registrationOf(row: ProviderRow) {
  return (row.registration ?? "").trim().toUpperCase();
}

function telemetryNumber(value: unknown): number | null {
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return null;
    if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) value = Number(text);
  }
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new SyncFailure("validation", "A CarTrack devolveu uma leitura de quilometragem ou velocidade inválida.", 502);
  }
  return value;
}

async function readRows(path: string, stage: string, headers: Record<string, string>): Promise<ProviderRow[]> {
  let data: unknown;
  try {
    const response = await fetch(BASE + path, { headers });
    if (!response.ok) throw new Error();
    data = (await response.json())?.data;
  } catch {
    throw new SyncFailure(stage, "Não foi possível ler a resposta CarTrack.", 502);
  }
  if (!Array.isArray(data)) throw new SyncFailure(stage, "A lista recebida da CarTrack é inválida.", 502);
  const seen = new Set<string>();
  for (const row of data) {
    if (!row || typeof row !== "object" || Array.isArray(row) ||
        (row.registration != null && typeof row.registration !== "string")) {
      throw new SyncFailure(stage, "A lista recebida da CarTrack é inválida.", 502);
    }
    const registration = registrationOf(row);
    if (!registration) continue;
    if (seen.has(registration)) {
      throw new SyncFailure("validation", "A resposta CarTrack contém matrículas duplicadas.", 502);
    }
    seen.add(registration);
  }
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "Método não permitido." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json({ success: false, error: "Configuração do servidor incompleta." }, 503);
    const supabase = createClient(supabaseUrl, serviceKey);
    const cronKey = req.headers.get("x-cartrack-sync-key");
    if (cronKey) {
      const { data: allowed, error } = await supabase.rpc("verify_cartrack_sync_key", { candidate: cronKey });
      if (error || allowed !== true) return json({ success: false, error: "Não autorizado." }, 403);
    } else {
      const token = req.headers.get("Authorization")?.replace(/^Bearer /i, "");
      if (!token) return json({ success: false, error: "Não autenticado." }, 401);
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (error || !user) return json({ success: false, error: "Sessão inválida." }, 401);
      const { data: profile, error: profileError } = await supabase.from("profiles")
        .select("role,status").eq("id", user.id).maybeSingle();
      if (profileError || profile?.role !== "admin" || profile?.status !== "Ativo") {
        return json({ success: false, error: "Apenas o administrador pode sincronizar." }, 403);
      }
    }

    const username = Deno.env.get("CARTRACK_USERNAME");
    const password = Deno.env.get("CARTRACK_PASSWORD");
    if (!username || !password) return json({ success: false, error: "Credenciais CarTrack por configurar." }, 503);
    const headers = { Accept: "application/json", Authorization: "Basic " + btoa(username + ":" + password) };
    const vehicles = await readRows("/vehicles?limit=1000", "vehicles", headers);
    const statuses = await readRows("/vehicles/status?odometer_in_km=true", "status", headers);
    const byRegistration = new Map(statuses.map(row => [registrationOf(row), row]));
    const now = new Date().toISOString();

    const rows = vehicles.map(v => {
      const registration = registrationOf(v);
      const s: ProviderRow = byRegistration.get(registration) ?? {};
      if (v.vehicle_id != null && s.vehicle_id != null && String(v.vehicle_id) !== String(s.vehicle_id)) {
        throw new SyncFailure("validation", "Os identificadores da viatura CarTrack não coincidem.", 502);
      }
      const eventTs = s.event_ts ? new Date(s.event_ts).toISOString() : null;
      return {
        vehicle_id: v.vehicle_id ?? s.vehicle_id ?? null,
        registration,
        terminal_id: v.terminal_id ?? null,
        terminal_serial: v.terminal_serial ?? null,
        vehicle_name: v.vehicle_name ?? null,
        default_timezone: v.default_timezone ?? null,
        odometer_km: telemetryNumber(s.odometer),
        speed_kmh: telemetryNumber(s.speed),
        ignition: s.ignition ?? null,
        idling: s.idling ?? null,
        event_ts: eventTs,
        last_synced_at: now,
        raw: { vehicle:v, status:s },
        updated_at: now
      };
    }).filter(x => x.registration);

    const snapshots = statuses.map(s => ({
      registration:registrationOf(s),
      vehicle_id:s.vehicle_id ?? null,
      observed_at:s.event_ts ? new Date(s.event_ts).toISOString() : now,
      odometer_km:telemetryNumber(s.odometer),
      speed_kmh:telemetryNumber(s.speed),
      ignition:s.ignition ?? null,
      idling:s.idling ?? null,
      raw:s
    })).filter(x => x.registration);

    const { error: syncError } = await supabase.rpc("sync_cartrack_data", {
      p_vehicles: rows,
      p_snapshots: snapshots
    });
    if (syncError) throw new SyncFailure("database", "Não foi possível guardar os dados CarTrack.", 500);

    return json({
      success:true,
      vehiclesFound:vehicles.length,
      statusesFound:statuses.length,
      vehiclesSaved:rows.length,
      snapshotsSaved:snapshots.length,
      message:"Cartrack ligado com sucesso. Dados de veículos e estado atual sincronizados."
    }, 200);
  } catch (error) {
    if (error instanceof SyncFailure) {
      return json({ success: false, stage: error.stage, error: error.message }, error.httpStatus);
    }
    return json({ success: false, error: "Ocorreu um erro interno na sincronização CarTrack." }, 500);
  }
});
