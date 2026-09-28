import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const TYPES = ["DUA", "Seguro", "Carta Verde", "IPO", "Licença TVDE", "Carta de Condução", "Cartão de Cidadão", "Contrato", "Outros"];

function normalize(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
}
function plate(value: string) { return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }

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

  const dates = [
    name.match(/(?:^|[^0-9])(20\d{2})[-_](0[1-9]|1[0-2])[-_](0[1-9]|[12]\d|3[01])(?:[^0-9]|$)/),
    name.match(/(?:^|[^0-9])(0[1-9]|[12]\d|3[01])[-_](0[1-9]|1[0-2])[-_](20\d{2})(?:[^0-9]|$)/)
  ];
  const expiryDate = dates[0] ? `${dates[0][1]}-${dates[0][2]}-${dates[0][3]}` :
    dates[1] ? `${dates[1][3]}-${dates[1][2]}-${dates[1][1]}` : null;

  return { type, expiryDate };
}

async function token(serviceAccount: any) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const enc = new TextEncoder();
  const header = b64(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64(JSON.stringify({ iss: serviceAccount.client_email, scope: "https://www.googleapis.com/auth/drive.readonly", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const unsigned = `${header}.${claim}`;
  const pem = serviceAccount.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const raw = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", raw, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(unsigned));
  const assertion = unsigned + "." + b64(String.fromCharCode(...new Uint8Array(sig)));
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion })
  });
  if (!response.ok) throw new Error("Não foi possível autenticar no Google Drive.");
  return (await response.json()).access_token;
}

async function driveGet(accessToken: string, url: string) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error("Não foi possível ler o ficheiro do Google Drive.");
  return response.json();
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = request.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) return new Response(JSON.stringify({ ok: false, error: "Sessão não autorizada." }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Sessão inválida.");

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (profile?.role !== "admin") return new Response(JSON.stringify({ ok: false, error: "Apenas o administrador pode importar documentos." }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = await request.json();
    const fileId = String(body.fileId || "").trim();
    if (!fileId) throw new Error("fileId em falta.");

    const serviceAccountJson = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
    if (!serviceAccountJson) throw new Error("Google Drive ainda não está configurado no servidor.");

    const accessToken = await token(JSON.parse(serviceAccountJson));
    const metadata = await driveGet(accessToken, "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(fileId) + "?fields=id,name,mimeType,webViewLink,trashed");

    if (metadata.trashed) throw new Error("O ficheiro está no lixo do Google Drive.");

    const classification = classify(metadata.name);
    const { data: vehicles, error: vehicleError } = await supabase.from("vehicles").select("id,plate");
    if (vehicleError) throw vehicleError;
    const { data: drivers, error: driverError } = await supabase.from("drivers").select("id,full_name,name");
    if (driverError) throw driverError;

    const normalizedName = plate(metadata.name);
    const vehicle = (vehicles || []).find((item: any) => normalizedName.includes(plate(item.plate)));
    const normalizedText = normalize(metadata.name);
    const driver = (drivers || [])
      .filter((item: any) => item.full_name || item.name)
      .sort((a: any, b: any) => String(b.full_name || b.name).length - String(a.full_name || a.name).length)
      .find((item: any) => normalizedText.includes(normalize(item.full_name || item.name)));

    const privateKeywords = ["contrato", "contratacao", "prestacao", "cartao cidadao", "carta conducao"];
    const isPrivate = Boolean(driver && (classification.type === "Contrato" || privateKeywords.some(k => normalizedText.includes(k))));
    const vehicleId = isPrivate ? null : vehicle?.id || null;
    const driverId = isPrivate ? driver?.id || null : null;

    const { data: existing } = await supabase.from("documents").select("id").eq("drive_file_id", fileId).maybeSingle();
    if (existing?.id) return new Response(JSON.stringify({ ok: true, duplicate: true, documentId: existing.id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: saved, error } = await supabase.from("documents").insert({
      name: metadata.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim(),
      document_type: classification.type,
      expiry_date: classification.expiryDate,
      original_file_name: metadata.name,
      mime_type: metadata.mimeType,
      drive_file_id: metadata.id,
      drive_web_view_link: metadata.webViewLink || null,
      vehicle_id: vehicleId,
      driver_id: driverId,
      uploaded_by: user.id
    }).select("id").single();
    if (error) throw error;

    return new Response(JSON.stringify({
      ok: true,
      documentId: saved.id,
      classification: { type: classification.type, expiryDate: classification.expiryDate, vehicleId, driverId }
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ ok: false, error: error?.message || "Erro na importação." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
