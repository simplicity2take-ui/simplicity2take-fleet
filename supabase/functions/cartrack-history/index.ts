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
    const body = await req.json().catch(() => ({}));
    const end = new Date(body.end || Date.now());
    const start = new Date(body.start || end.getTime() - 86400000);
    const page = Number(body.page || 1);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start || end.getTime()-start.getTime() > 31*86400000 || !Number.isInteger(page) || page<1 || page>100) {
      return new Response(JSON.stringify({success:false,error:"Período inválido. Escolhe até 31 dias."}),{status:400,headers:{...corsHeaders,"Content-Type":"application/json"}});
    }
    const params = new URLSearchParams({start_timestamp:start.toISOString().slice(0,19).replace("T"," "),end_timestamp:end.toISOString().slice(0,19).replace("T"," "),page:String(page),limit:"1000",incl_private:"false"});
    const response = await fetch(BASE + "/trips?" + params, {headers,signal:AbortSignal.timeout(45000)});
    if (!response.ok) return new Response(JSON.stringify({success:false,upstreamStatus:response.status,error:"A Cartrack não disponibilizou o histórico da ignição nesta consulta."}),{status:502,headers:{...corsHeaders,"Content-Type":"application/json"}});
    const payload = await response.json();
    if (!Array.isArray(payload?.data)) throw new Error("Unexpected response");
    const trips = payload.data.map((trip:any)=>({
      id:trip.trip_id,
      registration:String(trip.registration || "").trim().toUpperCase(),
      start:trip.start_timestamp ?? null,
      end:trip.end_timestamp ?? null,
      durationSeconds:trip.trip_duration_seconds == null ? null : Number(trip.trip_duration_seconds),
      duration:trip.trip_duration ?? null
    }));
    return new Response(JSON.stringify({success:true,trips,meta:payload.meta ?? null,start:start.toISOString(),end:end.toISOString(),privateTripsIncluded:false}),{status:200,headers:{...corsHeaders,"Content-Type":"application/json"}});
  } catch {
    return new Response(JSON.stringify({success:false,error:"Não foi possível consultar o histórico da Cartrack. Tenta novamente mais tarde."}),{status:502,headers:{...corsHeaders,"Content-Type":"application/json"}});
  }
});
