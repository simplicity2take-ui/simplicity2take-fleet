import { canCreateDriverForCompany, isActiveGlobalAdmin } from "./admin-auth-utils.ts";

Deno.test("active global administrators are accepted", () => {
  if (!isActiveGlobalAdmin({ role: "admin", status: "Ativo" })) {
    throw new Error("Active global admin was rejected");
  }
});

Deno.test("inactive and non-admin profiles are rejected", () => {
  for (const profile of [
    { role: "admin", status: "Inativo" },
    { role: "member", status: "Ativo" },
    { role: "driver", status: "Ativo" },
    null,
    undefined,
  ]) {
    if (isActiveGlobalAdmin(profile)) {
      throw new Error("A non-active or non-admin profile was accepted");
    }
  }
});

Deno.test("company admins can create drivers only for their active company", () => {
  const activeProfile = { role: "user", status: "Ativo" };
  const membership = { company_id: "company-a", role: "company_admin", status: "Ativo" };
  if (!canCreateDriverForCompany(activeProfile, membership, "company-a")) {
    throw new Error("Active company admin was rejected for their company");
  }
  const forbidden = [
    [activeProfile, membership, "company-b"],
    [activeProfile, { ...membership, role: "member" }, "company-a"],
    [activeProfile, { ...membership, status: "Inativo" }, "company-a"],
    [{ role: "user", status: "Inativo" }, membership, "company-a"],
    [activeProfile, null, "company-a"],
    [activeProfile, membership, ""],
  ] as const;
  for (const [profile, assigned, target] of forbidden) {
    if (canCreateDriverForCompany(profile, assigned, target)) {
      throw new Error("A member, inactive admin, or cross-company request was accepted");
    }
  }
});

Deno.test("active global admin can create a driver for a selected company", () => {
  if (!canCreateDriverForCompany({ role: "admin", status: "Ativo" }, null, "company-b")) {
    throw new Error("Active global admin was rejected");
  }
});
