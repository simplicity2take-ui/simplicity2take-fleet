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

function pemToArrayBuffer(pem: string) {
  const base64 = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const binary = atob(base64);
  return Uint8Array.from(binary, char => char.charCodeAt(0)).buffer;
}

function base64Url(input: ArrayBuffer | string) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function googleAccessToken(serviceAccount: any) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/drive",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));
  const unsigned = `${header}.${claim}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(serviceAccount.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${base64Url(signature)}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  if (!response.ok) throw new Error("Não foi possível obter acesso ao Google Drive.");
  const data = await response.json();
  return data.access_token;
}

async function driveRequest(token: string, url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers || {})
    }
  });
  if (!response.ok) {
    throw new Error(`Google Drive HTTP ${response.status}`);
  }
  return response;
}

async function findFolder(token: string, name: string, parentId: string) {
  const q = [
    "mimeType='application/vnd.google-apps.folder'",
    `name='${name.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`,
    `'${parentId}' in parents`,
    "trashed=false"
  ].join(" and ");
  const url = "https://www.googleapis.com/drive/v3/files?" + new URLSearchParams({
    q,
    fields: "files(id,name)",
    pageSize: "10"
  });
  const response = await driveRequest(token, url);
  const data = await response.json();
  return data.files?.[0]?.id || null;
}

async function ensureFolder(token: string, name: string, parentId: string) {
  const existing = await findFolder(token, name, parentId);
  if (existing) return existing;
  const response = await driveRequest(token, "https://www.googleapis.com/drive/v3/files?fields=id,name", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId]
    })
  });
  return (await response.json()).id;
}

function decodeBase64(base64: string) {
  const binary = atob(base64);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ ok: false, error: "Método não permitido." }, 405);

  try {
    const auth = request.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) return json({ ok: false, error: "Sessão não autorizada." }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } }
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ ok: false, error: "Sessão inválida." }, 401);

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    if (profile?.role !== "admin") return json({ ok: false, error: "Apenas o administrador pode carregar documentos." }, 403);

    let body: Record<string, unknown>;
    try {
      const parsed = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return json({ ok: false, error: "Pedido JSON inválido." }, 400);
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return json({ ok: false, error: "Pedido JSON inválido." }, 400);
    }
    const fileName = typeof body.fileName === "string" ? body.fileName.trim() : "";
    const mimeType = typeof body.mimeType === "string" ? body.mimeType : "";
    const base64 = typeof body.base64 === "string" ? body.base64 : "";
    const folderType = typeof body.folderType === "string" ? body.folderType : "";
    const folderName = typeof body.folderName === "string" ? body.folderName.trim() : "";

    if (!fileName || !base64) return json({ ok: false, error: "Ficheiro em falta." }, 400);
    if (!["application/pdf", "image/jpeg", "image/png"].includes(mimeType)) {
      return json({ ok: false, error: "Formato não suportado." }, 400);
    }
    if (base64.length > 15_000_000) return json({ ok: false, error: "Ficheiro demasiado grande." }, 413);
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
      return json({ ok: false, error: "Conteúdo do ficheiro inválido." }, 400);
    }
    if (!["drivers", "vehicles", "documents"].includes(folderType)) {
      return json({ ok: false, error: "Destino do documento inválido." }, 400);
    }
    if (folderType !== "documents" && !folderName) {
      return json({ ok: false, error: "Identificação do motorista ou da viatura em falta." }, 400);
    }

    const binary = decodeBase64(base64);
    const isPdf = binary.length >= 5 && binary[0] === 0x25 && binary[1] === 0x50 && binary[2] === 0x44 && binary[3] === 0x46 && binary[4] === 0x2d;
    const isJpeg = binary.length >= 3 && binary[0] === 0xff && binary[1] === 0xd8 && binary[2] === 0xff;
    const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
    const isPng = binary.length >= 8 && pngSignature.every((byte, index) => binary[index] === byte);
    if (!((mimeType === "application/pdf" && isPdf) ||
      (mimeType === "image/jpeg" && isJpeg) ||
      (mimeType === "image/png" && isPng))) {
      return json({ ok: false, error: "O conteúdo não corresponde ao formato declarado." }, 400);
    }

    const rootFolderId = Deno.env.get("GOOGLE_DRIVE_ROOT_FOLDER_ID");
    const serviceAccountJson = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
    if (!rootFolderId || !serviceAccountJson) {
      return json({ ok: false, error: "Integração Google Drive ainda não configurada no servidor." }, 503);
    }

    const serviceAccount = JSON.parse(serviceAccountJson);
    const token = await googleAccessToken(serviceAccount);

    const folderNames: Record<string, string> = { drivers: "Motoristas", vehicles: "Veículos", documents: "Empresa" };
    const topFolderName = folderNames[folderType];
    if (!topFolderName) return json({ ok: false, error: "Destino do documento inválido." }, 400);
    const topFolderId = await ensureFolder(token, topFolderName, rootFolderId);
    const targetFolderId = folderName ? await ensureFolder(token, folderName, topFolderId) : topFolderId;

    const metadata = {
      name: fileName,
      mimeType,
      parents: [targetFolderId]
    };
    const boundary = "s2t_" + crypto.randomUUID();
    const metadataPart = new TextEncoder().encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
    );
    const endPart = new TextEncoder().encode(`\r\n--${boundary}--`);
    const payload = new Uint8Array(metadataPart.length + binary.length + endPart.length);
    payload.set(metadataPart, 0);
    payload.set(binary, metadataPart.length);
    payload.set(endPart, metadataPart.length + binary.length);

    const upload = await driveRequest(token, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink", {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body: payload
    });
    const file = await upload.json();

    return json({
      ok: true,
      fileId: file.id,
      fileName: file.name,
      mimeType: file.mimeType,
      webViewLink: file.webViewLink || ""
    });
  } catch (error) {
    console.error(error);
    return json({ ok: false, error: "Erro interno ao carregar o documento." }, 500);
  }
});
