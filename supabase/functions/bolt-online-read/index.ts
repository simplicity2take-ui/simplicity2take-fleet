import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.105.4";

const headers = {"Access-Control-Allow-Origin":"https://fleet.simplicity2take.com","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const COMPANY_ID = 9360;
const BASE = "https://node.bolt.eu/fleet-integration-gateway-v2/fleetIntegration/v2";
const messages:Record<string,string> = {
  "503":"O acesso Bolt não está autorizado para esta consulta.",
  "498811":"A credencial da API Bolt não está ativa.",
  "498812":"A credencial Bolt não tem acesso a uma empresa.",
  "498813":"A credencial Bolt não tem acesso à consulta de motoristas online.",
  "498810":"A credencial Bolt não tem acesso à empresa da frota.",
  "702":"A Bolt recusou os parâmetros da consulta.",
  "1005":"A Bolt atingiu o limite de consultas. Tenta mais tarde."
};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
const iso=(value:unknown)=>typeof value==="string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS") return reply({});
  if(req.method!=="POST") return reply({ok:false,error:"Método não permitido."},405);
  const token=req.headers.get("Authorization")?.replace(/^Bearer\s+/i,"");
  if(!token) return reply({ok:false,error:"Sessão necessária."},401);
  const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const user=await admin.auth.getUser(token);
  if(user.error||!user.data.user) return reply({ok:false,error:"Sessão inválida."},401);
  const profile=await admin.from("profiles").select("role,status").eq("id",user.data.user.id).maybeSingle();
  if(profile.error||profile.data?.role!=="admin"||profile.data?.status!=="Ativo") return reply({ok:false,error:"Consulta exclusiva do administrador."},403);
  try {
    const id=Deno.env.get("BOLT_CLIENT_ID"),secret=Deno.env.get("BOLT_CLIENT_SECRET");
    const body=await req.json().catch(()=>({}));
    if(body.mode==="configuration") {
      const suffix=String(body.expectedClientIdSuffix||"");
      if(!/^[A-Za-z0-9_-]{6}$/.test(suffix)) return reply({ok:false,error:"Indica os 6 caracteres finais do ID do cliente."},400);
      return reply({ok:true,configuration:{idConfigured:Boolean(id),secretConfigured:Boolean(secret),clientIdSuffixMatches:Boolean(id?.endsWith(suffix))}});
    }
    const rides=body.mode==="rides";
    const start=rides?iso(body.start):null,end=rides?iso(body.end):null;
    const offset=body.offset??0;
    if(rides && (!start||!end||Date.parse(end)<=Date.parse(start)||Date.parse(end)-Date.parse(start)>31*86400000||!Number.isSafeInteger(offset)||offset<0||offset>100000)) return reply({ok:false,error:"Período ou página inválidos (máximo 31 dias)."},400);
    if(!id||!secret) return reply({ok:false,stage:"configuration",error:"As credenciais Bolt não estão configuradas."});
    const auth=await fetch("https://oidc.bolt.eu/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:id,client_secret:secret,grant_type:"client_credentials",scope:"fleet-integration:api"}),signal:AbortSignal.timeout(15000)});
    const credentials=await auth.json().catch(()=>({}));
    if(!auth.ok||typeof credentials.access_token!=="string"||!credentials.access_token) {
      const allowed = ["invalid_client","invalid_scope","unauthorized_client","unsupported_grant_type","invalid_request","invalid_grant"];
      return reply({ok:false,stage:"authentication",code:allowed.includes(credentials.error)?credentials.error:"BOLT_TOKEN_FAILED_HTTP_"+auth.status,httpStatus:auth.status,error:"Não foi possível obter autenticação na API Bolt."});
    }
    const response=await fetch(BASE+(rides?"/getRideHistory":"/getOnlineDrivers"),{method:"POST",headers:{Authorization:"Bearer "+credentials.access_token,"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify(rides?{company_id:COMPANY_ID,start_datetime:start!.replace(/\.\d{3}Z$/,"+00:00"),end_datetime:new Date(Math.min(Date.parse(end!),Date.now())).toISOString().replace(/\.\d{3}Z$/,"+00:00"),limit:1000,offset}:{company_id:COMPANY_ID}),signal:AbortSignal.timeout(20000)});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok||payload.code!==0) return reply({ok:false,stage:rides?"rides":"online",invalidFields:rides&&payload.validation_errors&&typeof payload.validation_errors==="object"?Object.keys(payload.validation_errors).filter(k=>["company_id","start_datetime","end_datetime","limit","offset","driver_uuids","order_states"].includes(k)):[],code:Number.isFinite(Number(payload.code))?Number(payload.code):null,error:(messages[String(payload.code)]||"A Bolt não disponibilizou os dados nesta consulta.")+(rides&&payload.validation_errors&&typeof payload.validation_errors==="object"?" Campos: "+Object.keys(payload.validation_errors).filter(k=>["company_id","start_datetime","end_datetime","limit","offset","driver_uuids","order_states"].includes(k)).join(", "):"")});
    if(rides) {
      const orders=payload.data?.orders,total=payload.data?.total;
      if(!Array.isArray(orders)||orders.length>1000||!Number.isSafeInteger(total)||total<0) return reply({ok:false,stage:"response",error:"Histórico Bolt inesperado."});
      return reply({ok:true,companyId:COMPANY_ID,range:{start,end},offset,nextOffset:offset+orders.length<total&&orders.length?offset+orders.length:null,total,observedAt:new Date().toISOString(),rides:orders.map((o:any)=>({reference:o.order_reference??null,driverUuid:o.driver?.uuid??null,name:[o.driver?.first_name,o.driver?.last_name].filter(Boolean).join(" ")||o.driver?.display_name||"Motorista não indicado",plate:o.vehicle?.registration_number??null,status:o.status??null,requestedAt:iso(o.request_created_datetime),acceptedAt:iso(o.driver_accepted_datetime),pickupAt:iso(o.pickup_datetime),finishedAt:iso(o.finished_datetime)}))});
    }
    if(!Array.isArray(payload.data?.drivers)||payload.data.drivers.length>5000) return reply({ok:false,stage:"response",error:"A Bolt devolveu uma resposta inesperada."});
    const observedAt=new Date().toISOString();
    const drivers=payload.data.drivers.map((driver:any)=>({driverUuid:driver.uuid??null,name:[driver.first_name,driver.last_name].filter(Boolean).join(" ")||driver.display_name||"Motorista Bolt",vehicleUuid:driver.vehicle?.uuid??null,plate:driver.vehicle?.registration_number??null,state:driver.current_state?.code??null,stateChangedAt:iso(driver.current_state?.changed_at),observedAt}));
    return reply({ok:true,companyId:COMPANY_ID,observedAt,drivers});
  } catch { return reply({ok:false,stage:"connection",error:"Não foi possível consultar a Bolt. Tenta novamente mais tarde."}); }
});
