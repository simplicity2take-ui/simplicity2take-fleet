import { boltApiEnvelopeError } from "./bolt-sync-utils.ts";

type BoltFetcher = typeof fetch;

function nestedArray(payload: unknown, key: string): unknown[] | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  if (Array.isArray(record[key])) return record[key] as unknown[];
  for (const childKey of ["data", "result", "response"]) {
    const child = record[childKey];
    if (child && typeof child === "object") {
      const rows = nestedArray(child, key);
      if (rows) return rows;
    }
  }
  return null;
}

function totalRows(payload: unknown): number | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const data = record.data && typeof record.data === "object" && !Array.isArray(record.data)
    ? record.data as Record<string, unknown>
    : record;
  const value = data.total_rows;
  if (value === undefined || value === null) return null;
  const total = Number(value);
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new Error("A Bolt devolveu um total de registos inválido.");
  }
  return total;
}

/** Bolt company IDs are numeric provider identifiers, separate from our UUID company IDs. */
export function normalizeBoltCompanyId(value: string | undefined): number {
  const configured = (value || "").trim();
  if (!/^[1-9][0-9]*$/.test(configured)) {
    throw new Error("Configure BOLT_COMPANY_ID com o company_id numérico da empresa Bolt.");
  }
  const companyId = Number(configured);
  if (!Number.isSafeInteger(companyId)) {
    throw new Error("BOLT_COMPANY_ID excede o intervalo numérico suportado.");
  }
  return companyId;
}

/** Verify the configured provider company is accessible and active for these credentials. */
export function assertBoltCompanyAccessible(companyId: number, payload: unknown): void {
  const companies = nestedArray(payload, "companies");
  if (!companies) throw new Error("A Bolt devolveu uma lista de empresas inválida.");
  const configuredCompany = companies.find((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
    const record = candidate as Record<string, unknown>;
    return Number(record.company_id) === companyId &&
      String(record.status_code || "").toLowerCase() === "active";
  });
  if (!configuredCompany) {
    throw new Error("BOLT_COMPANY_ID não corresponde a uma empresa ativa acessível nas credenciais Bolt.");
  }
}

/** Resolve one active Bolt company; require explicit configuration when credentials access several. */
export function resolveBoltCompanyId(value: string | undefined, payload: unknown): number {
  const companies = nestedArray(payload, "companies");
  if (!companies) throw new Error("A Bolt devolveu uma lista de empresas inválida.");
  const activeCompanies = companies.filter((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
    const record = candidate as Record<string, unknown>;
    const id = Number(record.company_id);
    return Number.isSafeInteger(id) && id > 0 &&
      String(record.status_code || "").toLowerCase() === "active";
  });

  if ((value || "").trim()) {
    const configuredId = normalizeBoltCompanyId(value);
    assertBoltCompanyAccessible(configuredId, payload);
    return configuredId;
  }
  if (activeCompanies.length === 1) {
    return Number((activeCompanies[0] as Record<string, unknown>).company_id);
  }
  if (activeCompanies.length === 0) {
    throw new Error("As credenciais Bolt não têm nenhuma empresa ativa acessível.");
  }
  throw new Error("Configure BOLT_COMPANY_ID porque as credenciais Bolt têm mais de uma empresa ativa.");
}

/** Make one documented Bolt Fleet API v2 POST and validate its HTTP and JSON envelope. */
export async function requestBolt(
  fetcher: BoltFetcher,
  apiBase: string,
  path: string,
  token: string,
  payload?: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetcher(apiBase + path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  const text = await response.text();
  let result: unknown;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error("A Bolt devolveu uma resposta que não é JSON.");
  }
  if (!response.ok) throw new Error(`A API Bolt respondeu com HTTP ${response.status}.`);
  const envelopeError = boltApiEnvelopeError(result);
  if (envelopeError) throw new Error(envelopeError);
  return result;
}

/** Fetch every page from a Bolt Fleet API v2 collection using its documented offset/limit fields. */
export async function getBoltCollection(
  fetcher: BoltFetcher,
  apiBase: string,
  path: string,
  token: string,
  companyId: number,
  collectionKey: "drivers" | "vehicles",
  pageSize = 1000,
): Promise<unknown[]> {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
    throw new Error("O tamanho de página Bolt tem de estar entre 1 e 1000.");
  }
  const rows: unknown[] = [];
  let expectedTotal: number | null = null;
  let offset = 0;

  for (let page = 0; page < 10000; page++) {
    const payload = await requestBolt(fetcher, apiBase, path, token, {
      company_id: companyId,
      limit: pageSize,
      offset,
    });
    const currentPage = nestedArray(payload, collectionKey);
    if (!currentPage) throw new Error(`A Bolt devolveu uma lista ${collectionKey} inválida.`);

    const reportedTotal = totalRows(payload);
    if (reportedTotal !== null) {
      if (expectedTotal !== null && reportedTotal !== expectedTotal) {
        throw new Error("A Bolt alterou o total de registos durante a paginação.");
      }
      expectedTotal = reportedTotal;
    }

    if (currentPage.length > pageSize) {
      throw new Error("A Bolt devolveu mais registos do que o limite pedido.");
    }
    if (currentPage.length === 0) {
      if (expectedTotal !== null && rows.length !== expectedTotal) {
        throw new Error("A paginação Bolt terminou antes de devolver todos os registos.");
      }
      return rows;
    }

    rows.push(...currentPage);
    if (expectedTotal !== null) {
      if (rows.length === expectedTotal) return rows;
      if (rows.length > expectedTotal || currentPage.length < pageSize) {
        throw new Error("A paginação Bolt não corresponde ao total de registos anunciado.");
      }
    } else if (currentPage.length < pageSize) {
      return rows;
    }
    offset += currentPage.length;
  }

  throw new Error("A paginação Bolt excedeu o limite de segurança.");
}
