import { describe, expect, it } from "vitest";
import { billingBlock, coveredUntil, planAllows, priceCents } from "../src/lib/plans";

describe("SCsync plans", () => {
  it("monthly prices and 15% off yearly", () => {
    expect([priceCents("servicos", "monthly"), priceCents("servicos_produtos", "monthly"), priceCents("completo", "monthly")]).toEqual([32000, 42000, 48000]);
    expect([priceCents("servicos", "yearly"), priceCents("servicos_produtos", "yearly"), priceCents("completo", "yearly")]).toEqual([326400, 428400, 489600]);
  });
  it("the Serviços plan has no stock; the trial tries everything", () => {
    expect(planAllows("servicos", "active", "stock")).toBe(false);
    expect(planAllows("servicos", "active", "os")).toBe(true);
    expect(planAllows("servicos", "trial", "stock")).toBe(true);
    expect(planAllows("servicos_produtos", "active", "stock")).toBe(true);
  });
  it("a paid charge covers one cycle", () => {
    expect(coveredUntil("2026-01-31", "monthly")).toBe("2026-02-28");
    expect(coveredUntil("2026-12-06", "yearly")).toBe("2027-12-06");
  });
  it("blocks after the trial and after 7 days overdue", () => {
    expect(billingBlock({ status: "trial", plan: "trial", trial_ends_at: "2026-12-06", paid_until: null }, "2026-12-06")).toBeNull();
    expect(billingBlock({ status: "trial", plan: "trial", trial_ends_at: "2026-12-06", paid_until: null }, "2026-12-07")).toMatch(/teste/);
    expect(billingBlock({ status: "past_due", plan: "servicos", trial_ends_at: null, paid_until: "2027-01-06" }, "2027-01-13")).toBeNull();
    expect(billingBlock({ status: "past_due", plan: "servicos", trial_ends_at: null, paid_until: "2027-01-06" }, "2027-01-14")).toMatch(/atraso/);
    expect(billingBlock({ status: "suspended", plan: "founder", trial_ends_at: null, paid_until: null }, "2027-01-14")).toBeNull();
  });
});
