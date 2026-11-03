export interface GlobalAdminProfile {
  role?: unknown;
  status?: unknown;
}

export function isActiveGlobalAdmin(profile: GlobalAdminProfile | null | undefined): boolean {
  return profile?.role === "admin" && profile.status === "Ativo";
}
