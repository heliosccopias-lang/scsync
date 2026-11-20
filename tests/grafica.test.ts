import { describe, expect, it } from "vitest";
import { readPrintSpec, splitFinishing } from "../src/lib/grafica";

const getter = (o: Record<string, string>) => (k: string) => o[k] ?? "";

describe("readPrintSpec", () => {
  it("reads all fields and keeps finishing labels in order, plus the free text", () => {
    const s = readPrintSpec(
      getter({ print_format: " 9x5 cm ", print_paper: "Couchê 300g", print_colors: "4x4", fin_corte: "on", fin_laminacao: "on", fin_other: "verniz", art_approved: "on", art_approved_at: "2026-11-19" }),
      "2026-11-20",
    );
    expect(s).toEqual({ print_format: "9x5 cm", print_paper: "Couchê 300g", print_colors: "4x4", finishing: ["Corte", "Laminação", "verniz"], art_approved: true, art_approved_at: "2026-11-19" });
  });
  it("approved without a date uses today; not approved clears the date", () => {
    expect(readPrintSpec(getter({ art_approved: "on" }), "2026-11-20").art_approved_at).toBe("2026-11-20");
    expect(readPrintSpec(getter({ art_approved_at: "2026-11-19" }), "2026-11-20")).toMatchObject({ art_approved: false, art_approved_at: null, finishing: [], print_format: null });
  });
});

describe("splitFinishing", () => {
  it("round-trips checkboxes and the free text", () => {
    const { checked, other } = splitFinishing(["Refile", "verniz", "Encadernação", "dobra"]);
    expect([...checked].sort()).toEqual(["encadernacao", "refile"]);
    expect(other).toBe("verniz, dobra");
  });
});
