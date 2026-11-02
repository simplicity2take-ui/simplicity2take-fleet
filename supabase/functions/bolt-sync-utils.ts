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

export function boltStatusToPortal(value: unknown, current = "Ativo"): string {
  const s = value === undefined || value === null ? "" : String(value).toLowerCase();
  if (!s) return current || "Ativo";
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
