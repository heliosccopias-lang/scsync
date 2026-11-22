/**
 * Stone Connect 2.0 (cloud → Stone smart POS) through the Pagar.me Core API v5.
 * Docs: connect-stone.stone.com.br. Each company uses its own Secret Key; the SCsync partner id goes in
 * the ServiceRefererName header (Stone Partner program).
 */
const BASE = "https://api.pagar.me/core/v5";

export class StoneError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

type Fetcher = typeof fetch;

export type StoneOrder = {
  id: string;
  code?: string;
  status: string; // pending | paid | canceled | failed
  closed?: boolean;
  amount?: number;
  charges?: StoneCharge[];
  metadata?: Record<string, string>;
};
export type StoneCharge = {
  id: string;
  status: string;
  amount?: number;
  paid_amount?: number;
  payment_method?: string;
  paid_at?: string;
  last_transaction?: { transaction_type?: string; installments?: number; card?: { brand?: string } | null; acquirer_auth_code?: string } | null;
  metadata?: Record<string, string | number> | null;
};

export class StoneClient {
  constructor(
    private secretKey: string,
    private refererName: string,
    private fetchImpl: Fetcher = fetch,
  ) {}

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.secretKey}:`).toString("base64")}`,
        ServiceRefererName: this.refererName,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* not json */
    }
    if (!res.ok) {
      const d = data as { message?: string; errors?: Record<string, string[]> } | null;
      const first = d?.errors ? Object.values(d.errors).flat()[0] : undefined;
      throw new StoneError(first || d?.message || `Stone HTTP ${res.status}`, res.status);
    }
    return data as T;
  }

  /** Open order shown on the terminal. Without payment type the customer/operator chooses on the POS ("pedido listado"). */
  createPosOrder(input: {
    amountCents: number;
    description: string;
    code: string;
    customer: { name: string; email?: string | null; document?: string | null };
    serialNumber: string;
    displayName: string;
    paymentType: "any" | "credit" | "debit";
    installments: number;
    metadata: Record<string, string>;
  }) {
    const doc = (input.customer.document ?? "").replace(/\D/g, "");
    const customer: Record<string, unknown> = { name: input.customer.name.slice(0, 64) };
    if (input.customer.email) customer.email = input.customer.email;
    if (doc) Object.assign(customer, { document: doc, document_type: doc.length === 14 ? "CNPJ" : "CPF", type: doc.length === 14 ? "company" : "individual" });
    const poi: Record<string, unknown> = {
      visible: true,
      print_order_receipt: false,
      devices_serial_number: [input.serialNumber],
      display_name: input.displayName.slice(0, 40),
    };
    if (input.paymentType !== "any") {
      poi.payment_setup = {
        type: input.paymentType,
        installments: input.paymentType === "credit" ? Math.max(1, input.installments) : 1,
        installment_type: "merchant",
      };
    }
    return this.req<StoneOrder>("POST", "/orders/", {
      code: input.code.slice(0, 52),
      customer,
      items: [{ amount: input.amountCents, description: input.description.slice(0, 256), quantity: 1, code: input.code.slice(0, 52) }],
      closed: false,
      poi_payment_settings: poi,
      metadata: input.metadata,
    });
  }

  getOrder(id: string) {
    return this.req<StoneOrder>("GET", `/orders/${encodeURIComponent(id)}`);
  }

  /** Closing removes the order from the POS list; the integration must close every order (limit of 30 open per POS). */
  closeOrder(id: string, status: "paid" | "canceled" | "failed") {
    return this.req<StoneOrder>("PATCH", `/orders/${encodeURIComponent(id)}/closed`, { status });
  }
}

export type PaidInfo = { amountCents: number; method: "pix" | "credit_card" | "debit_card" | "other"; installments: number | null; brand: string | null; authCode: string | null; paidOn: string | null };

/** Reads what was paid on a Stone order (sum of paid charges, card type, installments). null when nothing paid. */
export function paidInfo(order: StoneOrder): PaidInfo | null {
  const paid = (order.charges ?? []).filter((c) => c.status === "paid");
  if (!paid.length) return null;
  const c = paid[0];
  const meta = (c.metadata ?? {}) as Record<string, string | number>;
  const pm = String(c.payment_method ?? c.last_transaction?.transaction_type ?? "").toLowerCase();
  const funding = String(meta.account_funding_source ?? "").toLowerCase();
  const method: PaidInfo["method"] = pm.includes("pix")
    ? "pix"
    : funding === "debit" || pm === "debit_card"
      ? "debit_card"
      : funding === "credit" || pm === "credit_card"
        ? "credit_card"
        : "other";
  const installments = Number(meta.installment_quantity ?? c.last_transaction?.installments ?? 0) || null;
  return {
    amountCents: paid.reduce((s, x) => s + Number(x.paid_amount ?? x.amount ?? 0), 0),
    method,
    installments: method === "credit_card" ? installments ?? 1 : null,
    brand: (meta.scheme_name as string) || c.last_transaction?.card?.brand || null,
    authCode: (meta.authorization_code as string) || c.last_transaction?.acquirer_auth_code || null,
    paidOn: c.paid_at ? String(c.paid_at).slice(0, 10) : null,
  };
}
