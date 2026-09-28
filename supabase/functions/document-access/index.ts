import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function pemToArrayBuffer(pem: string) {
  const clean = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const bin = atob(clean);
  return Uint8Array.from(bin, c => c.charCodeAt(0)).buffer;
}

function base64url(input: string | ArrayBuffer) {
  const bytes = typeof input === "string"
    ? new TextEncoder().encode(input)
    : new Uint8Array(input);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
}

async function googleAccessToken() {
  const raw = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON não configurado.");

  const account = JSON.parse(raw);
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(JSON.stringify({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = header + "." + claim;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );

  const assertion = unsigned + "." + base64url(signature);
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) throw new Error("Não foi possível obter acesso ao Google Drive.");
  const data = await response.json();
  return data.access_token as string;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const auth = request.headers.get("Authorization");
    if (!auth) return new Response(JSON.stringify({ error: "Não autenticado." }), {
      status: 401, headers: { ...cors, "content-type": "application/json" },
    });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: auth } },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return new Response(JSON.stringify({ error: "Sessão inválida." }), {
      status: 401, headers: { ...cors, "content-type": "application/json" },
    });

    const body = await request.json();
    const documentId = String(body.document_id || "").trim();
    if (!documentId) return new Response(JSON.stringify({ error: "document_id é obrigatório." }), {
      status: 400, headers: { ...cors, "content-type": "application/json" },
    });

    // RLS is the second line of defence: this query only returns documents
    // the current authenticated user is allowed to see.
    const { data: document, error: documentError } = await supabase
      .from("documents")
      .select("id,name,original_file_name,mime_type,drive_file_id")
      .eq("id", documentId)
      .maybeSingle();

    if (documentError) throw documentError;
    if (!document || !document.drive_file_id) return new Response(JSON.stringify({ error: "Documento não autorizado ou sem ficheiro." }), {
      status: 404, headers: { ...cors, "content-type": "application/json" },
    });

    const token = await googleAccessToken();
    const driveResponse = await fetch(
      "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(document.drive_file_id) + "?alt=media",
      { headers: { Authorization: "Bearer " + token } },
    );

    if (!driveResponse.ok) {
      return new Response(JSON.stringify({ error: "Não foi possível obter o documento do Drive." }), {
        status: 502, headers: { ...cors, "content-type": "application/json" },
      });
    }

    const headers = new Headers(cors);
    headers.set("content-type", document.mime_type || driveResponse.headers.get("content-type") || "application/octet-stream");
    headers.set("content-disposition", 'inline; filename="' + String(document.original_file_name || document.name || "documento").replace(/["\\\\]/g, "") + '"');
    headers.set("cache-control", "private, no-store");

    return new Response(driveResponse.body, { status: 200, headers });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Erro interno." }), {
      status: 500, headers: { ...cors, "content-type": "application/json" },
    });
  }
});
