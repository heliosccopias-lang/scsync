// Thin client for the public Asaas API v3. Only official endpoints, with each company's own key.

export type AsaasEnvironment = "sandbox" | "production";
export type BillingType = "PIX" | "BOLETO" | "CREDIT_CARD" | "UNDEFINED";

const BASE: Record<AsaasEnvironment, string> = {
  sandbox: "https://api-sandbox.asaas.com/v3",
  production: "https://api.asaas.com/v3",
};

// Only names from Asaas's documented list (docs.asaas.com/docs/webhook-para-cobrancas); an unknown name
// makes Asaas reject the whole webhook. Cash receipts arrive as PAYMENT_RECEIVED.
export const WEBHOOK_EVENTS = [
  "PAYMENT_CREATED",
  "PAYMENT_UPDATED",
  "PAYMENT_CONFIRMED",
  "PAYMENT_RECEIVED",
  "PAYMENT_OVERDUE",
  "PAYMENT_DELETED",
  "PAYMENT_RESTORED",
  "PAYMENT_REFUNDED",
  "PAYMENT_PARTIALLY_REFUNDED",
  "PAYMENT_RECEIVED_IN_CASH_UNDONE",
  "PAYMENT_CHARGEBACK_REQUESTED",
] as const;

// Invoice (NFS-e) events, from docs.asaas.com/docs/webhook-para-notas-fiscais. Sent to a separate webhook.
export const INVOICE_WEBHOOK_EVENTS = [
  "INVOICE_CREATED",
  "INVOICE_UPDATED",
  "INVOICE_SYNCHRONIZED",
  "INVOICE_AUTHORIZED",
  "INVOICE_PROCESSING_CANCELLATION",
  "INVOICE_CANCELED",
  "INVOICE_CANCELLATION_DENIED",
  "INVOICE_ERROR",
] as const;

export interface AsaasInvoice {
  id: string;
  status: string;
  customer?: string | null;
  payment?: string | null;
  number?: string | null;
  pdfUrl?: string | null;
  xmlUrl?: string | null;
  statusDescription?: string | null;
  validationCode?: string | null;
  value?: number;
  effectiveDate?: string;
  externalReference?: string | null;
}

export interface AsaasMunicipalOptions {
  authenticationType: "CERTIFICATE" | "TOKEN" | "USER_AND_PASSWORD";
  supportsCancellation: boolean;
  usesSpecialTaxRegimes: boolean;
  usesServiceListItem: boolean;
  specialTaxRegimesList?: { label: string; value: string }[] | null;
  nationalPortalTaxCalculationRegimeList?: { label: string; value: string }[] | null;
  nationalPortalTaxCalculationRegimeHelp?: string | null;
  municipalInscriptionHelp?: string | null;
  specialTaxRegimeHelp?: string | null;
  serviceListItemHelp?: string | null;
  digitalCertificatedHelp?: string | null;
  accessTokenHelp?: string | null;
  municipalServiceCodeHelp?: string | null;
}

export type AsaasInvoiceTaxes = {
  retainIss: boolean;
  iss: number;
  pis: number;
  cofins: number;
  csll: number;
  inss: number;
  ir: number;
  pisCofinsTaxStatus?: string;
};

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
  subscription?: string | null;
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

export interface AsaasStatementItem {
  id: string;
  value: number; // negative for money leaving the account
  balance?: number;
  type?: string;
  date: string;
  description?: string;
  paymentId?: string | null;
}

