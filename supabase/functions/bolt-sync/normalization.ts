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

/** Distinguish a valid empty collection from a missing/unrecognized response envelope. */
export function hasArrayFrom(payload: any, keys: string[]): boolean {
  if (Array.isArray(payload)) return true;
  for (const key of keys) if (Array.isArray(payload?.[key])) return true;
  for (const key of ["data", "result", "response"]) {
    if (payload?.[key] && typeof payload[key] === "object" && hasArrayFrom(payload[key], keys)) {
      return true;
    }
  }
  return false;
}

/** Only an active global Fleet administrator may invoke privileged sync. */
export function isActiveGlobalAdmin(profile: { role?: unknown; status?: unknown } | null | undefined): boolean {
  return clean(profile?.role).trim().toLowerCase() === "admin" &&
    clean(profile?.status).trim().toLowerCase() === "ativo";
}

/** Existing Fleet status is administrative and must not be overwritten by provider sync. */
export function statusForSync(sourceStatus: unknown, existingStatus: unknown): string {
  const current = clean(existingStatus).trim();
  if (current) return current;
  return statusToPortal(sourceStatus, "Inativo");
}

export function statusToPortal(value: unknown, current = "Inativo"): string {
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
  return clean(first(vehicle, ["reg_number", "registration_number", "normalised_registration_number", "normalized_registration_number", "plate", "license_plate"]));
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

export function decideAssignment(
  activeAssignments: Array<{ vehicle_id: string | number | null }>,
  targetVehicleId: string | number,
): "unchanged" | "conflict" | "create" {
  if (activeAssignments.length === 1 && activeAssignments[0].vehicle_id === targetVehicleId) {
    return "unchanged";
  }
  if (activeAssignments.length > 0) return "conflict";
  return "create";
}

export function assertRequiredExternalIdentities(
  rows: any[],
  label: string,
  identity: (row: any) => string,
): void {
  for (const [index, row] of rows.entries()) {
    if (!identity(row).trim()) {
      throw new Error(`A Bolt devolveu ${label} sem identificação no registo ${index + 1}. Sincronização interrompida antes de qualquer escrita.`);
    }
  }
}

/**
 * Prevent a fallback match (email, phone or registration) from silently
 * transferring a record to a different external UUID.
 */
export function assertCompatibleExternalId(
  sourceId: unknown,
  existingId: unknown,
  label: string,
): void {
  const incoming = clean(sourceId).trim();
  const stored = clean(existingId).trim();
  // UUID/external identity comparisons should not fail only because casing differs.
  if (incoming && stored && incoming.toLowerCase() !== stored.toLowerCase()) {
    throw new Error(
      `Conflito de identidade ${label}: a referência Bolt recebida difere da referência já associada. Sincronização interrompida para revisão manual.`,
    );
  }
}

/** Stable public error envelope; never expose provider/database exception text. */
export function safeSyncError(_error: unknown): { code: string; message: string } {
  return {
    code: "BOLT_SYNC_FAILED",
    message: "A sincronização falhou. Tente novamente mais tarde ou contacte o administrador.",
  };
}


/** Write mode is denied unless both independent opt-ins are explicit. */
export function isBoltWriteAllowed(serverOptIn: unknown, requestConfirmation: unknown): boolean {
  return serverOptIn === "true" && requestConfirmation === true;
}


/** Detect whether a target vehicle is already active for a different driver. */
export function hasOtherDriverAssignment(
  activeAssignments: Array<{ driver_id: string | number | null }>,
  driverId: string | number,
): boolean {
  return activeAssignments.some((assignment) => assignment.driver_id !== driverId);
}
