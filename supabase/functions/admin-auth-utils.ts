export interface GlobalAdminProfile {
  role?: unknown;
  status?: unknown;
}

export interface CompanyAdminMembership {
  company_id?: unknown;
  role?: unknown;
  status?: unknown;
}

export function isActiveGlobalAdmin(profile: GlobalAdminProfile | null | undefined): boolean {
  return profile?.role === "admin" && profile.status === "Ativo";
}

export function canCreateDriverForCompany(
  profile: GlobalAdminProfile | null | undefined,
  membership: CompanyAdminMembership | null | undefined,
  companyId: string
): boolean {
  if (isActiveGlobalAdmin(profile)) return true;
  return profile?.status === "Ativo" &&
    Boolean(companyId) &&
    membership?.company_id === companyId &&
    membership.role === "company_admin" &&
    membership.status === "Ativo";
}
