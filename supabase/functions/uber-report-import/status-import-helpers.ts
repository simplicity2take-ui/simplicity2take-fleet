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
