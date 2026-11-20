import { describe, expect, it } from "vitest";
import { decodeCsv, parseCsv, parseImportPrice, planCatalogImport } from "../src/lib/catalog-import";

describe("catalog CSV import", () => {
  it("reads Excel PT-BR (semicolon, quotes, R$ prices) and reports bad lines", () => {
    const text = 'Tipo;Nome;Unidade;Preço\r\nServiço;Criação de arte;un;80,00\r\nProduto;"Cartão; 9x5";mil;R$ 1.500,00\r\nx;Algo;;1\r\nProduto;;un;1\r\n';
    const plan = planCatalogImport(parseCsv(decodeCsv(new TextEncoder().encode("﻿" + text))), "product");
    expect(plan.items).toEqual([
      { kind: "service", name: "Criação de arte", unit: "un", price_cents: 8000 },
      { kind: "product", name: "Cartão; 9x5", unit: "mil", price_cents: 150000 },
    ]);
    expect(plan.errors).toEqual(['Linha 4: tipo "x" não reconhecido (use Serviço ou Produto).', "Linha 5: sem nome."]);
  });
  it("reads Google Sheets (comma, dot decimals), uses the tab's kind and keeps blanks as null", () => {
    const plan = planCatalogImport(parseCsv('nome,valor,unidade\n"Banner 1x1",45.9,\nAdesivo,,m2\n'), "service");
    expect(plan.items).toEqual([
      { kind: "service", name: "Banner 1x1", unit: null, price_cents: 4590 },
      { kind: "service", name: "Adesivo", unit: "m2", price_cents: null },
    ]);
  });
  it("decodes Windows-1252 and requires a name column", () => {
    expect(decodeCsv(new Uint8Array([0x43, 0x72, 0x69, 0x61, 0xe7, 0xe3, 0x6f]))).toBe("Criação");
    expect(planCatalogImport([["Codigo", "Valor"], ["1", "2"]], "service").errors[0]).toMatch(/Nome/);
    expect(parseImportPrice("1.500")).toBe(150000);
    expect(parseImportPrice("abc")).toBeNull();
  });
});