export class AsaasClient {
  constructor(
    private apiKey: string,
    private env: AsaasEnvironment,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  /** multipart/form-data (fiscalInfo takes the certificate file). */
  private async requestForm<T>(path: string, form: FormData): Promise<T> {
    const res = await this.fetchImpl(`${BASE[this.env]}${path}`, {
      method: "POST",
      headers: { access_token: this.apiKey, "User-Agent": "SCsync/0.1" },
      body: form,
      cache: "no-store",
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new AsaasError(data?.errors?.[0]?.description ?? `Asaas HTTP ${res.status}`, res.status, data);
    return data as T;
  }

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

  updateCustomer(
    id: string,
    input: { name?: string; cpfCnpj?: string; email?: string | null; mobilePhone?: string | null; postalCode?: string; addressNumber?: string; complement?: string | null },
  ) {
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

  /** Account statement (extrato), one page. Dates are YYYY-MM-DD. */
  financialTransactions(startDate: string, finishDate: string, offset = 0, limit = 100) {
    const q = new URLSearchParams({ startDate, finishDate, offset: String(offset), limit: String(limit) });
    return this.request<{ data: AsaasStatementItem[]; hasMore?: boolean; totalCount?: number }>("GET", `/financialTransactions?${q}`);
  }

  /** Allowed while the charge is pending or overdue. Generates PAYMENT_UPDATED. */
  updatePayment(id: string, input: { billingType: BillingType; value: number; dueDate: string; description?: string }) {
    return this.request<AsaasPayment>("PUT", `/payments/${encodeURIComponent(id)}`, input);
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

  createSubscription(input: {
    customer: string;
    billingType: BillingType;
    value: number;
    nextDueDate: string;
    cycle: "MONTHLY" | "YEARLY";
    description?: string;
    externalReference?: string;
  }) {
    return this.request<{ id: string; status: string; nextDueDate: string }>("POST", "/subscriptions", input);
  }

  /** Changes apply to future charges; updatePendingPayments also fixes the open ones. */
  updateSubscription(id: string, input: { value?: number; cycle?: "MONTHLY" | "YEARLY"; description?: string; nextDueDate?: string; updatePendingPayments?: boolean }) {
    return this.request<{ id: string; status: string; nextDueDate: string }>("PUT", `/subscriptions/${encodeURIComponent(id)}`, input);
  }

  subscriptionPayments(id: string) {
    return this.request<{ data: AsaasPayment[] }>("GET", `/subscriptions/${encodeURIComponent(id)}/payments`);
  }

  deleteSubscription(id: string) {
    return this.request<{ deleted: boolean }>("DELETE", `/subscriptions/${encodeURIComponent(id)}`);
  }

  // ---- NFS-e (notas fiscais de serviço)
  municipalOptions() {
    return this.request<AsaasMunicipalOptions>("GET", "/fiscalInfo/municipalOptions");
  }

  /** null when the account has no fiscal configuration yet (HTTP 404). */
  async getFiscalInfo() {
    try {
      return await this.request<Record<string, unknown>>("GET", "/fiscalInfo/");
    } catch (e) {
      if (e instanceof AsaasError && e.status === 404) return null;
      throw e;
    }
  }

  saveFiscalInfo(form: FormData) {
    return this.requestForm<Record<string, unknown>>("/fiscalInfo/", form);
  }

  municipalServices(description: string) {
    const q = new URLSearchParams({ description, limit: "30" });
    return this.request<{ data: { id: string; description: string; issTax?: number }[] }>("GET", `/fiscalInfo/services?${q}`);
  }

  createInvoice(input: {
    payment?: string;
    customer?: string;
    serviceDescription: string;
    observations: string;
    externalReference?: string;
    value: number;
    deductions: number;
    effectiveDate: string;
    municipalServiceId?: string;
    municipalServiceCode?: string;
    municipalServiceName: string;
    taxes: AsaasInvoiceTaxes;
  }) {
    return this.request<AsaasInvoice>("POST", "/invoices", input);
  }

  authorizeInvoice(id: string) {
    return this.request<AsaasInvoice>("POST", `/invoices/${encodeURIComponent(id)}/authorize`);
  }

  cancelInvoice(id: string) {
    return this.request<AsaasInvoice>("POST", `/invoices/${encodeURIComponent(id)}/cancel`);
  }

  getInvoice(id: string) {
    return this.request<AsaasInvoice>("GET", `/invoices/${encodeURIComponent(id)}`);
  }

  createInvoiceWebhook(input: { url: string; email: string; authToken: string }) {
    return this.request<{ id: string }>("POST", "/webhooks", {
      name: "SCsync notas fiscais",
      url: input.url,
      email: input.email,
      authToken: input.authToken,
      enabled: true,
      interrupted: false,
      sendType: "SEQUENTIALLY",
      events: INVOICE_WEBHOOK_EVENTS,
    });
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
