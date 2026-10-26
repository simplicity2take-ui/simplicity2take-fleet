export type UberStatusRow = Record<string, unknown>;

function normalizeIdentity(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleUpperCase("pt-PT")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

export function normalizePhone(value: unknown): string {
  return String(value || "").replace(/\D/g, "");
}

export function isOrganizationRow(row: UberStatusRow): boolean {
  const name = normalizeIdentity(row["Nome do motorista"]);
  const organization = normalizeIdentity(row["Nome da organização"]);
  return Boolean(name && organization && name === organization);
}

export function isEligibleUberDriverRow(row: UberStatusRow): boolean {
  const uuid = String(row["UUID do motorista"] || "").trim();
  const status = String(row["Estado"] || "").trim().toUpperCase();
  return Boolean(uuid) && (status === "ACTIVE" || status === "ACCEPTED");
}

export type ExistingUberDriver = {
  id: string | number;
  email?: unknown;
  phone?: unknown;
  uber_driver_uuid?: unknown;
};

export type UberMatchAnalysis = {
  matchedExisting: number;
  wouldCreate: number;
  ambiguousMatches: number;
  duplicateUuidRows: number;
};

/**
 * Shared pure validation for both dry-run preview and the actual import.
 * Any ambiguous identity or duplicate UUID must block the import.
 */
export function analyzeUberStatusMatches(
  rows: UberStatusRow[],
  existingDrivers: ExistingUberDriver[],
): UberMatchAnalysis {
  const seenUuids = new Set<string>();
  const seenEmails = new Map<string, string>();
  const seenPhones = new Map<string, string>();
  const matchedDriverIds = new Set<string>();
  let duplicateUuidRows = 0;
  let matchedExisting = 0;
  let wouldCreate = 0;
  let ambiguousMatches = 0;

  for (const row of rows) {
    const uuid = String(row["UUID do motorista"] || "").trim();
    if (!uuid || seenUuids.has(uuid)) {
      if (uuid) duplicateUuidRows++;
      else ambiguousMatches++;
    }
    seenUuids.add(uuid);

    const email = String(row["E-mail do motorista"] || "").trim().toLowerCase();
    const phone = normalizePhone(row["Telemóvel"] || "");
    if (email && seenEmails.has(email) && seenEmails.get(email) !== uuid) ambiguousMatches++;
    if (phone && seenPhones.has(phone) && seenPhones.get(phone) !== uuid) ambiguousMatches++;
    if (email) seenEmails.set(email, uuid);
    if (phone) seenPhones.set(phone, uuid);

    const candidates = existingDrivers.filter((driver) =>
      (uuid && String(driver.uber_driver_uuid || "").trim() === uuid) ||
      (email && String(driver.email || "").trim().toLowerCase() === email) ||
      (phone && normalizePhone(driver.phone || "") === phone)
    );
    const candidateIds = new Set(candidates.map((driver) => String(driver.id)));

    // UUID, email and phone must all resolve to the same internal record.
    if (candidateIds.size > 1) {
      ambiguousMatches++;
    } else if (candidateIds.size === 1) {
      const matchedId = Array.from(candidateIds)[0];
      if (matchedDriverIds.has(matchedId)) ambiguousMatches++;
      else {
        matchedDriverIds.add(matchedId);
        matchedExisting++;
      }
    } else {
      wouldCreate++;
    }
  }

  return { matchedExisting, wouldCreate, ambiguousMatches, duplicateUuidRows };
}

