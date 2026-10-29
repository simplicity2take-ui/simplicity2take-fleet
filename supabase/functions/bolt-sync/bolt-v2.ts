export type BoltEnvelope<T> = {
  code?: number | string;
  message?: string;
  data?: T;
};

export function assertBoltSuccess<T>(payload: unknown): BoltEnvelope<T> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Resposta Bolt inválida.");
  }
  const envelope = payload as BoltEnvelope<T>;
  const successCode = envelope.code === 0 || (typeof envelope.code === "string" && envelope.code.trim() === "0");
  if (!successCode) {
    throw new Error("A Bolt devolveu um código de erro ou uma resposta sem código.");
  }
  if (!envelope.data || typeof envelope.data !== "object" || Array.isArray(envelope.data)) {
    throw new Error("Resposta Bolt sem objeto data.");
  }
  return envelope;
}

export function extractBoltCompanies(payload: unknown): Array<{ company_id: number }> {
  const envelope = assertBoltSuccess<{ companies?: unknown }>(payload);
  const companies = envelope.data?.companies;
  if (!Array.isArray(companies)) throw new Error("Resposta Bolt sem lista data.companies.");
  const ids: Array<{ company_id: number }> = [];
  const seen = new Set<number>();
  for (const company of companies) {
    if (!company || typeof company !== "object") throw new Error("Empresa Bolt inválida.");
    const id = Number((company as { company_id?: unknown }).company_id);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Empresa Bolt sem company_id válido.");
    if (seen.has(id)) throw new Error("A Bolt devolveu company_id duplicado.");
    seen.add(id);
    ids.push({ company_id: id });
  }
  return ids;
}

export async function fetchAllBoltPages<T>(
  fetchPage: (offset: number, limit: number) => Promise<unknown>,
  collectionKey: "drivers" | "vehicles",
  options: { limit?: number; maxPages?: number; maxRows?: number } = {},
): Promise<T[]> {
  const limit = options.limit ?? 1000;
  const maxPages = options.maxPages ?? 100;
  const maxRows = options.maxRows ?? 100_000;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error("Limite de paginação Bolt inválido.");
  }
  if (!Number.isInteger(maxPages) || maxPages < 1 || !Number.isInteger(maxRows) || maxRows < 1) {
    throw new Error("Limites de segurança da paginação inválidos.");
  }

  const all: T[] = [];
  const pageFingerprints = new Set<string>();
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
    const offset = pageIndex * limit;
    const envelope = assertBoltSuccess<Record<string, unknown>>(await fetchPage(offset, limit));
    const collection = envelope.data?.[collectionKey];
    if (!Array.isArray(collection)) throw new Error(`Resposta Bolt sem lista data.${collectionKey}.`);
    const page = collection as T[];
    if (page.length > limit) {
      throw new Error("A Bolt devolveu mais registos do que o limite de página solicitado.");
    }
    const fingerprint = JSON.stringify(page);
    if (page.length > 0 && pageFingerprints.has(fingerprint)) {
      throw new Error("A Bolt repetiu uma página; sincronização interrompida.");
    }
    if (page.length > 0) pageFingerprints.add(fingerprint);
    if (all.length + page.length > maxRows) throw new Error("A resposta Bolt excede o limite de segurança de registos.");
    all.push(...page);
    if (page.length < limit) return all;
  }
  throw new Error("A paginação Bolt excedeu o limite de segurança; não é possível confirmar a lista completa.");
}
