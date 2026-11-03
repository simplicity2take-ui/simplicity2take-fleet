import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { canCreateDriverForCompany, isActiveGlobalAdmin } from "../admin-auth-utils.ts";

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
    const { data: callerProfile, error: callerProfileError } = await adminClient
      .from("profiles").select("role,status").eq("id", caller.id).maybeSingle();
    if (callerProfileError) return json({ ok: false, error: "Não foi possível validar as permissões." }, 500);

    const body = await request.json();
    const requestedCompanyId = String(body.companyId || "").trim();
    let callerMembership = null;
    if (!isActiveGlobalAdmin(callerProfile) && requestedCompanyId) {
      const { data: membership, error: membershipError } = await adminClient
        .from("company_memberships")
        .select("company_id,role,status")
        .eq("company_id", requestedCompanyId)
        .eq("profile_id", caller.id)
        .eq("role", "company_admin")
        .eq("status", "Ativo")
        .maybeSingle();
      if (membershipError) return json({ ok: false, error: "Não foi possível validar a empresa selecionada." }, 500);
      callerMembership = membership;
    }
    if (!canCreateDriverForCompany(callerProfile, callerMembership, requestedCompanyId)) {
      return json({ ok: false, error: "Apenas um administrador global ativo ou o administrador ativo da empresa pode criar motoristas." }, 403);
    }
    const fullName = String(body.fullName || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const phone = String(body.phone || "").trim();
    const password = String(body.password || "");
    const status = String(body.status || "Ativo").trim();

    if (!fullName || !email || !password) return json({ ok: false, error: "Nome, email e palavra-passe são obrigatórios." }, 400);
    if (status !== "Ativo") return json({ ok: false, error: "Um motorista novo tem de ser criado ativo." }, 400);
    if (password.length < 8) return json({ ok: false, error: "A palavra-passe deve ter pelo menos 8 caracteres." }, 400);

    const companyQuery = adminClient
      .from("companies")
      .select("id")
      .eq("status", "Ativa");
    const { data: company, error: companyError } = requestedCompanyId
      ? await companyQuery.eq("id", requestedCompanyId).single()
      : await companyQuery.eq("slug", "simplicity2take").single();
    if (companyError || !company) {
      return json({
        ok: false,
        error: requestedCompanyId
          ? "A empresa selecionada não existe ou não está ativa."
          : "A empresa Simplicity2Take não está configurada para criar motoristas."
      }, requestedCompanyId ? 400 : 503);
    }

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
      company_id: company.id, profile_id: userId, full_name: fullName, email, phone: phone || null, status
    }).select("id").single();

    if (driverError) {
      await adminClient.from("profiles").delete().eq("id", userId);
      await adminClient.auth.admin.deleteUser(userId);
      return json({ ok: false, error: driverError.message }, 400);
    }

    return json({ ok: true, userId, driverId: driver.id });
  } catch (error) {
    console.error(error);
    return json({ ok: false, error: "Erro interno ao criar o motorista." }, 500);
  }
});
