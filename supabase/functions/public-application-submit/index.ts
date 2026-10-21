import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://fleet.simplicity2take.com",
  "https://simplicity2take.com",
  "https://www.simplicity2take.com"
]);
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}
const allowedTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);
const maxFileBytes = 4 * 1024 * 1024;
const maxTotalBytes = 8 * 1024 * 1024;
const clean = (value: unknown, max = 500) => String(value ?? "").trim().slice(0, max);

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    if (!allowedOrigins.has(request.headers.get("origin") ?? "")) return new Response("forbidden", { status: 403 });
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") return json({ ok: false, error: "Método não permitido." }, 405);
  const requestOrigin = request.headers.get("origin") ?? "";
  if (!allowedOrigins.has(requestOrigin)) return json({ ok: false, error: "Origem não autorizada." }, 403);
  const sourceSite = requestOrigin === "https://fleet.simplicity2take.com" ? "fleet" : "website";

  let applicationId: string | null = null;
  try {
    const raw = await request.text();
    if (raw.length > 12_000_000) return json({ ok: false, error: "Pedido demasiado grande." }, 413);
    const body = JSON.parse(raw);
    const candidate = body?.candidate ?? {};
    const name = clean(candidate.name, 120);
    const phone = clean(candidate.phone, 40);
    const email = clean(candidate.email, 254).toLowerCase();
    const candidateModalityInput = clean(candidate.candidateModality, 80).toLowerCase();
    const candidateModality = candidateModalityInput === "viatura da empresa" ? "viatura da empresa" : candidateModalityInput === "viatura própria" || candidateModalityInput === "viatura propria" ? "viatura própria" : "";
    const tvdeCertificate = clean(candidate.tvdeCertificate, 80);
    const drivingLicense = clean(candidate.drivingLicense, 80);
    const tvdeExperience = clean(candidate.tvdeExperience, 200);
    const availability = clean(candidate.availability, 200);
    const schedulePreference = clean(candidate.schedulePreference, 200);
    const conversation = Array.isArray(body?.conversation) ? body.conversation.slice(-100) : [];
    const files = Array.isArray(body?.files) ? body.files : [];

    if (!name || !phone || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        !candidateModality || !["viatura da empresa", "viatura própria"].includes(candidateModality.toLowerCase()) ||
        !tvdeCertificate || !drivingLicense || !tvdeExperience || !availability || !schedulePreference) {
      return json({ ok: false, error: "Dados incompletos ou email inválido. Reveja a candidatura." }, 400);
    }
    if (files.length > 3) return json({ ok: false, error: "Pode enviar no máximo 3 documentos." }, 400);

    let totalBytes = 0;
    const preparedFiles = files.map((file: any) => {
      const fileName = clean(file?.fileName, 160);
      const mimeType = clean(file?.mimeType, 80);
      const base64 = String(file?.base64 ?? "");
      if (!fileName || !allowedTypes.has(mimeType) || !base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
        throw new Error("Um documento tem formato inválido.");
      }
      const bytes = Math.floor(base64.length * 3 / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
      if (bytes > maxFileBytes) throw new Error("Cada documento deve ter no máximo 4 MB.");
      totalBytes += bytes;
      return { fileName, mimeType, base64, sizeBytes: bytes };
    });
    if (totalBytes > maxTotalBytes) return json({ ok: false, error: "O total dos documentos não pode ultrapassar 8 MB." }, 413);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const appsScriptUrl = Deno.env.get("GOOGLE_APPS_SCRIPT_URL");
    const uploadSecret = Deno.env.get("GOOGLE_UPLOAD_SECRET");
    if (!supabaseUrl || !serviceKey) return json({ ok: false, error: "Serviço de candidaturas não configurado." }, 503);
    if (preparedFiles.length && (!appsScriptUrl || !uploadSecret)) {
      return json({ ok: false, error: "O carregamento de documentos ainda não está configurado. Tente novamente mais tarde." }, 503);
    }

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    // Basic duplicate throttling without storing IP addresses.
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const [recentEmail, recentPhone] = await Promise.all([
      admin.from("applications").select("id").gte("created_at", tenMinutesAgo).eq("candidate_email", email).limit(1),
      admin.from("applications").select("id").gte("created_at", tenMinutesAgo).eq("candidate_phone", phone).limit(1)
    ]);
    if (recentEmail.error || recentPhone.error) throw new Error("Não foi possível validar a candidatura. Tente novamente.");
    if (recentEmail.data?.length || recentPhone.data?.length) {
      return json({ ok: false, error: "Já recebemos uma candidatura com estes contactos há poucos minutos. Aguarde antes de tentar novamente." }, 429);
    }

    applicationId = crypto.randomUUID();
    const summary = [
      "Resumo da candidatura:",
      "Nome: " + name,
      "Telemóvel: " + phone,
      "Email: " + email,
      "Modalidade pretendida: " + candidateModality,
      "Origem da candidatura: " + sourceSite,
      "Certificado TVDE: " + tvdeCertificate,
      "Carta de Condução: " + drivingLicense,
      "Experiência TVDE: " + tvdeExperience,
      "Disponibilidade: " + availability,
      "Preferência de horário: " + schedulePreference,
      "Documentos: " + (preparedFiles.map((f: any) => f.fileName).join(", ") || "sem documentos enviados")
    ].join("\n");

    const { error: insertError } = await admin.from("applications").insert({
      id: applicationId,
      candidate_name: name,
      candidate_phone: phone,
      candidate_email: email,
      candidate_modality: candidateModality,
      source_site: sourceSite,
      tvde_certificate: tvdeCertificate,
      driving_license: drivingLicense,
      tvde_experience: tvdeExperience,
      availability,
      schedule_preference: schedulePreference,
      ai_summary: summary,
      status: "Nova"
    });
    if (insertError) throw new Error("Não foi possível guardar a candidatura. Tente novamente.");

    const messageRows = conversation
      .filter((item: any) => ["assistant", "candidate"].includes(item?.role) && typeof item?.text === "string")
      .map((item: any) => ({
        application_id: applicationId,
        sender_role: item.role,
        message: clean(item.text, 3000)
      }));
    if (messageRows.length) {
      const { error } = await admin.from("application_messages").insert(messageRows);
      if (error) throw new Error("Não foi possível guardar a conversa da candidatura.");
    }

    for (const file of preparedFiles) {
      const response = await fetch(appsScriptUrl!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: uploadSecret,
          fileName: file.fileName,
          mimeType: file.mimeType,
          base64: file.base64,
          folderType: "documents",
          folderName: "Candidatura - " + name,
          uploadedBy: "Candidatura pública"
        })
      });
      const responseText = await response.text();
      let result: any;
      try { result = JSON.parse(responseText); } catch { result = { ok: false }; }
      if (!response.ok || result?.ok === false || !result?.fileId) {
        throw new Error("Não foi possível guardar um dos documentos. A candidatura não foi concluída.");
      }
      const { error } = await admin.from("application_documents").insert({
        application_id: applicationId,
        original_file_name: file.fileName,
        drive_file_id: result.fileId,
        drive_web_view_link: result.webViewLink || null,
        mime_type: file.mimeType,
        size_bytes: file.sizeBytes
      });
      if (error) throw new Error("Não foi possível registar um dos documentos da candidatura.");
    }

    return json({ ok: true, applicationId, message: "Candidatura recebida." }, 201);
  } catch (error) {
    console.error("public-application-submit failed", error);
    if (applicationId) {
      try {
        const url = Deno.env.get("SUPABASE_URL");
        const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (url && key) {
          const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
          await admin.from("applications").delete().eq("id", applicationId);
        }
      } catch (cleanupError) {
        console.error("application cleanup failed", cleanupError);
      }
    }
    const message = error instanceof Error ? error.message : "Erro ao submeter a candidatura.";
    return json({ ok: false, error: message }, 500);
  }
});
