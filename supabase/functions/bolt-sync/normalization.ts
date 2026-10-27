// Pure helpers extracted for isolated unit testing.
// Keep these functions free of Deno, Supabase, fetch, and database dependencies.

export function clean(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

export function first(obj: any, keys: string[]): unknown {
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

export function statusToPortal(value: unknown, current = "Ativo"): string {
  const status = clean(value).trim().toLowerCase();
  if (!status) return current || "Ativo";
  if (/(suspend|blocked|deactiv|inactive|terminated|banned|disabled|rejected|declined)/.test(status)) return "Inativo";
  if (/^(active|activated|enabled|approved|1|true)$/.test(status)) return "Ativo";
  return current || "Inativo";
}

export function normalizeVehicleId(vehicle: any): string {
  return clean(first(vehicle, ["uuid", "vehicle_uuid", "id"]));
}

export function normalizePlate(vehicle: any): string {
  return clean(first(vehicle, ["reg_number", "registration_number", "plate", "license_plate"]));
}

export function normalizeDriverId(driver: any): string {
  return clean(first(driver, ["driver_uuid", "uuid", "id"]));
}

export function assertNoDuplicateExternalIdentity(
  rows: any[],
  label: string,
  identity: (row: any) => string,
): void {
  const seen = new Set<string>();
  for (const row of rows) {
    const key = identity(row).trim().toUpperCase();
    if (!key) continue;
    if (seen.has(key)) {
      throw new Error(`A Bolt devolveu ${label} duplicado (${key}). Sincronização interrompida para revisão manual.`);
    }
    seen.add(key);
  }
}

export function normalizeActiveVehicle(driver: any): any | null {
  const candidate = first(driver, ["active_vehicle", "activeVehicle", "assigned_vehicle", "assignedVehicle", "vehicle"]);
  if (candidate && typeof candidate === "object") return candidate;
  const vehicleId = first(driver, ["active_vehicle_uuid", "activeVehicleUuid", "vehicle_uuid", "vehicleUuid"]);
  const plate = first(driver, ["active_vehicle_reg_number", "vehicle_reg_number", "vehicle_registration_number"]);
  if (vehicleId || plate) return { uuid: vehicleId, reg_number: plate };
  return null;
}
