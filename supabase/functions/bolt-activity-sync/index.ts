import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Pool } from "jsr:@db/postgres@^0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://fleet.simplicity2take.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};
const BOLT_TOKEN_URL = "https://oidc.bolt.eu/token";
const BOLT_API_BASE = "https://node.bolt.eu/fleet-integration-gateway";
const COMPANY_ID = 9360;
const dbUrl = Deno.env.get("SUPABASE_DB_URL") || "";
const dbPool = dbUrl ? new Pool(dbUrl, 1) : null;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}
function clean(v: unknown) { return v == null ? "" : String(v); }
function unixToIso(v: unknown) {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (Number.isFinite(n)) {
    const d = new Date((n < 100000000000 ? n * 1000 : n));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(input, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}
async function getBoltToken() {
  const clientId = Deno.env.get("BOLT_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("BOLT_CLIENT_SECRET") || "";
  if (!clientId || !clientSecret) throw new Error("Faltam as credenciais Bolt nos Secrets do Supabase.");
  const body = new URLSearchParams({
    client_id: clientId, client_secret: clientSecret,
    grant_type: "client_credentials", scope: "fleet-integration:api"
  });
  const response = await fetchWithTimeout(BOLT_TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body
  });
  const text = await response.text();
  let data: any = {};
  try { data = JSON.parse(text); } catch {}
  if (!response.ok || !data.access_token) throw new Error("A Bolt recusou a autenticação API.");
  return data.access_token as string;
}
async function boltPost(path: string, token: string, payload: Record<string, unknown>) {
  const response = await fetchWithTimeout(BOLT_API_BASE + path, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  let data: any = {};
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!response.ok || Number(data?.code ?? 0) !== 0) {
    const err: any = new Error(clean(data?.message || data?.error || text || "Pedido Bolt recusado."));
    err.status = response.status;
    err.path = path;
    throw err;
  }
  return data;
}
async function getStateLogs(token: string, startTs: number, endTs: number) {
  const rows: any[] = [];
  let offset = 0;
  for (let page = 0; page < 100; page++) {
    const response = await boltPost("/getFleetStateLogs", token, {
      offset, limit: 1000, company_id: COMPANY_ID, start_ts: startTs, end_ts: endTs
    });
    const data = response?.data || {};
    const batch = Array.isArray(data?.state_logs) ? data.state_logs : [];
    rows.push(...batch);
    if (!batch.length) break;
    offset += batch.length;
    const total = Number(data?.total_rows || 0);
    if (total > 0 && offset >= total) break;
    if (batch.length < 1000) break;
  }
  return rows;
}
function normalizeStateEvents(rows: any[]) {
  return rows.map(row => {
    const driverUuid = clean(row?.driver_uuid);
    const vehicleUuid = clean(row?.vehicle_uuid);
    const createdAt = unixToIso(row?.created);
    const state = clean(row?.state).toUpperCase() || "UNKNOWN";
    return {
      driver_uuid: driverUuid || null,
      vehicle_uuid: vehicleUuid || null,
      state,
      created_at: createdAt,
      event_key: `bolt:state:${driverUuid}:${vehicleUuid}:${row?.created}:${state}`
    };
  }).filter(row => row.created_at && row.event_key);
}
async function save(events: any[]) {
  if (!dbPool) throw new Error("SUPABASE_DB_URL indisponível.");
  const connection = await dbPool.connect();
  try {
    const result = await connection.queryObject<any>`
      select public.sync_bolt_activity(${JSON.stringify(events)}::jsonb, '[]'::jsonb) as result
    `;
    return result.rows[0]?.result || {};
  } finally { connection.release(); }
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const userToken = authHeader.replace(/^Bearer\s+/i, "");
    if (!userToken) return json({ ok: false, error: "Sessão não encontrada." }, 401);
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: authData, error: authError } = await admin.auth.getUser(userToken);
    if (authError || !authData.user) return json({ ok: false, error: "Sessão inválida." }, 401);
    if ((authData.user.email || "").toLowerCase() !== "simplicity2take@gmail.com") {
      return json({ ok: false, error: "Apenas o administrador pode sincronizar a atividade Bolt." }, 403);
    }
    let body: any = {};
    try { body = await req.json(); } catch {}
    const requestedDays = Number(body?.days ?? 7);
    const days = Math.min(31, Math.max(1, Number.isFinite(requestedDays) ? Math.floor(requestedDays) : 7));
    const endTs = Math.floor(Date.now() / 1000);
    const startTs = endTs - days * 86400;
    const token = await getBoltToken();
    let stateRows: any[] = [];
    try {
      stateRows = await getStateLogs(token, startTs, endTs);
    } catch (error) {
      const status = Number(error?.status || 0);
      if (status === 404) {
        throw new Error("A API Bolt deste acesso não disponibiliza o histórico de estados da frota.");
      }
      throw error;
    }
    const events = normalizeStateEvents(stateRows);
    const dbResult = await save(events);
    return json({
      ok: true, source: "bolt", days,
      range: { start: new Date(startTs * 1000).toISOString(), end: new Date(endTs * 1000).toISOString() },
      stateLogsReceived: stateRows.length, eventsPrepared: events.length,
      tripsReceived: 0, tripsPrepared: 0,
      db: dbResult,
      tripsEndpoint: "not-requested"
    });
  } catch (error) {
    console.error("bolt-activity-sync error", error);
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 502);
  }
});