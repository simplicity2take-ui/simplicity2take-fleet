import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.105.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://fleet.simplicity2take.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BASE = "https://fleetapi-pt.cartrack.com/rest";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (req.method !== "POST") return new Response(JSON.stringify({success:false,error:"Método não permitido."}), {status:405,headers:{...corsHeaders,"Content-Type":"application/json"}});

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);
  const cronKey = req.headers.get("x-cartrack-sync-key");
  if (cronKey) {
    const { data: allowed, error } = await supabase.rpc("verify_cartrack_sync_key", { candidate: cronKey });
    if (error || allowed !== true) return new Response(JSON.stringify({success:false,error:"Não autorizado."}), {status:403,headers:{...corsHeaders,"Content-Type":"application/json"}});
  } else {
    const token = req.headers.get("Authorization")?.replace(/^Bearer /i, "");
    if (!token) return new Response(JSON.stringify({success:false,error:"Não autenticado."}), {status:401,headers:{...corsHeaders,"Content-Type":"application/json"}});
    const {data: {user}, error} = await supabase.auth.getUser(token);
    if (error || !user) return new Response(JSON.stringify({success:false,error:"Sessão inválida."}), {status:401,headers:{...corsHeaders,"Content-Type":"application/json"}});
    const {data: profile, error: profileError} = await supabase.from("profiles").select("role,status").eq("id", user.id).maybeSingle();
    if (profileError || profile?.role !== "admin" || profile?.status !== "Ativo") return new Response(JSON.stringify({success:false,error:"Apenas o administrador pode sincronizar."}), {status:403,headers:{...corsHeaders,"Content-Type":"application/json"}});
  }
  const username = Deno.env.get("CARTRACK_USERNAME");
  const password = Deno.env.get("CARTRACK_PASSWORD");

  if (!username || !password) {
    return new Response(JSON.stringify({ success:false, error:"Cartrack credentials are not configured." }), {
      status:500, headers:{...corsHeaders,"Content-Type":"application/json"}
    });
  }

  const auth = "Basic " + btoa(username + ":" + password);
  const headers = { "Accept":"application/json", "Authorization":auth };

  try {
    const vehiclesResp = await fetch(BASE + "/vehicles?limit=1000", { headers });
    const vehiclesText = await vehiclesResp.text();
    if (!vehiclesResp.ok) {
      return new Response(JSON.stringify({success:false, stage:"vehicles", status:vehiclesResp.status, error:vehiclesText.slice(0,1000)}), {
        status:vehiclesResp.status, headers:{...corsHeaders,"Content-Type":"application/json"}
      });
    }
    const vehiclesJson = JSON.parse(vehiclesText);
    const vehicles = Array.isArray(vehiclesJson?.data) ? vehiclesJson.data : [];

    const statusResp = await fetch(BASE + "/vehicles/status?odometer_in_km=true", { headers });
    const statusText = await statusResp.text();
    if (!statusResp.ok) {
      return new Response(JSON.stringify({success:false, stage:"status", status:statusResp.status, error:statusText.slice(0,1000), vehiclesFound:vehicles.length}), {
        status:statusResp.status, headers:{...corsHeaders,"Content-Type":"application/json"}
      });
    }
    const statusJson = JSON.parse(statusText);
    const statuses = Array.isArray(statusJson?.data) ? statusJson.data : [];
    const byRegistration = new Map(statuses.map((x:any)=>[String(x.registration).toUpperCase(),x]));
    const now = new Date().toISOString();

    const rows = vehicles.map((v:any)=>{
      const registration = String(v.registration ?? "").trim().toUpperCase();
      const s = byRegistration.get(registration) ?? {};
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
        raw: { vehicle:v, status:s },
        updated_at: now
      };
    }).filter((x:any)=>x.registration);

    const snapshots = statuses.map((s:any)=>({
      registration:String(s.registration ?? "").trim().toUpperCase(),
      vehicle_id:s.vehicle_id ?? null,
      observed_at:s.event_ts ? new Date(s.event_ts).toISOString() : now,
      odometer_km:s.odometer == null ? null : Number(s.odometer),
      speed_kmh:s.speed == null ? null : Number(s.speed),
      ignition:s.ignition ?? null,
      idling:s.idling ?? null,
      raw:s
    })).filter((x:any)=>x.registration);

    const { data: syncResult, error: syncError } = await supabase.rpc("sync_cartrack_data", {
      p_vehicles: rows,
      p_snapshots: snapshots
    });
    if (syncError) throw new Error("DB sync: " + syncError.message);

    return new Response(JSON.stringify({
      success:true,
      vehiclesFound:vehicles.length,
      statusesFound:statuses.length,
      vehiclesSaved:rows.length,
      snapshotsSaved:snapshots.length,
      message:"Cartrack ligado com sucesso. Dados de veículos e estado atual sincronizados."
    }),{status:200,headers:{...corsHeaders,"Content-Type":"application/json"}});
  } catch (e) {
    return new Response(JSON.stringify({success:false,error:(e as Error).message}),{
      status:200,headers:{...corsHeaders,"Content-Type":"application/json"}
    });
  }
});
