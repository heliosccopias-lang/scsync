import { describe, expect, it } from "vitest";
import { denyReason, homeFor, rolePerms } from "../src/lib/access";

const ctx = (role: string, modules: Record<string, boolean> = {}, isOwner = false) => ({ perms: new Set<string>(rolePerms(role)), modules, isOwner });

describe("screen access by profile and module", () => {
  it("Produção opens OS but not finance or settings", () => {
    expect(denyReason("/os/123", ctx("production"))).toBeNull();
    expect(denyReason("/receber", ctx("production"))).toMatch(/perfil/);
    expect(denyReason("/configuracoes/contas", ctx("production"))).toMatch(/perfil/);
    expect(homeFor(ctx("production"))).toBe("/os");
  });
  it("Atendimento receives but does not open payables or reconciliation", () => {
    expect(denyReason("/receber", ctx("attendance"))).toBeNull();
    expect(denyReason("/pagar", ctx("attendance"))).not.toBeNull();
    expect(denyReason("/conciliacao", ctx("attendance"))).not.toBeNull();
  });
  it("a switched-off module closes its screens even for the Dono", () => {
    expect(denyReason("/os", ctx("admin", { os: false }, true))).toMatch(/módulo/);
    expect(denyReason("/cartoes", ctx("finance", { cards: false }))).toMatch(/módulo/);
    expect(homeFor(ctx("admin", { os: false }))).toBe("/receber");
  });
  it("account area and integrations only for the Dono", () => {
    expect(denyReason("/conta", ctx("admin"))).toMatch(/Dono/);
    expect(denyReason("/configuracoes/asaas", ctx("admin"))).toMatch(/Dono/);
    expect(denyReason("/conta", ctx("admin", {}, true))).toBeNull();
  });
});
