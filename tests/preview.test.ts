import { describe, expect, it } from "vitest";
import { canOpen, parsePreview, previewCookieValue, rolePerms } from "../src/lib/access";

describe("visualizar como", () => {
  it("reads profile and plan, ignores junk", () => {
    expect(parsePreview(previewCookieValue("production", "servicos"))).toEqual({ role: "production", plan: "servicos" });
    expect(parsePreview(previewCookieValue(null, "completo"))).toEqual({ role: null, plan: "completo" });
    expect(parsePreview("custom|")).toBeNull();
    expect(parsePreview("hacker|gold")).toBeNull();
    expect(parsePreview("")).toBeNull();
  });
  it("a previewed profile sees what that profile sees", () => {
    const prod = { perms: new Set<string>(rolePerms("production")), modules: {}, isOwner: false };
    expect(canOpen("/os", prod)).toBe(true);
    expect(canOpen("/receber", prod)).toBe(false);
    expect(canOpen("/conta", prod)).toBe(false);
    expect(canOpen("/os/nova", prod)).toBe(false);
    expect(canOpen("/vendas/nova", prod)).toBe(false);
    const att = { perms: new Set<string>(rolePerms("attendance")), modules: {}, isOwner: false };
    expect(canOpen("/vendas/nova", att)).toBe(true);
  });
});
