// Thin client for the public Asaas API v3. Only official endpoints, with each company's own key.

export type AsaasEnvironment = "sandbox" | "production";
export type BillingType = "PIX" | "BOLETO" | "CREDIT_CARD" | "UNDEFINED";

const BASE: Record<AsaasEnvironment, string> = {
  sandbox: "https://api-sandbox.asaas.com/v3",
  production: "https://api.asaas.com/v3",
};

export const WEBHOOK_EVENTS = [
  "PAYMENT_CREATED",
  "PAYMENT_UPDATED",
  "PAYMENT_CONFIRMED",
  "PAYMENT_RECEIVED",
  "PAYMENT_RECEIVED_IN_CASH",
  "PAYMENT_OVERDUE",
  "PAYMENT_DELETED",
  "PAYMENT_REFUNDED",
  "PAYMENT_CHARGEBACK_REQUESTED",
  "PAYMENT_REVERSED",
] as const;

export class AsaasError extends Error {
  constructor(
    message: string,
    public status: number,
    public details: unknown,
  ) {
    super(message);
  }
}

export interface AsaasPayment {
  id: string;
  customer: string;
  value: number;
  netValue?: number;
  status: string;
  billingType: BillingType;
  dueDate: string;
  invoiceUrl?: string;
  bankSlipUrl?: string | null;
  externalReference?: string | null;
}

export class AsaasClient {
  constructor(
    private apiKey: string,
    private env: AsaasEnvironment,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${BASE[this.env]}${path}`, {
      method,
      headers: {
        access_token: this.apiKey,
        "Content-Type": "application/json",
        "User-Agent": "SCsync/0.1",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const first = data?.errors?.[0]?.description ?? `Asaas HTTP ${res.status}`;
      throw new AsaasError(first, res.status, data);
    }
    return data as T;
  }

  /** Cheap authenticated call used to validate a key. */
  balance() {
    return this.request<{ balance: number }>("GET", "/finance/balance");
  }

  createCustomer(input: { name: string; cpfCnpj: string; email?: string | null; mobilePhone?: string | null; externalReference?: string }) {
    return this.request<{ id: string }>("POST", "/customers", input);
  }

  updateCustomer(id: string, input: { name?: string; cpfCnpj?: string; email?: string | null; mobilePhone?: string | null }) {
    return this.request<{ id: string }>("POST", `/customers/${encodeURIComponent(id)}`, input);
  }

  createPayment(input: {
    customer: string;
    billingType: BillingType;
    value: number;
    dueDate: string;
    description?: string;
    externalReference?: string;
    interest?: { value: number };
    fine?: { value: number };
  }) {
    return this.request<AsaasPayment>("POST", "/payments", input);
  }

  getPayment(id: string) {
    return this.request<AsaasPayment>("GET", `/payments/${encodeURIComponent(id)}`);
  }

  deletePayment(id: string) {
    return this.request<{ deleted: boolean }>("DELETE", `/payments/${encodeURIComponent(id)}`);
  }

  pixQrCode(id: string) {
    return this.request<{ encodedImage: string; payload: string; expirationDate?: string }>(
      "GET",
      `/payments/${encodeURIComponent(id)}/pixQrCode`,
    );
  }

  createWebhook(input: { name: string; url: string; email: string; authToken: string }) {
    return this.request<{ id: string }>("POST", "/webhooks", {
      ...input,
      enabled: true,
      interrupted: false,
      sendType: "SEQUENTIALLY",
      events: WEBHOOK_EVENTS,
    });
  }
}

/** Maps our payment method to the Asaas billing type. */
export function billingTypeFor(method: string): BillingType {
  switch (method) {
    case "boleto":
      return "BOLETO";
    case "credit_card":
      return "CREDIT_CARD";
    case "pix":
      return "PIX";
    default:
      return "UNDEFINED";
  }
}

export function webhookUrl(appUrl: string, orgId: string, bypassSecret?: string): string {
  const url = new URL(`/api/webhooks/asaas/${orgId}`, appUrl);
  // Vercel deployment protection would answer Asaas with 401; the bypass secret lets it through.
  if (bypassSecret) url.searchParams.set("x-vercel-protection-bypass", bypassSecret);
  return url.toString();
}
