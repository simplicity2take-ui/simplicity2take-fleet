import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://fleet.simplicity2take.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Método não permitido." }, 405);

  try {
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) return json({ ok: false, error: "Sessão não autorizada." }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!service) return json({ ok: false, error: "Configuração do servidor incompleta." }, 503);

    const accessToken = auth.replace(/^Bearer\s+/i, "").trim();
    const admin = createClient(url, service);

    const { data: { user: caller }, error: callerError } =
      await admin.auth.getUser(accessToken);

    if (callerError || !caller) {
      return json({ ok: false, error: "Sessão inválida." }, 401);
    }

    const { data: profile, error: profileError } =
      await admin.from("profiles").select("role,status").eq("id", caller.id).single();

    if (profileError || profile?.role !== "admin" || profile?.status !== "Ativo") {
      return json({ ok: false, error: "Apenas o administrador pode alterar palavras-passe." }, 403);
    }

    const body = await req.json();
    const driverId = String(body.driverId || "");
    const password = String(body.password || "");
    const email = String(body.email || "").trim().toLowerCase();
    const phone = String(body.phone || "").trim();

    if (!driverId || password.length < 8) {
      return json({ ok: false, error: "Motorista ou palavra-passe inválidos." }, 400);
    }

    const { data: driver, error: driverError } =
      await admin.from("drivers")
        .select("id,profile_id,email,phone,full_name")
        .eq("id", driverId)
        .single();

    if (driverError || !driver) {
      return json({ ok: false, error: "Motorista não encontrado." }, 404);
    }

    if (!driver.profile_id) {
      const loginEmail = email || String(driver.email || "").trim().toLowerCase();
      if (!loginEmail) {
        return json({ ok: false, error: "O motorista precisa de um email para criar o acesso." }, 400);
      }

      const { data: created, error: createError } =
        await admin.auth.admin.createUser({
          email: loginEmail,
          password,
          email_confirm: true,
          user_metadata: {
            full_name: driver.full_name || "",
            phone: phone || driver.phone || ""
          }
        });

      if (createError || !created.user) {
        return json({ ok: false, error: createError?.message || "Não foi possível criar o acesso do motorista." }, 400);
      }

      const profileId = created.user.id;

      const { error: profileUpsertError } =
        await admin.from("profiles").upsert({
          id: profileId,
          full_name: driver.full_name || loginEmail,
          email: loginEmail,
          phone: phone || driver.phone || null,
          role: "driver",
          status: "Ativo"
        }, { onConflict: "id" });

      if (profileUpsertError) {
        await admin.auth.admin.deleteUser(profileId);
        return json({ ok: false, error: profileUpsertError.message }, 400);
      }

      const { error: driverUpdateError } =
        await admin.from("drivers").update({
          profile_id: profileId,
          email: loginEmail,
          phone: phone || driver.phone || null
        }).eq("id", driverId);

      if (driverUpdateError) {
        await admin.auth.admin.deleteUser(profileId);
        return json({ ok: false, error: driverUpdateError.message }, 400);
      }

      return json({ ok: true, created: true });
    }

    const { error: passwordError } =
      await admin.auth.admin.updateUserById(driver.profile_id, { password });

    if (passwordError) {
      return json({ ok: false, error: passwordError.message }, 400);
    }

    return json({ ok: true, created: false });
  } catch (error) {
    console.error(error);
    return json({ ok: false, error: error instanceof Error ? error.message : "Erro interno." }, 500);
  }
});