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
  return (value === undefined || value === null ? "" : String(value)).replace(/\\s+/g, "").trim();
}
