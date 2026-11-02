// Pure identity guard shared by Bolt sync and its unit tests.
export function hasBoltIdentityConflict(existingBoltId: unknown, incomingBoltId: unknown): boolean {
  return typeof existingBoltId === "string" && existingBoltId.length > 0 &&
    typeof incomingBoltId === "string" && incomingBoltId.length > 0 &&
    existingBoltId !== incomingBoltId;
}

// Keep normalization identical to the existing Bolt sync behavior.
export function normalizeBoltEmail(value: unknown): string {
  return value === undefined || value === null ? "" : String(value).trim().toLowerCase();
}

export function normalizeBoltPhone(value: unknown): string {
  // Preserve punctuation and country prefixes; only presentation whitespace is removed.
  return (value === undefined || value === null ? "" : String(value)).replace(/\s+/g, "").trim();
}

// v1 supplies active_vehicle; v2 supplies vehicles.selected.
// Do not infer a selected vehicle from vehicles.other_assigned.
export function normalizeBoltActiveVehicle(driver: unknown): Record<string, unknown> | null {
  if (!driver || typeof driver !== "object" || Array.isArray(driver)) return null;
  const value = driver as Record<string, unknown>;
  const selected = value.active_vehicle ?? (
    value.vehicles && typeof value.vehicles === "object" && !Array.isArray(value.vehicles)
      ? (value.vehicles as Record<string, unknown>).selected
      : null
  );
  return selected && typeof selected === "object" && !Array.isArray(selected)
    ? selected as Record<string, unknown>
    : null;
}

export function boltStatusToPortal(value: unknown, current = "Ativo"): string {
  const s = value === undefined || value === null ? "" : String(value).toLowerCase();
  // Missing or blank provider status is not proof of activation; fail closed.
  if (!s.trim()) return "Inativo";
  // Explicit negative forms must win before matching "active"/"approved".
  // Only positively recognized states may activate; unknown provider vocabulary fails closed.
  if (/(not[_ -]?(active|activated|enabled|approved)|non[_ -]?(active|enabled|approved)|inactive|suspend|blocked|deactiv|terminated|banned|disabled|revoked|rejected|pending|awaiting|unverified|unknown)/.test(s)) return "Inativo";
  if (/^(active|activated|enabled|approved)$/.test(s)) return "Ativo";
  return "Inativo";
}

// Keep compensation outcomes explicit and testable without exposing provider payloads.
export type BoltCompensationResult =
  | { ok: true; action: "restored" | "deleted" }
  | { ok: false; action: "restore_failed" | "delete_failed" };

export function isBoltCompensationCritical(result: BoltCompensationResult): boolean {
  return !result.ok;
}

export function boltCompensationDiagnostic(result: BoltCompensationResult): string {
  if (result.ok) return result.action === "restored"
    ? "Perfil anterior restaurado após falha de atribuição."
    : "Novo perfil removido após falha de atribuição.";
  return result.action === "restore_failed"
    ? "Falha crítica: não foi possível restaurar o perfil anterior."
    : "Falha crítica: não foi possível remover o novo perfil.";
}

// Validate the provider envelope without leaking its raw body into admin diagnostics.
export function boltApiEnvelopeError(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return "A Bolt devolveu uma resposta inválida.";
  }
  const value = payload as Record<string, unknown>;
  if (value.code !== undefined && value.code !== 0 && value.code !== "0") {
    return "A API Bolt devolveu um código de erro.";
  }
  return null;
}

export function extractBoltCompanies(payload: unknown): Array<{ company_id: string }> {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  const data = root.data && typeof root.data === "object"
    ? root.data as Record<string, unknown>
    : root;
  if (!Array.isArray(data.companies)) return [];
  return data.companies.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const id = (item as Record<string, unknown>).company_id;
    return typeof id === "string" && id.trim() ? [{ company_id: id.trim() }] : [];
  });
}

// Fail closed: never pick an arbitrary company when credentials expose several.
export function resolveSingleBoltCompanyId(companies: Array<{ company_id: string }>): string | null {
  const ids = [...new Set(companies.map((company) => company.company_id.trim()).filter(Boolean))];
  return ids.length === 1 ? ids[0] : null;
}

export function boltPageCountIsValid(received: number, totalRows: unknown): totalRows is number {
  return Number.isInteger(received) && received >= 0 &&
    typeof totalRows === "number" && Number.isInteger(totalRows) &&
    totalRows >= received && totalRows <= 5000;
}
