import { describe, expect, it } from "vitest";
import { describeOrder, invoiceTaxes, mapInvoiceStatus, nfseReady, serviceValueOfOrder } from "../src/lib/nfse";

describe("NFS-e", () => {
  it("only services, with the discount split in proportion", () => {
    expect(serviceValueOfOrder(10000, 0, 0)).toBe(10000);
    expect(serviceValueOfOrder(10000, 10000, 2000)).toBe(9000);
    expect(serviceValueOfOrder(0, 5000, 0)).toBe(0);
  });
  it("Simples Nacional sends PIS/COFINS/CSLL as zero; Regime Normal sends them with the tax status", () => {
    expect(invoiceTaxes({ simples: true, iss: 2, pis: 0.65, cofins: 3 })).toEqual({ retainIss: false, iss: 2, inss: 0, ir: 0, pis: 0, cofins: 0, csll: 0 });
    expect(invoiceTaxes({ simples: false, iss: 5, pis: 0.65, cofins: 3, csll: 1, retain_iss: true })).toEqual({
      retainIss: true, iss: 5, inss: 0, ir: 0, pis: 0.65, cofins: 3, csll: 1, pisCofinsTaxStatus: "STANDARD_TAXABLE_OPERATION",
    });
  });
  it("describes the OS services and maps statuses", () => {
    expect(describeOrder(12, [{ kind: "service", description: "Arte final", quantity: 1 }, { kind: "product", description: "Papel", quantity: 2 }, { kind: "service", description: "Plotagem", quantity: 2.5, unit: "m" }])).toBe(
      "Ordem de serviço nº 12 — 1 un Arte final; 2,5 m Plotagem",
    );
    expect(mapInvoiceStatus("AUTHORIZED")).toBe("authorized");
    expect(mapInvoiceStatus("WHATEVER")).toBe("scheduled");
    expect(nfseReady({ service_code: "1.01", service_name: "Arte", iss: 2 })).toBeNull();
    expect(nfseReady({ service_name: "Arte", iss: 2 })).toMatch(/serviço municipal/);
  });
});
