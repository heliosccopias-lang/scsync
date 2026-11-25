import { describe, expect, it } from "vitest";
import { DEFAULT_TPL_READY, DEFAULT_TPL_REMINDER, firstName, paymentLines, reminderKind, render } from "../src/lib/notify-text";

describe("reminderKind", () => {
  const today = "2026-11-25";
  it("lembra antes, no dia e depois do atraso", () => {
    expect(reminderKind("2026-11-26", today, 1, 3)).toBe("reminder_before");
    expect(reminderKind("2026-11-27", today, 1, 3)).toBeNull();
    expect(reminderKind("2026-11-25", today, 1, 3)).toBe("reminder_due");
    expect(reminderKind("2026-11-23", today, 1, 3)).toBeNull();
    expect(reminderKind("2026-11-22", today, 1, 3)).toBe("reminder_overdue");
    expect(reminderKind("2026-10-01", today, 1, 3)).toBeNull(); // mais de 30 dias: não insiste
  });
  it("sem lembrete prévio quando os dias antes são zero", () => {
    expect(reminderKind("2026-11-26", today, 0, 3)).toBeNull();
  });
});

describe("render", () => {
  it("preenche os campos e tira as linhas vazias", () => {
    const t = render(DEFAULT_TPL_REMINDER, {
      cliente: "Maria",
      empresa: "SC Cópias",
      situacao: "Seu pagamento vence hoje",
      referencia: "OS nº 12 (parcela 1/2)",
      valor: "R$ 40,00",
      vencimento: "25/11/2026",
      pagamento: "",
    });
    expect(t).toContain("Olá, Maria! Aqui é da SC Cópias.");
    expect(t).toContain("OS nº 12 (parcela 1/2), no valor de R$ 40,00, com vencimento em 25/11/2026.");
    expect(t).not.toMatch(/\n\n/);
  });
  it("OS pronta com link", () => {
    const t = render(DEFAULT_TPL_READY, { cliente: "Adriano", empresa: "SC", os: "15", pagamento: paymentLines({ osUrl: "https://x/p/abc" }) });
    expect(t).toContain("OS nº 15) está pronto");
    expect(t).toContain("https://x/p/abc");
  });
});

describe("helpers", () => {
  it("primeiro nome e linhas de pagamento", () => {
    expect(firstName("HELIO RODRIGUES JUNIOR")).toBe("Helio");
    expect(paymentLines({ invoiceUrl: "https://asaas/i/1", pixPayload: "000201", osUrl: "https://x" })).toContain("https://asaas/i/1");
    expect(paymentLines({ invoiceUrl: "https://asaas/i/1", osUrl: "https://x" })).not.toContain("https://x\n");
    expect(paymentLines({})).toBe("");
  });
});
