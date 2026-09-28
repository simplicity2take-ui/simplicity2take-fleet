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

function normalizePhone(value: string) {
  return String(value || "").replace(/[^0-9+]/g, "").replace(/^00/, "+");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ ok: false, error: "Método não permitido." }, 405);

  try {
    const body = await request.json();
    const phone = normalizePhone(body.phone);
    const password = String(body.password || "");

    if (!phone || !password) return json({ ok: false, error: "Telemóvel e palavra-passe são obrigatórios." }, 400);

    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceRoleKey) {
      return json({ ok: false, error: "Configuração do servidor incompleta." }, 503);
    }

    const admin = createClient(url, serviceRoleKey);
    const { data: drivers, error: driverError } = await admin
      .from("drivers")
      .select("email,phone,status")
      .eq("status", "Ativo");

    if (driverError) return json({ ok: false, error: "Não foi possível validar o acesso." }, 500);

    const driver = (drivers || []).find((item: any) => normalizePhone(item.phone) === phone);
    if (!driver?.email) return json({ ok: false, error: "Credenciais inválidas." }, 401);

    const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: anonKey },
      body: JSON.stringify({ email: driver.email, password })
    });

    const authBody = await response.json();
    if (!response.ok || !authBody?.access_token || !authBody?.refresh_token) {
      return json({ ok: false, error: "Credenciais inválidas." }, 401);
    }

    return json({
      ok: true,
      access_token: authBody.access_token,
      refresh_token: authBody.refresh_token,
      expires_in: authBody.expires_in,
      expires_at: authBody.expires_at,
      token_type: authBody.token_type,
      user: authBody.user
    });
  } catch (error) {
    console.error(error);
    return json({ ok: false, error: "Não foi possível iniciar sessão." }, 500);
  }
});
