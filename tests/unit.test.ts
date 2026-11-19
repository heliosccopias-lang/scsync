import { describe, expect, it, vi } from "vitest";
import { AsaasClient, billingTypeFor, webhookUrl } from "../src/lib/asaas";
import { isValidCnpj, isValidCpf, whatsappLink, whatsappNumber } from "../src/lib/br";
import { decryptSecret, encryptSecret, newWebhookToken, sha256, tokenMatchesHash } from "../src/lib/crypto";
import { addMonths, formatBRL, parseBRL, parseQuantity, splitInstallments, todayInSaoPaulo } from "../src/lib/money";

describe("money", () => {
  it("parses Brazilian amounts into centavos", () => {
    expect(parseBRL("1.234,56")).toBe(123456);
    expect(parseBRL("R$ 99,9")).toBe(9990);
    expect(parseBRL("1234.56")).toBe(123456);
    expect(parseBRL("15")).toBe(1500);
    expect(parseBRL("0,01")).toBe(1);
    expect(parseBRL("abc")).toBeNull();
    expect(parseBRL("1,234")).toBeNull();
    expect(parseBRL("")).toBeNull();
  });

  it("reads dots as thousands the way people type in Brazil", () => {
    expect(parseBRL("1.500")).toBe(150000);
    expect(parseBRL("12.000.000")).toBe(1200000000);
    expect(parseBRL("1.500,00")).toBe(150000);
    expect(parseBRL("150.5")).toBe(15050);
    expect(parseBRL("R$\u00a0150,00")).toBe(15000);
    expect(parseBRL("1.50,00")).toBeNull();
  });

  it("parses quantities", () => {
    expect(parseQuantity("")).toBe(1);
    expect(parseQuantity("2")).toBe(2);
    expect(parseQuantity("2,5")).toBe(2.5);
    expect(parseQuantity("0")).toBeNull();
    expect(parseQuantity("dois")).toBeNull();
  });

  it("splits installments with the remainder on the last one", () => {
    expect(splitInstallments(10000, 3)).toEqual([3333, 3333, 3334]);
    expect(splitInstallments(10000, 3).reduce((a, b) => a + b, 0)).toBe(10000);
    expect(splitInstallments(1, 1)).toEqual([1]);
    expect(() => splitInstallments(0, 1)).toThrow();
    expect(() => splitInstallments(100, 0)).toThrow();
    expect(() => splitInstallments(10.5, 2)).toThrow();
  });

  it("adds months clamping to month end", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-11-10", 2)).toBe("2027-01-10");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
  });

  it("uses São Paulo's date, not UTC", () => {
    // 23:30 in São Paulo on Nov 19 is already Nov 20 in UTC
    expect(todayInSaoPaulo(new Date("2026-11-20T02:30:00Z"))).toBe("2026-11-19");
  });

  it("formats BRL", () => {
    expect(formatBRL(123456).replace(/\s/g, " ")).toBe("R$ 1.234,56");
  });
});

describe("crypto", () => {
  it("round-trips secrets and rejects tampering", () => {
    process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    const enc = encryptSecret("$aact_test_key");
    expect(enc).not.toContain("aact");
    expect(decryptSecret(enc)).toBe("$aact_test_key");
    const [iv, tag, data] = enc.split(".");
    const flipped = Buffer.from(data, "base64");
    flipped[0] ^= 1;
    expect(() => decryptSecret([iv, tag, flipped.toString("base64")].join("."))).toThrow();
  });

  it("makes webhook tokens Asaas accepts and checks them against the hash", () => {
    const t = newWebhookToken();
    expect(t.length).toBeGreaterThanOrEqual(32);
    expect(t.length).toBeLessThanOrEqual(255);
    expect(t).not.toMatch(/\s/);
    const h = sha256(t);
    expect(tokenMatchesHash(t, h)).toBe(true);
    expect(tokenMatchesHash(t + "x", h)).toBe(false);
    expect(tokenMatchesHash(null, h)).toBe(false);
  });
});

describe("asaas client", () => {
  it("sends the access_token header to the sandbox base URL", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "pay_1", status: "PENDING" }), { status: 200 }));
    const client = new AsaasClient("key123", "sandbox", fetchMock as unknown as typeof fetch);
    await client.createPayment({ customer: "cus_1", billingType: "PIX", value: 10.5, dueDate: "2026-12-01", externalReference: "rec_1" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api-sandbox.asaas.com/v3/payments");
    expect((init.headers as Record<string, string>).access_token).toBe("key123");
    expect(JSON.parse(String(init.body))).toMatchObject({ billingType: "PIX", value: 10.5, externalReference: "rec_1" });
  });

  it("surfaces the Asaas error description", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ errors: [{ code: "invalid_cpfCnpj", description: "CPF inválido" }] }), { status: 400 }),
    );
    const client = new AsaasClient("k", "production", fetchMock as unknown as typeof fetch);
    await expect(client.createCustomer({ name: "A", cpfCnpj: "1" })).rejects.toMatchObject({ message: "CPF inválido", status: 400 });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("https://api.asaas.com/v3/customers");
  });

  it("maps methods and builds the webhook URL with the Vercel bypass", () => {
    expect(billingTypeFor("boleto")).toBe("BOLETO");
    expect(billingTypeFor("other")).toBe("UNDEFINED");
    expect(webhookUrl("https://scsync.vercel.app", "abc", "s3cret")).toBe(
      "https://scsync.vercel.app/api/webhooks/asaas/abc?x-vercel-protection-bypass=s3cret",
    );
    expect(webhookUrl("https://app.scsync.com.br/", "abc")).toBe("https://app.scsync.com.br/api/webhooks/asaas/abc");
  });
});

describe("br", () => {
  it("validates CPF and CNPJ check digits", () => {
    expect(isValidCpf("52998224725")).toBe(true);
    expect(isValidCpf("52998224724")).toBe(false);
    expect(isValidCpf("11111111111")).toBe(false);
    expect(isValidCnpj("11222333000181")).toBe(true);
    expect(isValidCnpj("11222333000182")).toBe(false);
  });

  it("builds WhatsApp numbers and links for Brazilian phones", () => {
    expect(whatsappNumber("(11) 98765-4321")).toBe("5511987654321");
    expect(whatsappNumber("011 3333-4444")).toBe("551133334444");
    expect(whatsappNumber("+55 21 99999-0000")).toBe("5521999990000");
    expect(whatsappNumber("12345")).toBeNull();
    expect(whatsappLink("11987654321", "Olá & tchau")).toBe("https://wa.me/5511987654321?text=Ol%C3%A1%20%26%20tchau");
    expect(whatsappLink(null, "x")).toBeNull();
  });
});
