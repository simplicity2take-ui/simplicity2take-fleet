import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "https://fleet.simplicity2take.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}

function base64ToBytes(base64: string) {
  const binary = atob(base64);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}


function base64Url(bytes: Uint8Array | string): string {
  const input = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let binary = "";
  for (const byte of input) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function driveAccessToken(serviceAccount: { client_email: string; private_key: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const pem = serviceAccount.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const privateBytes = base64ToBytes(pem);
  const key = await crypto.subtle.importKey(
    "pkcs8", privateBytes, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const unsigned = header + "." + claim;
  const signature = new Uint8Array(await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned),
  ));
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: unsigned + "." + base64Url(signature),
    }),
  });
  if (!response.ok) throw new Error("Não foi possível autenticar no Google Drive.");
  const result = await response.json();
  if (!result.access_token) throw new Error("Google Drive não devolveu um token.");
  return result.access_token;
}

function lisbonToday(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) => parts.find(item => item.type === type)?.value || "";
  return [value("year"), value("month"), value("day")].join("-");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);

  try {
    const auth = request.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) {
      return json({ error: "Não autenticado." }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: auth } },
    });

    const { data: { user }, error: userError } =
      await supabase.auth.getUser();

    if (userError || !user) {
      return json({ error: "Sessão inválida." }, 401);
    }

    let body: Record<string, unknown>;
    try {
      const parsed = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return json({ error: "Pedido JSON inválido." }, 400);
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return json({ error: "Pedido JSON inválido." }, 400);
    }
    const documentId = typeof body.document_id === "string" ? body.document_id.trim() : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(documentId)) {
      return json({ error: "document_id inválido." }, 400);
    }

    const { data: document, error: documentError } =
      await supabase
        .from("documents")
        .select("id,name,original_file_name,mime_type,drive_file_id,vehicle_id,expiry_date")
        .eq("id", documentId)
        .maybeSingle();

    if (documentError) throw documentError;
    if (!document?.drive_file_id) {
      return json({ error: "Documento não autorizado ou sem ficheiro." }, 404);
    }

    // Enforce document validity server-side; an expired file must never be
    // delivered to a driver, even if they bypass the UI.
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) throw profileError;
    const isAdmin = profile?.role === "admin";

    if (!isAdmin) {
      if (profile?.role !== "driver" || !document) {
        return json({ error: "Documento não autorizado." }, 403);
      }
      if (document.vehicle_id) {
        const { data: driver, error: driverError } = await supabase
          .from("drivers")
          .select("id")
          .eq("profile_id", user.id)
          .maybeSingle();
        if (driverError) throw driverError;
        if (!driver) return json({ error: "Motorista não autorizado." }, 403);
        const { data: assignments, error: assignmentError } = await supabase
          .from("vehicle_assignments")
          .select("active_from,active_until")
          .eq("vehicle_id", document.vehicle_id)
          .eq("driver_id", driver.id);
        if (assignmentError) throw assignmentError;
        const todayLocal = lisbonToday();
        const assigned = (assignments || []).some(item =>
          item.active_from <= todayLocal && (!item.active_until || item.active_until >= todayLocal)
        );
        if (!assigned) return json({ error: "Viatura não atribuída ao motorista." }, 403);
      }
      const today = lisbonToday();
      if (document.expiry_date && document.expiry_date < today) {
        return json({ error: "Documento expirado. Contacte o administrador." }, 403);
      }
    }

    // Use the same service account as drive-upload, so new uploads are
    // immediately readable without a second Google Apps Script integration.
    const serviceAccountJson = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
    if (!serviceAccountJson) {
      return json({ error: "Conta de serviço Google Drive não configurada." }, 503);
    }
    const serviceAccount = JSON.parse(serviceAccountJson);
    const token = await driveAccessToken(serviceAccount);
    const fileId = encodeURIComponent(document.drive_file_id);
    const driveResponse = await fetch(
      "https://www.googleapis.com/drive/v3/files/" + fileId + "?alt=media",
      { headers: { Authorization: "Bearer " + token } },
    );
    if (!driveResponse.ok) {
      console.error("Google Drive file retrieval failed", driveResponse.status);
      return json({ error: "Não foi possível obter o ficheiro do Google Drive." }, 502);
    }
    const bytes = new Uint8Array(await driveResponse.arrayBuffer());
    const result = { mimeType: driveResponse.headers.get("content-type") || "", fileName: "" };
    const headers = new Headers(cors);

    headers.set(
      "content-type",
      document.mime_type ||
        result.mimeType ||
        "application/octet-stream"
    );

    const safeName = String(
      document.original_file_name ||
      document.name ||
      result.fileName ||
      "documento"
    ).replace(/[\\x00-\\x1f\\x7f"\\\\]/g, "").slice(0, 180);

    headers.set(
      "content-disposition",
      'inline; filename="' + safeName + '"'
    );

    headers.set("cache-control", "private, no-store");

    return new Response(bytes, {
      status: 200,
      headers,
    });

  } catch (error) {
    console.error(error);

    return json({ error: "Erro interno ao consultar o documento." }, 500);
  }
});