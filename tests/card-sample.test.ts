import { describe, expect, it } from "vitest";
import { sampleStatement, sampleStatementCsv } from "../src/lib/card-sample";
import { pairCardLines, parseCardCsv } from "../src/lib/card";

describe("fatura de exemplo", () => {
  const expenses = [
    { id: "e1", spentOn: "2026-11-10", amountCents: 15000, description: "gasolina" },
    { id: "e2", spentOn: "2026-11-12", amountCents: 4590, description: "almoço" },
    { id: "e3", spentOn: "2026-09-01", amountCents: 999, description: "fora do período" },
  ];
  const rows = sampleStatement(expenses, { from: "2026-11-04", closing: "2026-12-03" });
  const parsed = parseCardCsv(sampleStatementCsv(rows));

  it("reads back like a bank CSV, without the bill payment", () => {
    expect(parsed.errors).toEqual([]);
    expect(parsed.lines).toHaveLength(6); // 2 expenses + posto + parcela + estorno + anuidade
    expect(parsed.lines.some((l) => /PAGAMENTO/.test(l.description))).toBe(false);
    expect(parsed.lines.find((l) => /PAPELARIA/.test(l.description))?.installment).toBe("2/3");
    expect(parsed.lines.find((l) => /ESTORNO/.test(l.description))?.amountCents).toBe(-2500);
  });

  it("pairs every expense told to the robot and leaves the rest for the person", () => {
    const pairs = pairCardLines(
      parsed.lines.map((l, i) => ({ id: `t${i}`, postedOn: l.postedOn, amountCents: l.amountCents, description: l.description, installment: l.installment })),
      expenses.map((e) => ({ id: e.id, spentOn: e.spentOn, amountCents: e.amountCents, description: e.description })),
    );
    expect(pairs.map((p) => p.expenseId).sort()).toEqual(["e1", "e2"]);
  });
});
