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

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

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

    const body = await request.json();
    const documentId = String(body.document_id || "").trim();

    if (!documentId) {
      return json({ error: "document_id é obrigatório." }, 400);
    }

    const { data: document, error: documentError } =
      await supabase
        .from("documents")
        .select("id,name,original_file_name,mime_type,drive_file_id")
        .eq("id", documentId)
        .maybeSingle();

    if (documentError) throw documentError;

    if (!document?.drive_file_id) {
      return json({
        error: "Documento não autorizado ou sem ficheiro."
      }, 404);
    }

    const appsScriptUrl = Deno.env.get("GOOGLE_APPS_SCRIPT_URL");
    const uploadSecret = Deno.env.get("GOOGLE_UPLOAD_SECRET");

    if (!appsScriptUrl || !uploadSecret) {
      return json({
        error: "Integração Google Drive não configurada no servidor."
      }, 503);
    }

    const driveResponse = await fetch(appsScriptUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        action: "download",
        secret: uploadSecret,
        fileId: document.drive_file_id,
      }),
    });

    if (!driveResponse.ok) {
      return json({
        error: "O Google Apps Script devolveu um erro."
      }, 502);
    }

    const result = await driveResponse.json();

    if (!result?.ok || !result?.base64) {
      return json({
        error: result?.error ||
          "Não foi possível obter o documento do Drive."
      }, 502);
    }

    const bytes = base64ToBytes(result.base64);
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
    ).replace(/["\\]/g, "");

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

    return json({
      error:
        error instanceof Error
          ? error.message
          : "Erro interno."
    }, 500);
  }
});