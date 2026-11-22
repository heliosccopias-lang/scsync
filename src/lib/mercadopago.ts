/** Mercado Pago Point through the Orders API (cloud → Point Smart). Docs: mercadopago.com.br/developers/pt/docs/mp-point */
import type { PaidInfo } from "./stone";

const BASE = "https://api.mercadopago.com";

export class MpError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export type MpTerminal = { id: string; pos_id?: number | string; store_id?: number | string; operating_mode?: string };
export type MpPayment = {
  id: string;
  amount?: string;
  paid_amount?: string;
  status?: string;
  status_detail?: string;
  reference_id?: string;
  payment_method?: { id?: string; type?: string; installments?: number } | null;
  card?: { last_digits?: string } | null;
};
export type MpOrder = { id: string; status: string; status_detail?: string; external_reference?: string; transactions?: { payments?: MpPayment[] }; last_updated_date?: string };

export class MpClient {
  constructor(
    private token: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private async req<T>(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    const res = await this.fetchImpl(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "X-Idempotency-Key": idempotencyKey } : {}),
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
      const d = data as { message?: string; errors?: { message?: string }[] } | null;
      throw new MpError(d?.errors?.[0]?.message || d?.message || `Mercado Pago HTTP ${res.status}`, res.status);
    }
    return data as T;
  }

  listTerminals() {
    return this.req<{ data?: { terminals?: MpTerminal[] } }>("GET", "/terminals/v1/list?limit=50");
  }

  /** The terminal must be in PDV mode to receive orders (restart it afterwards). */
  setPdvMode(terminalId: string) {
    return this.req<unknown>("PATCH", "/terminals/v1/setup", { terminals: [{ id: terminalId, operating_mode: "PDV" }] });
  }

  createOrder(input: { terminalId: string; amountCents: number; externalReference: string; description: string; paymentType: "any" | "credit" | "debit"; installments: number; idempotencyKey: string }) {
    const body: Record<string, unknown> = {
      type: "point",
      external_reference: input.externalReference.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64),
      description: input.description.slice(0, 150),
      expiration_time: "PT15M",
      transactions: { payments: [{ amount: (input.amountCents / 100).toFixed(2) }] },
      config: { point: { terminal_id: input.terminalId, print_on_terminal: "no_ticket" } },
    };
    if (input.paymentType !== "any") {
      const installments = input.paymentType === "credit" ? Math.max(1, input.installments) : 1;
      (body.config as Record<string, unknown>).payment_method = {
        default_type: input.paymentType === "credit" ? "credit_card" : "debit_card",
        ...(input.paymentType === "credit" ? { default_installments: installments, ...(installments > 1 ? { installments_cost: "seller" } : {}) } : {}),
      };
    }
    return this.req<MpOrder>("POST", "/v1/orders", body, input.idempotencyKey);
  }

  getOrder(id: string) {
    return this.req<MpOrder>("GET", `/v1/orders/${encodeURIComponent(id)}`);
  }

  cancelOrder(id: string, idempotencyKey: string) {
    return this.req<MpOrder>("POST", `/v1/orders/${encodeURIComponent(id)}/cancel`, undefined, idempotencyKey);
  }
}

/** What was paid on a Point order. null while not processed. */
export function mpPaidInfo(order: MpOrder): PaidInfo | null {
  if (order.status !== "processed") return null;
  const paid = (order.transactions?.payments ?? []).filter((p) => p.status === "processed" || p.status === "approved");
  if (!paid.length) return null;
  const p = paid[0];
  const type = String(p.payment_method?.type ?? "").toLowerCase();
  const method: PaidInfo["method"] = type.includes("debit") ? "debit_card" : type.includes("credit") ? "credit_card" : type.includes("pix") || type.includes("qr") || type === "bank_transfer" ? "pix" : "other";
  const cents = paid.reduce((s, x) => s + Math.round(Number(x.paid_amount ?? x.amount ?? 0) * 100), 0);
  return {
    amountCents: cents,
    method,
    installments: method === "credit_card" ? Number(p.payment_method?.installments ?? 1) || 1 : null,
    brand: p.payment_method?.id ?? null,
    authCode: p.reference_id ?? p.id ?? null,
    paidOn: order.last_updated_date ? String(order.last_updated_date).slice(0, 10) : null,
  };
}

export const MP_FINAL_FAILED = new Set(["canceled", "failed", "expired", "refunded"]);
