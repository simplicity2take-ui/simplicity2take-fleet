import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-s2t-sync-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const TYPES = ["DUA", "Seguro", "Carta Verde", "IPO", "Licença TVDE", "Carta de Condução", "Cartão de Cidadão", "Contrato", "Outros"];

function normalize(value: string) {
  return String(value || "").toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ").trim();
}
function plate(value: string) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
function b64(value: ArrayBuffer | string) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function classify(name: string) {
  const text = normalize(name);
  const type =
    TYPES.find(item => text.includes(normalize(item))) ||
    (text.includes("ipo") ? "IPO" :
     text.includes("seguro") || text.includes("apolice") ? "Seguro" :
     text.includes("carta verde") ? "Carta Verde" :
     text.includes("licenca") || text.includes("tvde") ? "Licença TVDE" :
     text.includes("cartao cidadao") ? "Cartão de Cidadão" :
     text.includes("carta conducao") ? "Carta de Condução" :
     text.includes("dua") || text.includes("livrete") ? "DUA" : "Outros");

  const ymd = name.match(/(?:^|[^0-9])(20\d{2})[-_](0[1-9]|1[0-2])[-_](0[1-9]|[12]\d|3[01])(?:[^0-9]|$)/);
  const dmy = name.match(/(?:^|[^0-9])(0[1-9]|[12]\d|3[01])[-_](0[1-9]|1[0-2])[-_](20\d{2})(?:[^0-9]|$)/);
  const expiryDate = ymd ? `${ymd[1]}-${ymd[2]}-${ymd[3]}` :
    dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : null;
  return { type, expiryDate };
}

async function googleToken(serviceAccount: any) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));
  const unsigned = header + "." + claim;
  const pem = serviceAccount.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const raw = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", raw, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const assertion = unsigned + "." + b64(signature);

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  if (!response.ok) throw new Error("Não foi possível autenticar no Google Drive.");
  return (await response.json()).access_token;
}

async function driveGet(accessToken: string, url: string) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error("Não foi possível ler o Google Drive.");
  return response.json();
}

async function listDriveFiles(accessToken: string, folderId: string) {
  const files: any[] = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
      fields: "nextPageToken,files(id,name,mimeType,webViewLink,modifiedTime)",
      pageSize: "100"
    });
    if (pageToken) params.set("pageToken", pageToken);
    const data = await driveGet(accessToken, "https://www.googleapis.com/drive/v3/files?" + params.toString());
    files.push(...(data.files || []));
    pageToken = data.nextPageToken || "";
  } while (pageToken);
  return files;
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (request.method !== "POST") throw new Error("Método não permitido.");

    const expected = Deno.env.get("DRIVE_SYNC_SECRET");
    if (!expected) throw new Error("DRIVE_SYNC_SECRET ainda não está configurado.");
    if (request.headers.get("x-s2t-sync-secret") !== expected) {
      return new Response(JSON.stringify({ ok: false, error: "Não autorizado." }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const serviceAccountJson = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
    const inboxId = Deno.env.get("GOOGLE_DRIVE_INBOX_FOLDER_ID");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceAccountJson || !inboxId || !serviceRoleKey) {
      throw new Error("Configuração incompleta: Google Drive, pasta de entrada ou chave interna.");
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceRoleKey);
    const accessToken = await googleToken(JSON.parse(serviceAccountJson));
    const files = await listDriveFiles(accessToken, inboxId);

    const [{ data: vehicles, error: vehicleError }, { data: drivers, error: driverError }] = await Promise.all([
      supabase.from("vehicles").select("id,plate"),
      supabase.from("drivers").select("id,full_name,name")
    ]);
    if (vehicleError) throw vehicleError;
    if (driverError) throw driverError;

    let imported = 0, duplicates = 0, unmatched = 0, failed = 0;
    const results: any[] = [];

    for (const file of files) {
      try {
        const { data: existing } = await supabase.from("documents").select("id").eq("drive_file_id", file.id).maybeSingle();
        if (existing?.id) {
          duplicates++;
          continue;
        }

        const classification = classify(file.name);
        const normalizedName = plate(file.name);
        const vehicle = (vehicles || []).find((item: any) => normalizedName.includes(plate(item.plate)));
        const normalizedText = normalize(file.name);
        const driver = (drivers || [])
          .filter((item: any) => item.full_name || item.name)
          .sort((a: any, b: any) => String(b.full_name || b.name).length - String(a.full_name || a.name).length)
          .find((item: any) => normalizedText.includes(normalize(item.full_name || item.name)));

        const privateKeywords = ["contrato", "contratacao", "prestacao", "cartao cidadao", "carta conducao"];
        const isPrivate = Boolean(driver && (classification.type === "Contrato" || privateKeywords.some(k => normalizedText.includes(k))));
        const vehicleId = isPrivate ? null : vehicle?.id || null;
        const driverId = isPrivate ? driver?.id || null : null;

        if (!vehicle && !driver) unmatched++;

        const { data: saved, error } = await supabase.from("documents").insert({
          name: file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim(),
          document_type: classification.type,
          expiry_date: classification.expiryDate,
          file_name: file.name,
          mime_type: file.mimeType,
          drive_file_id: file.id,
          drive_url: file.webViewLink || null,
          vehicle_id: vehicleId,
          driver_id: driverId,
          uploaded_by: null
        }).select("id").single();

        if (error) throw error;
        imported++;
        results.push({ file: file.name, documentId: saved.id, type: classification.type, vehicleId, driverId, matched: Boolean(vehicle || driver) });
      } catch (error) {
        failed++;
        results.push({ file: file.name, error: error?.message || "Erro" });
      }
    }

    return new Response(JSON.stringify({ ok: true, scanned: files.length, imported, duplicates, unmatched, failed, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ ok: false, error: error?.message || "Erro na sincronização." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
