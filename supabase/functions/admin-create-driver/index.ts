import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://fleet.simplicity2take.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ ok: false, error: "Método não permitido." }, 405);

  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) return json({ ok: false, error: "Sessão não autorizada." }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!serviceRoleKey) return json({ ok: false, error: "Configuração do servidor incompleta." }, 503);

    const callerClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) return json({ ok: false, error: "Sessão inválida." }, 401);

    const adminClient = createClient(url, serviceRoleKey);
    const { data: callerProfile } = await adminClient.from("profiles").select("role,status").eq("id", caller.id).single();
    if (callerProfile?.role !== "admin" || callerProfile?.status !== "Ativo") {
      return json({ ok: false, error: "Apenas o administrador pode criar motoristas." }, 403);
    }

    const body = await request.json();
    const fullName = String(body.fullName || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const phone = String(body.phone || "").trim();
    const password = String(body.password || "");
    const status = String(body.status || "Ativo").trim();

    if (!fullName || !email || !password) return json({ ok: false, error: "Nome, email e palavra-passe são obrigatórios." }, 400);
    if (password.length < 8) return json({ ok: false, error: "A palavra-passe deve ter pelo menos 8 caracteres." }, 400);

    const { data: existing } = await adminClient.from("drivers").select("id").eq("email", email).maybeSingle();
    if (existing) return json({ ok: false, error: "Já existe um motorista com este email." }, 409);

    const { data: created, error: authError } = await adminClient.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { full_name: fullName, phone }
    });
    if (authError || !created.user) return json({ ok: false, error: authError?.message || "Não foi possível criar o acesso." }, 400);

    const userId = created.user.id;
    const { error: profileError } = await adminClient.from("profiles").insert({
      id: userId, full_name: fullName, email, phone: phone || null, role: "driver", status
    });
    if (profileError) {
      await adminClient.auth.admin.deleteUser(userId);
      return json({ ok: false, error: profileError.message }, 400);
    }

    const { data: driver, error: driverError } = await adminClient.from("drivers").insert({
      profile_id: userId, full_name: fullName, email, phone: phone || null, status
    }).select("id").single();

    if (driverError) {
      await adminClient.from("profiles").delete().eq("id", userId);
      await adminClient.auth.admin.deleteUser(userId);
      return json({ ok: false, error: driverError.message }, 400);
    }

    return json({ ok: true, userId, driverId: driver.id });
  } catch (error) {
    console.error(error);
    return json({ ok: false, error: error?.message || "Erro interno." }, 500);
  }
});
