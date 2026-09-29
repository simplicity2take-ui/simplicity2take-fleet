import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders={"Access-Control-Allow-Origin":"https://fleet.simplicity2take.com","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,"Content-Type":"application/json"}});
Deno.serve(async req=>{
 if(req.method==="OPTIONS") return new Response("ok",{headers:corsHeaders});
 if(req.method!=="POST") return json({ok:false,error:"Método não permitido."},405);
 try{
  const auth=req.headers.get("Authorization");
  if(!auth?.startsWith("Bearer ")) return json({ok:false,error:"Sessão não autorizada."},401);
  const url=Deno.env.get("SUPABASE_URL")!, anon=Deno.env.get("SUPABASE_ANON_KEY")!, service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!service) return json({ok:false,error:"Configuração do servidor incompleta."},503);
  const callerClient=createClient(url,anon,{global:{headers:{Authorization:auth}}});
  const accessToken=auth.replace(/^Bearer\s+/i,"").trim();
  const {data:{user:caller},error:callerError}=await callerClient.auth.getUser(accessToken);
  if(!caller) return json({ok:false,error:"Sessão inválida."},401);
  const admin=createClient(url,service);
  const {data:profile}=await admin.from("profiles").select("role,status").eq("id",caller.id).single();
  if(profile?.role!=="admin"||profile?.status!=="Ativo") return json({ok:false,error:"Apenas o administrador pode alterar palavras-passe."},403);
  const body=await req.json(); const driverId=String(body.driverId||""); const password=String(body.password||"");
  if(!driverId||password.length<8) return json({ok:false,error:"Motorista ou palavra-passe inválidos."},400);
  const {data:driver}=await admin.from("drivers").select("profile_id").eq("id",driverId).single();
  if(!driver?.profile_id) return json({ok:false,error:"Motorista não encontrado."},404);
  const {error}=await admin.auth.admin.updateUserById(driver.profile_id,{password});
  if(error) return json({ok:false,error:error.message},400);
  return json({ok:true});
 }catch(error){console.error(error);return json({ok:false,error:error?.message||"Erro interno."},500);}
});