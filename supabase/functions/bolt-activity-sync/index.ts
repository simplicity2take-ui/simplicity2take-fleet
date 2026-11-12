import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Pool } from "jsr:@db/postgres@^0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://fleet.simplicity2take.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};
const BOLT_TOKEN_URL = "https://oidc.bolt.eu/token";
const BOLT_API_BASE = "https://node.bolt.eu/fleet-integration-gateway-v2/fleetIntegration/v2";
const COMPANY_ID = 9360;
const dbUrl = Deno.env.get("SUPABASE_DB_URL") || "";
const dbPool = dbUrl ? new Pool(dbUrl, 1) : null;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}
function clean(v: unknown) { return v == null ? "" : String(v); }
function unixToIso(v: unknown) {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (Number.isFinite(n)) {
    const d = new Date((n < 100000000000 ? n * 1000 : n));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(input, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}
async function getBoltToken() {
  const clientId = Deno.env.get("BOLT_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("BOLT_CLIENT_SECRET") || "";
  if (!clientId || !clientSecret) throw new Error("Faltam as credenciais Bolt nos Secrets do Supabase.");
  const body = new URLSearchParams({
    client_id: clientId, client_secret: clientSecret,
    grant_type: "client_credentials", scope: "fleet-integration:api"
  });
  const response = await fetchWithTimeout(BOLT_TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body
  });
  const text = await response.text();
  let data: any = {};
  try { data = JSON.parse(text); } catch {}
  if (!response.ok || !data.access_token) throw new Error("A Bolt recusou a autenticação API.");
  return data.access_token as string;
}
async function boltPost(path: string, token: string, payload: Record<string, unknown>) {
  const response = await fetchWithTimeout(BOLT_API_BASE + path, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  let data: any = {};
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!response.ok || Number(data?.code ?? 0) !== 0) {
    const err: any = new Error(clean(data?.message || data?.error || text || "Pedido Bolt recusado."));
    err.status = response.status;
    err.path = path;
    throw err;
  }
  return data;
}
async function getRideLogs(token:string,startTs:number,endTs:number) {
 const rows:any[]=[],seen=new Set<string>();
 let expectedTotal:number|null=null;
 for(let page=0,offset=0;page<100;page++){
  const response=await boltPost("/getRideHistory",token,{company_id:COMPANY_ID,limit:1000,offset,start_datetime:new Date(startTs*1000).toISOString().replace(/\.\d{3}Z$/,"+00:00"),end_datetime:new Date(endTs*1000).toISOString().replace(/\.\d{3}Z$/,"+00:00")});
  const d=response?.data;
  if(!Array.isArray(d?.orders)||!Number.isSafeInteger(d?.total)||d.total<0)throw new Error("Resposta inesperada do histórico Bolt V2.");
  if(expectedTotal===null)expectedTotal=d.total;
  if(d.total!==expectedTotal)throw new Error("O total Bolt mudou entre páginas; repita a consulta completa.");
  if(d.orders.length>1000||offset+d.orders.length>expectedTotal)throw new Error("Contagem de viagens Bolt inconsistente.");
  for(const order of d.orders){
   const reference=typeof order?.order_reference==="string"?order.order_reference.trim():"";
   if(!reference||seen.has(reference))throw new Error("Referência Bolt ausente ou repetida entre páginas; não foi gravado.");
   seen.add(reference);
  }
  if(!d.orders.length){if(offset<expectedTotal)throw new Error("Histórico Bolt incompleto.");return {rows,pageCount:page+1,total:expectedTotal};}
  rows.push(...d.orders);offset+=d.orders.length;if(offset===expectedTotal)return {rows,pageCount:page+1,total:expectedTotal};
 }
 throw new Error("Limite de páginas Bolt excedido; não foi gravado.");
}
function normalizeRideLogs(rows:any[]) {
 return rows.map(r=>{
  if(typeof r.order_reference!=="string"||!r.order_reference)throw new Error("Viagem Bolt sem referência.");
  return {source_trip_id:r.order_reference,driver_uuid:r.driver?.uuid||null,vehicle_uuid:r.vehicle?.uuid||null,vehicle_plate:r.vehicle?.registration_number||null,order_status:r.status==="finished"?"completed":r.status||null,accepted_at:unixToIso(r.driver_accepted_datetime),pickup_at:unixToIso(r.pickup_datetime),finished_at:unixToIso(r.finished_datetime),ride_distance_km:null,observed_at:unixToIso(r.request_created_datetime)};
 });
}
async function save(trips: any[]) {
  if (!dbPool) throw new Error("SUPABASE_DB_URL indisponível.");
  const connection = await dbPool.connect();
  try {
    const result = await connection.queryObject<any>`
      select public.sync_bolt_activity('[]'::jsonb, ${JSON.stringify(trips)}::jsonb) as result
    `;
    return result.rows[0]?.result || {};
  } finally { connection.release(); }
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if(req.method!=="POST")return json({ok:false,error:"Método não permitido."},405);
  let trace:Record<string,unknown>|null=null;
  let dataWriteAttempted=false;
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey,{auth:{persistSession:false}});
    const jobKey=req.headers.get("x-cartrack-sync-key");
    let actorId:string|null=null;
    const scheduled=Boolean(jobKey);
    if(jobKey){
      const allowed=await admin.rpc("verify_cartrack_sync_key",{candidate:jobKey});
      if(allowed.error||allowed.data!==true)return json({ok:false,error:"Credencial de tarefa inválida."},403);
    }else{
      const authHeader = req.headers.get("Authorization") || "";
      const userToken = authHeader.replace(/^Bearer\s+/i, "");
      if (!userToken) return json({ ok: false, error: "Sessão não encontrada." }, 401);
      const { data: authData, error: authError } = await admin.auth.getUser(userToken);
      if (authError || !authData.user) return json({ ok: false, error: "Sessão inválida." }, 401);
      if ((authData.user.email || "").toLowerCase() !== "simplicity2take@gmail.com") {
        return json({ ok: false, error: "Apenas o administrador pode sincronizar a atividade Bolt." }, 403);
      }
      const {data:profile,error:profileError}=await admin.from("profiles").select("role,status").eq("id",authData.user.id).maybeSingle();
      if(profileError||profile?.role!=="admin"||profile?.status!=="Ativo")return json({ok:false,error:"Apenas um administrador ativo pode sincronizar a atividade Bolt."},403);
      actorId=authData.user.id;
    }
    let body: any = {};
    try { body = await req.json(); } catch {}
    const requestedDays = scheduled?7:Number(body?.days ?? 7);
    const days = Math.min(31, Math.max(1, Number.isFinite(requestedDays) ? Math.floor(requestedDays) : 7));
    const endTs = Math.floor(Date.now() / 1000);
    const startTs = endTs - days * 86400;
    trace={request_id:crypto.randomUUID(),actor_id:actorId,actor_type:scheduled?"server_job":"admin",platform:"bolt",api_version:2,company_id:COMPANY_ID,
      requested_start:new Date(startTs*1000).toISOString(),requested_end:new Date(endTs*1000).toISOString(),
      started_at:new Date().toISOString(),coverage_verified:false};
    console.info(JSON.stringify({event:"platform_report_import_started",...trace}));
    const token = await getBoltToken();
    const received=await getRideLogs(token,startTs,endTs);
    const rides=received.rows;
    trace={...trace,received_rows:rides.length,expected_total:received.total,page_count:received.pageCount,api_pagination_complete:true,snapshot_consistency_unverified:true};
    const trips=normalizeRideLogs(rides);
    dataWriteAttempted=true;
    const dbResult=await save(trips);
    console.info(JSON.stringify({event:"platform_report_import_succeeded",...trace,finished_at:new Date().toISOString(),data_write_attempted:true}));
    return json({ok:true,source:"bolt",apiVersion:2,days,range:{start:new Date(startTs*1000).toISOString(),end:new Date(endTs*1000).toISOString()},stateLogsReceived:0,eventsPrepared:0,tripsReceived:rides.length,tripsPrepared:trips.length,stateHistoryAvailable:false,db:dbResult,tripsEndpoint:"getRideHistory"});
  } catch (error) {
    console.error(JSON.stringify({event:"platform_report_import_failed",...(trace||{platform:"bolt",coverage_verified:false}),finished_at:new Date().toISOString(),data_write_attempted:dataWriteAttempted}));
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 502);
  }
});
