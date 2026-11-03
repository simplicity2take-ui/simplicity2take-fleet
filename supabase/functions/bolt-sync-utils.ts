export function clean(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

export function first(obj: any, keys: string[]) {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

export function arrayFrom(payload: any, keys: string[]): any[] {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) if (Array.isArray(payload?.[key])) return payload[key];
  for (const key of ["data", "result", "response"]) {
    if (payload?.[key] && typeof payload[key] === "object") {
      const nested = arrayFrom(payload[key], keys);
      if (nested.length) return nested;
    }
  }
  return [];
}

export function statusToPortal(value: unknown, current = "Inativo"): string {
  const status = clean(value).trim().toLowerCase();
  if (!status) return current || "Inativo";

  const normalized = status.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (/(?:^|_)(?:not|non)_?(?:active|activated|enabled|approved)(?:_|$)/.test(normalized) ||
      /(inactive|suspend|blocked|deactiv|terminated|banned|disabled|revoked|rejected|pending|awaiting|unverified|unknown)/.test(status)) {
    return "Inativo";
  }
  if (/^(active|activated|enabled|approved)$/.test(normalized) ||
      /(?:^|_)(active|activated|enabled|approved)(?:_|$)/.test(normalized)) {
    return "Ativo";
  }
  return current || "Inativo";
}

export function normalizeVehicleId(vehicle: any): string {
  return clean(first(vehicle, ["uuid", "vehicle_uuid", "id"])).trim();
}

export function normalizePlate(vehicle: any): string {
  return clean(first(vehicle, ["reg_number", "registration_number", "plate", "license_plate"])).trim();
}

export function normalizeDriverId(driver: any): string {
  return clean(first(driver, ["driver_uuid", "uuid", "id"])).trim();
}

export function normalizeActiveVehicle(driver: any): Record<string, unknown> | null {
  if (!driver || typeof driver !== "object" || Array.isArray(driver)) return null;
  const selected = driver.active_vehicle ?? (
    driver.vehicles && typeof driver.vehicles === "object" && !Array.isArray(driver.vehicles)
      ? driver.vehicles.selected
      : null
  );
  return selected && typeof selected === "object" && !Array.isArray(selected)
    ? selected as Record<string, unknown>
    : null;
}

export function boltApiEnvelopeError(payload: unknown): string | null {
  if (Array.isArray(payload)) return null;
  if (!payload || typeof payload !== "object") return "A Bolt devolveu uma resposta inválida.";
  const code = (payload as Record<string, unknown>).code;
  if (code !== undefined && code !== null && code !== 0 && code !== "0") {
    return "A API Bolt devolveu um código de erro.";
  }
  return null;
}


export type BoltAssignmentAction = "unchanged" | "created" | "conflict";

/** Accept only decisions returned by the transactional Bolt assignment RPC. */
export function boltAssignmentAction(result: unknown): BoltAssignmentAction {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Resposta inválida da RPC de associação Bolt.");
  }
  const action = (result as Record<string, unknown>).action;
  if (action === "unchanged" || action === "created" || action === "conflict") return action;
  throw new Error("Decisão inválida da RPC de associação Bolt.");
}
