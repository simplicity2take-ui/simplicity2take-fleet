import { isActiveGlobalAdmin } from "./admin-auth-utils.ts";

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
